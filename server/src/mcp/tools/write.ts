/**
 * mcp/tools/write.ts — State-mutating tools.
 *
 * Every write tool:
 *   1. Validates input (zod schemas on registerTool).
 *   2. Authorizes the caller's role (auth/authorize.ts).
 *   3. Delegates to the gate (P3), evidence (P4), or repository (P1) — never
 *      mutates state directly.
 *   4. Thrown errors are caught by the MCP SDK and surfaced as `isError: true`
 *      tool results — handlers just throw.
 */

import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { assertAuthorized, type Role, type Action } from '../../auth/authorize.js'
import { propose, type TransitionRepository } from '../../domain/gate.js'
import { submit as submitEvidence, selfcheck as runSelfcheck } from '../../domain/evidence.js'
import { validateAndChecksumManifest } from '../../domain/checksum.js'
import {
  insertTask,
  getTaskByKey,
} from '../../db/repositories/task.js'
import { createLeaseRepository } from '../../db/repositories/lease.js'
import { claim as domainClaim, heartbeat as domainHeartbeat, release as domainRelease } from '../../domain/lease.js'
import { insertComment, type CommentKind, type Verdict } from '../../db/repositories/comment.js'
import {
  insertGitRef,
  getGitRefByTaskAndRepo,
  updateGitRef,
  listGitRefsByTask,
} from '../../db/repositories/gitref.js'
import { insertTransition } from '../../db/repositories/transition.js'
import { getProjectBySlug, getProjectById } from '../../db/repositories/project.js'
import { listCommentsByTask } from '../../db/repositories/comment.js'
import { getLatestEvidenceByTask } from '../../db/repositories/evidence.js'
import type { McpContext } from '../context.js'
import type { TaskState } from '../../domain/statemachine.js'
import type { Db } from '../../db/connection.js'
import { loadConfig } from '../../config/index.js'

const config = loadConfig()
const LEASE_TTL_SECONDS = config.leaseTtlSeconds

/**
 * Set a task's state directly in the DB.
 * Task-015 closed the public `updateTaskState` export so that state writes
 * only flow through the gate. The TransitionRepository (which the gate
 * itself calls) still needs a persistence primitive — this is it. It MUST
 * only be invoked from code paths that have already been authorized by the
 * gate (i.e. from makeTransitionRepo / selfcheck-after-gate-approval).
 */
function setTaskStateInDb(db: Db, id: string, state: string): void {
  db.prepare(
    `UPDATE task SET state = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`,
  ).run(state, id)
}

function resolveProject(ctx: McpContext, ref: string) {
  const bySlug = getProjectBySlug(ctx.db, ref)
  if (bySlug) return bySlug
  const byId = getProjectById(ctx.db, ref)
  if (byId) return byId
  throw new Error(`Project not found: ${ref}`)
}

function resolveTask(ctx: McpContext, projectRef: string, key: string) {
  const proj = resolveProject(ctx, projectRef)
  const task = getTaskByKey(ctx.db, proj.id, key)
  if (!task) throw new Error(`Task not found: ${key} in project ${projectRef}`)
  return { proj, task }
}

/** Build a TransitionRepository backed by the real DB. */
function makeTransitionRepo(ctx: McpContext): TransitionRepository {
  return {
    append(record) {
      insertTransition(ctx.db, {
        id: `tr_${randomBytes(8).toString('hex')}`,
        task_id: record.task_id,
        from_state: record.from_state,
        to_state: record.to_state,
        actor_role: record.actor_role,
        actor_token_id: record.actor_token_id,
        note: record.note,
        evidence_id: record.evidence_id,
      })
    },
    setTaskState(task_id, state) {
      setTaskStateInDb(ctx.db, task_id, state)
    },
  }
}

export function registerWriteTools(mcp: McpServer, ctx: McpContext): void {
  // ---------- task.create ----------
  mcp.registerTool('task.create', {
    description: 'Create a new task in a project.',
    inputSchema: {
      project: z.string().min(1),
      key: z.string().min(1),
      title: z.string().min(1),
      body_md: z.string().optional().default(''),
      repos: z.array(z.string()).optional().default([]),
      allow_no_code_change: z.boolean().optional().default(false),
    },
  }, async ({ project, key, title, body_md, allow_no_code_change }) => {
    assertAuthorized(ctx.auth.role as Role, 'task.create')
    const proj = resolveProject(ctx, project)
    const existing = getTaskByKey(ctx.db, proj.id, key)
    if (existing) throw new Error(`Task ${key} already exists in project ${project}`)
    const id = `task_${key}_${Date.now().toString(36)}`
    const task = insertTask(ctx.db, {
      id,
      project_id: proj.id,
      key,
      title,
      body_md,
      state: 'TODO',
      allow_no_code_change,
    })
    return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] }
  })

  // ---------- task.claim ----------
  mcp.registerTool('task.claim', {
    description: 'Claim a task: set the caller as assignee with a lease. Fails if already leased.',
    inputSchema: {
      project: z.string().min(1),
      key: z.string().min(1),
    },
  }, async ({ project, key }) => {
    assertAuthorized(ctx.auth.role as Role, 'task.claim')
    const { task } = resolveTask(ctx, project, key)
    const leaseRepo = createLeaseRepository(ctx.db)
    const result = domainClaim(task.id, ctx.auth.token_id, leaseRepo, { ttlSeconds: LEASE_TTL_SECONDS })
    if (!result.ok) {
      throw new Error(result.error)
    }
    return { content: [{ type: 'text', text: JSON.stringify(result.task, null, 2) }] }
  })

  // ---------- task.heartbeat ----------
  mcp.registerTool('task.heartbeat', {
    description: 'Renew the lease on a claimed task. Requires caller holds the lease.',
    inputSchema: {
      project: z.string().min(1),
      key: z.string().min(1),
    },
  }, async ({ project, key }) => {
    assertAuthorized(ctx.auth.role as Role, 'task.claim')
    const { task } = resolveTask(ctx, project, key)
    const leaseRepo = createLeaseRepository(ctx.db)
    const result = domainHeartbeat(task.id, ctx.auth.token_id, leaseRepo, { ttlSeconds: LEASE_TTL_SECONDS })
    if (!result.ok) {
      throw new Error(result.error)
    }
    return { content: [{ type: 'text', text: JSON.stringify(result.task, null, 2) }] }
  })

  // ---------- task.release ----------
  mcp.registerTool('task.release', {
    description: 'Release a claimed task early.',
    inputSchema: {
      project: z.string().min(1),
      key: z.string().min(1),
    },
  }, async ({ project, key }) => {
    assertAuthorized(ctx.auth.role as Role, 'task.claim')
    const { task } = resolveTask(ctx, project, key)
    const leaseRepo = createLeaseRepository(ctx.db)
    const result = domainRelease(task.id, ctx.auth.token_id, leaseRepo)
    if (!result.ok) {
      throw new Error(result.error)
    }
    return { content: [{ type: 'text', text: JSON.stringify(result.task, null, 2) }] }
  })

  // ---------- task.transition ----------
  mcp.registerTool('task.transition', {
    description: 'Propose a state transition. Validates role + state + guards via the gate (P3).',
    inputSchema: {
      project: z.string().min(1),
      key: z.string().min(1),
      from: z.string().min(1),
      to: z.string().min(1),
      note: z.string().optional(),
    },
  }, async ({ project, key, from, to, note }) => {
    const { task } = resolveTask(ctx, project, key)
    const currentState = task.state as TaskState
    if (currentState !== from) {
      throw new Error(
        `State mismatch: task is '${currentState}', proposal declares from='${from}'`,
      )
    }
    const action = transitionAction(from, to)
    assertAuthorized(ctx.auth.role as Role, action)

    const gitrefs = listGitRefsByTask(ctx.db, task.id).map((r) => ({
      repo: r.repo,
      base_sha: r.base_sha,
      head_sha: r.head_sha,
    }))
    const comments = listCommentsByTask(ctx.db, task.id).map((c) => ({
      kind: c.kind,
      verdict: c.verdict,
    }))
    const evidenceRow = getLatestEvidenceByTask(ctx.db, task.id)
    const evidence = evidenceRow
      ? {
          manifest_json: evidenceRow.manifest_json,
          checksum: validateAndChecksumManifest(evidenceRow.manifest_json),
        }
      : null

    const repo = makeTransitionRepo(ctx)
    // Wire the lease repository so the gate's lease guard actually fires
    // for non-human/non-gate transitions (AC5). Without this, the guard is
    // skipped because `input.leaseRepo` would be undefined.
    const leaseRepo = createLeaseRepository(ctx.db)
    const result = propose(
      {
        task_id: task.id,
        current_state: currentState,
        from: from as TaskState,
        to: to as TaskState,
        actor_role: ctx.auth.role as Role,
        actor_token_id: ctx.auth.token_id,
        note,
        gitrefs,
        allow_no_code_change: task.allow_no_code_change === 1,
        comments,
        evidence,
        computeChecksum: (data: string) => validateAndChecksumManifest(data),
        leaseRepo,
      },
      repo,
    )
    if (!result.ok) throw new Error(result.error ?? 'Gate rejected transition')
    return { content: [{ type: 'text', text: JSON.stringify(result.transition, null, 2) }] }
  })

  // ---------- gitref.set ----------
  mcp.registerTool('gitref.set', {
    description: 'Create or update a git reference for a task.',
    inputSchema: {
      project: z.string().min(1),
      key: z.string().min(1),
      repo: z.string().min(1),
      branch: z.string().min(1),
      base_sha: z.string().min(1),
      head_sha: z.string().min(1),
      mr_url: z.string().optional(),
      mr_state: z.string().optional(),
    },
  }, async ({ project, key, repo, branch, base_sha, head_sha, mr_url, mr_state }) => {
    assertAuthorized(ctx.auth.role as Role, 'gitref.set')
    const { task } = resolveTask(ctx, project, key)
    const existing = getGitRefByTaskAndRepo(ctx.db, task.id, repo)
    if (existing) {
      const updated = updateGitRef(ctx.db, existing.id, {
        head_sha,
        mr_url,
        mr_state,
      })
      return { content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }] }
    }
    const ref = insertGitRef(ctx.db, {
      id: `ref_${randomBytes(8).toString('hex')}`,
      task_id: task.id,
      repo,
      branch,
      base_sha,
      head_sha,
      mr_url,
      mr_state,
    })
    return { content: [{ type: 'text', text: JSON.stringify(ref, null, 2) }] }
  })

  // ---------- comment.add ----------
  mcp.registerTool('comment.add', {
    description: 'Add a comment to a task. kind = narrative | verdict | review | note.',
    inputSchema: {
      project: z.string().min(1),
      key: z.string().min(1),
      kind: z.enum(['narrative', 'verdict', 'review', 'note']),
      body_md: z.string().optional().default(''),
      verdict: z.enum(['PASS', 'REJECT']).optional(),
    },
  }, async ({ project, key, kind, body_md, verdict }) => {
    const action = commentAction(kind)
    assertAuthorized(ctx.auth.role as Role, action)
    const { task } = resolveTask(ctx, project, key)
    const comment = insertComment(ctx.db, {
      id: `cmt_${randomBytes(8).toString('hex')}`,
      task_id: task.id,
      author_role: ctx.auth.role,
      author_token_id: ctx.auth.token_id,
      kind: kind as CommentKind,
      verdict: verdict as Verdict | undefined,
      body_md,
    })
    return { content: [{ type: 'text', text: JSON.stringify(comment, null, 2) }] }
  })

  // ---------- evidence.submit ----------
  mcp.registerTool('evidence.submit', {
    description: 'Submit immutable build/test/ac evidence. Runner-only.',
    inputSchema: {
      project: z.string().min(1),
      key: z.string().min(1),
      build_exit: z.number().int(),
      test_exit: z.number().int(),
      ac_exit: z.number().int(),
      lint_exit: z.number().int().optional(),
      coverage_pct: z.number().optional(),
      manifest_json: z.string().min(1),
      logs_json: z.string().optional().default('{}'),
    },
  }, async (args) => {
    // Role check: assertAuthorized first gives a clear Forbidden message for
    // non-runner callers. The domain submit() also enforces runner-only as a
    // second layer of defense.
    assertAuthorized(ctx.auth.role as Role, 'evidence.submit')
    const { task } = resolveTask(ctx, args.project, args.key)
    const evidence = submitEvidence(ctx.db, task.id, ctx.auth.token_id, ctx.auth.role, {
      build_exit: args.build_exit,
      test_exit: args.test_exit,
      ac_exit: args.ac_exit,
      lint_exit: args.lint_exit,
      coverage_pct: args.coverage_pct,
      manifest_json: args.manifest_json,
      logs_json: args.logs_json,
    })
    return { content: [{ type: 'text', text: JSON.stringify(evidence, null, 2) }] }
  })

  // ---------- task.selfcheck ----------
  mcp.registerTool('task.selfcheck', {
    description: 'Trigger self-check: re-verify latest evidence and propose SELF_CHECK_* transition.',
    inputSchema: {
      project: z.string().min(1),
      key: z.string().min(1),
    },
  }, async ({ project, key }) => {
    assertAuthorized(ctx.auth.role as Role, 'task.transition.self_check')
    const { task } = resolveTask(ctx, project, key)
    const taskRepo = {
      getCurrentState: (_id: string): TaskState => task.state as TaskState,
      setCurrentState: (id: string, state: TaskState) => {
        setTaskStateInDb(ctx.db, id, state)
      },
    }
    const transitionRepo = makeTransitionRepo(ctx)
    const result = await runSelfcheck(
      ctx.db,
      task.id,
      ctx.auth.token_id,
      ctx.auth.role,
      { lint_required: false, coverage_required: null },
      taskRepo,
      transitionRepo,
    )
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  // ---------- task.approve ----------
  mcp.registerTool('task.approve', {
    description: 'Approve a JUDGE_PASSED task → DONE. Human-only.',
    inputSchema: {
      project: z.string().min(1),
      key: z.string().min(1),
    },
  }, async ({ project, key }) => {
    assertAuthorized(ctx.auth.role as Role, 'task.transition.approve')
    const { task } = resolveTask(ctx, project, key)
    const repo = makeTransitionRepo(ctx)
    const result = propose(
      {
        task_id: task.id,
        current_state: task.state as TaskState,
        from: 'JUDGE_PASSED',
        to: 'DONE',
        actor_role: ctx.auth.role as Role,
        actor_token_id: ctx.auth.token_id,
      },
      repo,
    )
    if (!result.ok) throw new Error(result.error ?? 'Gate rejected approval')
    return { content: [{ type: 'text', text: JSON.stringify(result.transition, null, 2) }] }
  })
}

/** Map a from→to transition to the Action required by auth/authorize. */
function transitionAction(from: string, to: string): Action {
  if (from === 'TODO' && to === 'IN_PROGRESS') return 'task.transition.todo_to_in_progress'
  if (from === 'IN_PROGRESS' && to === 'IMPLEMENTED') return 'task.transition.in_progress_to_implemented'
  if (from === 'IMPLEMENTED' && (to === 'SELF_CHECK_PASSED' || to === 'SELF_CHECK_FAILED')) {
    return 'task.transition.self_check'
  }
  if (
    from === 'SELF_CHECK_PASSED' && (to === 'JUDGE_PASSED' || to === 'JUDGE_REJECTED')
  ) {
    return 'task.transition.judge'
  }
  if (
    (from === 'SELF_CHECK_FAILED' && to === 'IN_PROGRESS') ||
    (from === 'JUDGE_REJECTED' && to === 'IN_PROGRESS')
  ) {
    return 'task.transition.rework'
  }
  if (from === 'JUDGE_PASSED' && to === 'DONE') return 'task.transition.approve'
  // Fallback — gate will reject if truly invalid.
  return 'task.transition.rework'
}

/** Map a comment kind to the required action. */
function commentAction(kind: string): Action {
  switch (kind) {
    case 'narrative':
      return 'comment.narrative'
    case 'verdict':
      return 'comment.verdict'
    case 'review':
      return 'comment.review'
    default:
      return 'comment.narrative'
  }
}
