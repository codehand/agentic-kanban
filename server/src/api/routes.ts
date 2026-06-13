/**
 * routes.ts — JSON REST API routes for the Web UI.
 *
 * Read endpoints (any authenticated role):
 *   GET /api/projects          — list projects
 *   GET /api/tasks?project=&state= — list tasks (filtered)
 *   GET /api/tasks/:key?project= — get task detail (spec + gitrefs + evidence + timeline)
 *   GET /api/evidence/:key?project= — list evidence for a task
 *   GET /api/tokens            — list tokens (active + revoked, with last_used_at)
 *
 * Write endpoints (bearer role = human only):
 *   POST /api/projects                     — create project (slug + name)
 *   POST /api/tasks/:key/approve?project= — approve JUDGE_PASSED → DONE
 *   POST /api/tasks/:key/reset?project=   — reset task to IN_PROGRESS
 *   POST /api/tasks/:key/remove?project=  — remove task
 *   DELETE /api/tokens/:id                — revoke a token (human only)
 *
 * All endpoints require bearer auth (401 if missing/invalid).
 */
import { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { Db } from '../db/connection.js'
import { parseBearerHeader } from '../auth/parse.js'
import { resolveBearer, type ResolvedToken } from '../auth/resolve.js'
import { authorize, type Role } from '../auth/authorize.js'
import { ScopeError, assertUnscoped, filterProjectsByScope, resolveProjectInScope, resolveProjectRef } from '../auth/scope.js'
import { listProjects, getProjectBySlug, getProjectById, insertProject } from '../db/repositories/project.js'
import { listTasksByProject, getTaskByKey, getTaskById, insertTask, updateTaskAttributes } from '../db/repositories/task.js'
import { listCommentsByTask } from '../db/repositories/comment.js'
import { getLatestEvidenceByTask, listEvidenceByTask } from '../db/repositories/evidence.js'
import { listGitRefsByTask } from '../db/repositories/gitref.js'
import { listTransitionsByTask } from '../db/repositories/transition.js'
import { listTokens, getTokenById, findActiveTokensByRole } from '../db/repositories/token.js'
import { insertTransition } from '../db/repositories/transition.js'
import { mintToken as mintTokenFn, revokeTokenById, type Role as MintRole } from '../auth/mint.js'
import { propose, type TransitionRepository } from '../domain/gate.js'
import type { TaskState } from '../domain/statemachine.js'
import { listDependencyIds, setDependencies } from '../db/repositories/dependency.js'
import { validateDependsOn, unmetDependencies, formatUnmet, DependencyError } from '../domain/dependencies.js'
import { handleSseStream, broadcastCreated, broadcastTransition, broadcastRemoved } from './stream.js'
import { VALID_PRIORITIES, VALID_COMPLEXITIES, isHttpUrl } from '../validation/task-attributes.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  })
  res.end(data)
}

function parseUrl(url: string): { path: string; query: Record<string, string> } {
  const [path, qs = ''] = url.split('?')
  const query: Record<string, string> = {}
  for (const pair of qs.split('&')) {
    if (!pair) continue
    const [k, v = ''] = pair.split('=')
    query[decodeURIComponent(k)] = decodeURIComponent(v)
  }
  return { path, query }
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) { resolve(null); return }
      try { resolve(JSON.parse(raw)) } catch { resolve(null) }
    })
    req.on('error', () => resolve(null))
  })
}

function setTaskStateInDb(db: Db, id: string, state: string): void {
  db.prepare(
    `UPDATE task SET state = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`,
  ).run(state, id)
}

function makeTransitionRepo(db: Db): TransitionRepository {
  return {
    append(record) {
      insertTransition(db, {
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
      setTaskStateInDb(db, task_id, state)
    },
  }
}

const PRIORITY_SET = new Set<string>(VALID_PRIORITIES)
const COMPLEXITY_SET = new Set<string>(VALID_COMPLEXITIES)

interface TaskAttributesPatch {
  priority?: string | null
  complexity?: string | null
  estimate_hours?: number | null
  tags?: string[]
  link_document?: string | null
}

function validateTaskAttributesPatch(body: Record<string, unknown>): { ok: true; patch: TaskAttributesPatch } | { ok: false; error: string } {
  const patch: TaskAttributesPatch = {}

  if ('priority' in body) {
    const v = body['priority']
    if (v !== null && (typeof v !== 'string' || !PRIORITY_SET.has(v))) {
      return { ok: false, error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}` }
    }
    patch.priority = v as string | null
  }
  if ('complexity' in body) {
    const v = body['complexity']
    if (v !== null && (typeof v !== 'string' || !COMPLEXITY_SET.has(v))) {
      return { ok: false, error: `Invalid complexity. Must be one of: ${VALID_COMPLEXITIES.join(', ')}` }
    }
    patch.complexity = v as string | null
  }
  if ('estimate_hours' in body) {
    const v = body['estimate_hours']
    if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
      return { ok: false, error: `Invalid estimate_hours. Must be a finite non-negative number` }
    }
    patch.estimate_hours = v as number | null
  }
  if ('tags' in body) {
    const v = body['tags']
    if (!Array.isArray(v) || !v.every((t) => typeof t === 'string')) {
      return { ok: false, error: `Invalid tags. Must be an array of strings` }
    }
    patch.tags = v as string[]
  }
  if ('link_document' in body) {
    const v = body['link_document']
    if (v !== null) {
      if (typeof v !== 'string') return { ok: false, error: `Invalid link_document. Must be a URL string` }
      if (!isHttpUrl(v)) return { ok: false, error: `Invalid link_document. Must be a valid http(s) URL` }
    }
    patch.link_document = v as string | null
  }

  return { ok: true, patch }
}

function taskToResult(db: Db, t: { id: string; project_id: string; key: string; title: string; body_md: string; state: string; allow_no_code_change: number; assignee_token_id: string | null; lease_until: string | null; priority: string | null; complexity: string | null; estimate_hours: number | null; tags: string; link_document: string | null; created_at: string; updated_at: string }) {
  let tagsParsed: string[] = []
  try { tagsParsed = JSON.parse(t.tags || '[]') } catch { tagsParsed = [] }
  // depends_on is exposed as task KEYS so clients can read it the same way they
  // declare it; an unresolvable id (deleted task) is simply dropped.
  const dependsOn = listDependencyIds(db, t.id)
    .map((id) => getTaskById(db, id)?.key)
    .filter((k): k is string => typeof k === 'string')
  return {
    id: t.id,
    project_id: t.project_id,
    key: t.key,
    title: t.title,
    body_md: t.body_md,
    state: t.state,
    allow_no_code_change: t.allow_no_code_change === 1,
    assignee_token_id: t.assignee_token_id,
    lease_until: t.lease_until,
    priority: t.priority,
    complexity: t.complexity,
    estimate_hours: t.estimate_hours,
    tags: tagsParsed,
    link_document: t.link_document,
    depends_on: dependsOn,
    created_at: t.created_at,
    updated_at: t.updated_at,
  }
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function handleGetProjects(db: Db, _query: Record<string, string>, auth: ResolvedToken, res: ServerResponse): void {
  if (!authorize(auth.role as Role, 'read')) {
    sendJson(res, 403, { error: 'Forbidden' }); return
  }
  // List endpoint: FILTER by scope instead of 403 (TASK-042 locked policy).
  const projects = filterProjectsByScope(auth, listProjects(db))
  sendJson(res, 200, { projects })
}

function handleGetTasks(db: Db, query: Record<string, string>, auth: ResolvedToken, res: ServerResponse): void {
  if (!authorize(auth.role as Role, 'read')) {
    sendJson(res, 403, { error: 'Forbidden' }); return
  }
  const projectRef = query['project']
  if (!projectRef) {
    sendJson(res, 400, { error: 'project query param is required' }); return
  }
  // List endpoint: FILTER by scope instead of 403 (TASK-042 locked policy).
  // Anything that is not the scoped project — out-of-scope or nonexistent —
  // yields an empty list, so other projects' existence is never revealed.
  const proj = resolveProjectRef(db, projectRef)
  if (auth.project_scope !== null) {
    if (!proj || proj.id !== auth.project_scope) {
      sendJson(res, 200, { tasks: [] }); return
    }
  } else if (!proj) {
    sendJson(res, 404, { error: `Project not found: ${projectRef}` }); return
  }
  const stateFilter = query['state']
  const tasks = listTasksByProject(db, proj.id, stateFilter)
  sendJson(res, 200, { tasks: tasks.map((t) => taskToResult(db, t)) })
}

function handleGetTaskDetail(db: Db, key: string, query: Record<string, string>, auth: ResolvedToken, res: ServerResponse): void {
  if (!authorize(auth.role as Role, 'read')) {
    sendJson(res, 403, { error: 'Forbidden' }); return
  }
  const projectRef = query['project']
  if (!projectRef) {
    sendJson(res, 400, { error: 'project query param is required' }); return
  }
  // Shared scope chokepoint: scoped tokens 403 on anything but their own project.
  const proj = resolveProjectInScope(db, auth, projectRef)
  if (!proj) {
    sendJson(res, 404, { error: `Project not found: ${projectRef}` }); return
  }
  const task = getTaskByKey(db, proj.id, key)
  if (!task) {
    sendJson(res, 404, { error: `Task not found: ${key}` }); return
  }
  const gitrefs = listGitRefsByTask(db, task.id)
  const evidence = getLatestEvidenceByTask(db, task.id)
  const comments = listCommentsByTask(db, task.id)
  const transitions = listTransitionsByTask(db, task.id)
  sendJson(res, 200, {
    task: taskToResult(db, task),
    gitrefs,
    evidence,
    comments,
    timeline: transitions,
  })
}

function handleGetEvidence(db: Db, key: string, query: Record<string, string>, auth: ResolvedToken, res: ServerResponse): void {
  if (!authorize(auth.role as Role, 'read')) {
    sendJson(res, 403, { error: 'Forbidden' }); return
  }
  const projectRef = query['project']
  if (!projectRef) {
    sendJson(res, 400, { error: 'project query param is required' }); return
  }
  // Shared scope chokepoint: scoped tokens 403 on anything but their own project.
  const proj = resolveProjectInScope(db, auth, projectRef)
  if (!proj) {
    sendJson(res, 404, { error: `Project not found: ${projectRef}` }); return
  }
  const task = getTaskByKey(db, proj.id, key)
  if (!task) {
    sendJson(res, 404, { error: `Task not found: ${key}` }); return
  }
  const evidenceList = listEvidenceByTask(db, task.id)
  sendJson(res, 200, { evidence: evidenceList })
}

function handleGetTokens(db: Db, _query: Record<string, string>, auth: ResolvedToken, res: ServerResponse): void {
  if (!authorize(auth.role as Role, 'read')) {
    sendJson(res, 403, { error: 'Forbidden' }); return
  }
  // Active + revoked rows: the tokens page shows revoked cards too (TASK-041).
  // SECURITY: metadata only — never secret or secret_hash.
  const tokens = listTokens(db).map((t) => ({
    id: t.id,
    role: t.role,
    project_id: t.project_id,
    label: t.label,
    created_at: t.created_at,
    revoked_at: t.revoked_at,
    last_used_at: t.last_used_at,
  }))
  sendJson(res, 200, { tokens })
}

const VALID_MINT_ROLES: ReadonlySet<string> = new Set<MintRole>([
  'human', 'implementer', 'self-check', 'judge', 'runner',
])

async function handleMintToken(db: Db, _query: Record<string, string>, auth: ResolvedToken, req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Human-only endpoint.
  if (auth.role !== 'human') {
    sendJson(res, 403, { error: 'Only human role can mint tokens' }); return
  }
  if (!authorize(auth.role as Role, 'token.mint')) {
    sendJson(res, 403, { error: 'Forbidden' }); return
  }
  const body = await readJsonBody(req)
  const role = typeof body?.['role'] === 'string' ? body['role'] : ''
  const label = typeof body?.['label'] === 'string' ? body['label'] : ''
  const project = typeof body?.['project'] === 'string' ? body['project'] : undefined
  if (!role || !VALID_MINT_ROLES.has(role)) {
    sendJson(res, 400, { error: `Invalid role. Must be one of: ${[...VALID_MINT_ROLES].join(', ')}` }); return
  }
  // Resolve the project reference (slug or id) to the canonical project id so
  // the stored project_id matches what scope enforcement compares against.
  // NOTE: token CRUD itself stays global + role-gated; the minter's own scope
  // is NOT applied here (TASK-042 locked policy).
  let projectId: string | null = null
  if (project) {
    const proj = resolveProjectRef(db, project)
    if (!proj) {
      sendJson(res, 400, { error: `Unknown project: ${project}` }); return
    }
    projectId = proj.id
  }
  const result = mintTokenFn(db, role as MintRole, label, projectId)
  // SECURITY: secret is returned exactly once. Never log it.
  sendJson(res, 200, {
    id: result.tokenId,
    role,
    label,
    project: projectId,
    secret: result.secret,
  })
}

function handleRevokeToken(db: Db, id: string, auth: ResolvedToken, res: ServerResponse): void {
  // Human-only endpoint, mirroring the mint route's guard.
  if (auth.role !== 'human') {
    sendJson(res, 403, { error: 'Only human role can revoke tokens' }); return
  }
  if (!authorize(auth.role as Role, 'token.revoke')) {
    sendJson(res, 403, { error: 'Forbidden' }); return
  }
  const token = getTokenById(db, id)
  if (!token) {
    sendJson(res, 404, { error: `Token not found: ${id}` }); return
  }
  if (token.revoked_at) {
    sendJson(res, 409, { error: `Token already revoked: ${id}` }); return
  }
  // Lockout guard: never revoke the last active human token, or the operator
  // loses access (and bootstrap skips re-minting because the row still exists).
  if (token.role === 'human' && findActiveTokensByRole(db, 'human').length <= 1) {
    sendJson(res, 409, { error: 'Cannot revoke the last active human token' }); return
  }
  revokeTokenById(db, id)
  const revoked = getTokenById(db, id)!
  // SECURITY: only metadata is returned/logged — never the secret or its hash.
  sendJson(res, 200, {
    id: revoked.id,
    role: revoked.role,
    label: revoked.label,
    revoked_at: revoked.revoked_at,
  })
}

// Slugs become URL path segments (/<project-id>/index.html) — keep them path-safe.
const SLUG_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/

async function handleCreateProject(db: Db, _query: Record<string, string>, auth: ResolvedToken, req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Same permission as MCP project.create (human only).
  if (!authorize(auth.role as Role, 'task.create')) {
    sendJson(res, 403, { error: 'Forbidden' }); return
  }
  // Project creation is global — a project-scoped token may not create
  // resources outside its scope (TASK-042). ScopeError → 403 in the router.
  assertUnscoped(auth)
  const body = await readJsonBody(req)
  const slug = typeof body?.['slug'] === 'string' ? body['slug'].trim() : ''
  if (!slug) {
    sendJson(res, 400, { error: 'slug is required' }); return
  }
  if (!SLUG_RE.test(slug)) {
    sendJson(res, 400, { error: 'slug may only contain letters, digits, "-" and "_"' }); return
  }
  const name = (typeof body?.['name'] === 'string' && body['name'].trim()) || slug
  const existing = getProjectBySlug(db, slug)
  if (existing) {
    sendJson(res, 409, { error: `Project with slug '${slug}' already exists` }); return
  }
  const id = `proj_${slug}_${Date.now().toString(36)}`
  const project = insertProject(db, { id, slug, name })
  sendJson(res, 201, { project })
}

async function handleCreateTask(db: Db, query: Record<string, string>, auth: ResolvedToken, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!authorize(auth.role as Role, 'task.create')) {
    sendJson(res, 403, { error: 'Forbidden' }); return
  }
  const body = await readJsonBody(req)
  const projectRef = (typeof body?.['project'] === 'string' ? body['project'] : '') || query['project']
  if (!projectRef) {
    sendJson(res, 400, { error: 'project is required' }); return
  }
  // Shared scope chokepoint: scoped tokens 403 on anything but their own project.
  const proj = resolveProjectInScope(db, auth, projectRef)
  if (!proj) {
    sendJson(res, 404, { error: `Project not found: ${projectRef}` }); return
  }
  const key = typeof body?.['key'] === 'string' ? body['key'] : ''
  const title = typeof body?.['title'] === 'string' ? body['title'] : ''
  if (!key || !title) {
    sendJson(res, 400, { error: 'key and title are required' }); return
  }
  const bodyMd = typeof body?.['body_md'] === 'string' ? body['body_md'] : ''
  const allowNoCodeChange = body?.['allow_no_code_change'] === true

  // Validate optional task attributes
  const attrValidation = validateTaskAttributesPatch(body ?? {})
  if (!attrValidation.ok) {
    sendJson(res, 400, { error: attrValidation.error }); return
  }

  // depends_on (optional): array of task keys in the SAME project.
  const dependsOnRaw = body?.['depends_on']
  if (dependsOnRaw !== undefined && (!Array.isArray(dependsOnRaw) || !dependsOnRaw.every((d) => typeof d === 'string'))) {
    sendJson(res, 400, { error: 'depends_on must be an array of task keys' }); return
  }
  const dependsOn = (dependsOnRaw as string[] | undefined) ?? []

  const existing = getTaskByKey(db, proj.id, key)
  if (existing) {
    sendJson(res, 409, { error: `Task ${key} already exists in project ${projectRef}` }); return
  }
  const id = `task_${key}_${Date.now().toString(36)}`
  const task = insertTask(db, {
    id,
    project_id: proj.id,
    key,
    title,
    body_md: bodyMd,
    state: 'TODO',
    allow_no_code_change: allowNoCodeChange,
    priority: attrValidation.patch.priority ?? null,
    complexity: attrValidation.patch.complexity ?? null,
    estimate_hours: attrValidation.patch.estimate_hours ?? null,
    tags: attrValidation.patch.tags ?? [],
    link_document: attrValidation.patch.link_document ?? null,
  })
  if (dependsOn.length > 0) {
    try {
      const depIds = validateDependsOn(db, proj.id, key, dependsOn, task.id)
      setDependencies(db, task.id, depIds)
    } catch (err) {
      if (err instanceof DependencyError) {
        // Roll back the just-created task so a rejected depends_on leaves no
        // orphan row behind.
        db.prepare(`DELETE FROM task WHERE id = ?`).run(task.id)
        sendJson(res, 400, { error: err.message }); return
      }
      throw err
    }
  }
  // Broadcast SSE 'created' event so live UI picks up the new task.
  broadcastCreated({
    task_id: task.id,
    project_id: proj.id,
    project: proj.slug,
    key: task.key,
    title: task.title,
    at: task.created_at,
  })
  sendJson(res, 201, { task: taskToResult(db, task) })
}

async function handleUpdateTask(db: Db, key: string, query: Record<string, string>, auth: ResolvedToken, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!authorize(auth.role as Role, 'task.update')) {
    sendJson(res, 403, { error: 'Forbidden' }); return
  }
  const projectRef = query['project']
  if (!projectRef) {
    sendJson(res, 400, { error: 'project query param is required' }); return
  }
  // Shared scope chokepoint: scoped tokens 403 on anything but their own project.
  const proj = resolveProjectInScope(db, auth, projectRef)
  if (!proj) {
    sendJson(res, 404, { error: `Project not found: ${projectRef}` }); return
  }
  const task = getTaskByKey(db, proj.id, key)
  if (!task) {
    sendJson(res, 404, { error: `Task not found: ${key}` }); return
  }
  const body = await readJsonBody(req)
  if (!body) {
    sendJson(res, 400, { error: 'Request body is required' }); return
  }
  const validation = validateTaskAttributesPatch(body)
  if (!validation.ok) {
    sendJson(res, 400, { error: validation.error }); return
  }
  // depends_on (optional): replace the dependency set when present.
  if ('depends_on' in body) {
    const dependsOnRaw = body['depends_on']
    if (!Array.isArray(dependsOnRaw) || !dependsOnRaw.every((d) => typeof d === 'string')) {
      sendJson(res, 400, { error: 'depends_on must be an array of task keys' }); return
    }
    try {
      const depIds = validateDependsOn(db, proj.id, task.key, dependsOnRaw, task.id)
      setDependencies(db, task.id, depIds)
    } catch (err) {
      if (err instanceof DependencyError) { sendJson(res, 400, { error: err.message }); return }
      throw err
    }
  }
  const updated = updateTaskAttributes(db, task.id, validation.patch)
  sendJson(res, 200, { task: updated ? taskToResult(db, updated) : null })
}

async function handleApprove(db: Db, key: string, query: Record<string, string>, auth: ResolvedToken, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (auth.role !== 'human') {
    sendJson(res, 403, { error: 'Only human role can approve tasks' }); return
  }
  if (!authorize(auth.role as Role, 'task.transition.approve')) {
    sendJson(res, 403, { error: 'Forbidden' }); return
  }
  const projectRef = query['project']
  if (!projectRef) {
    sendJson(res, 400, { error: 'project query param is required' }); return
  }
  // Shared scope chokepoint: scoped tokens 403 on anything but their own project.
  const proj = resolveProjectInScope(db, auth, projectRef)
  if (!proj) {
    sendJson(res, 404, { error: `Project not found: ${projectRef}` }); return
  }
  const task = getTaskByKey(db, proj.id, key)
  if (!task) {
    sendJson(res, 404, { error: `Task not found: ${key}` }); return
  }
  if (task.state !== 'JUDGE_PASSED') {
    sendJson(res, 409, { error: `Task is in state '${task.state}', expected 'JUDGE_PASSED'` }); return
  }
  // Dependency gate: cannot approve while any dependency is not DONE.
  const unmet = unmetDependencies(db, task.id)
  if (unmet.length > 0) {
    sendJson(res, 409, { error: `Task ${task.key} is blocked by unmet dependencies: ${formatUnmet(unmet)}`, unmet_dependencies: unmet }); return
  }
  const body = await readJsonBody(req)
  const note = typeof body?.['note'] === 'string' ? body['note'] : undefined

  const repo = makeTransitionRepo(db)
  const result = propose({
    task_id: task.id,
    current_state: task.state as TaskState,
    from: 'JUDGE_PASSED',
    to: 'DONE',
    actor_role: 'human',
    actor_token_id: auth.token_id,
    note,
  }, repo)

  if (!result.ok) {
    sendJson(res, 422, { error: result.error }); return
  }

  // Broadcast SSE event
  broadcastTransition({
    task_id: task.id,
    project: proj.slug,
    key: task.key,
    from_state: 'JUDGE_PASSED',
    to_state: 'DONE',
    actor_role: 'human',
    at: result.transition!.at,
  })

  // Return updated task
  const updated = getTaskById(db, task.id)
  sendJson(res, 200, { task: updated ? taskToResult(db, updated) : null, transition: result.transition })
}

async function handleReset(db: Db, key: string, query: Record<string, string>, auth: ResolvedToken, _req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (auth.role !== 'human') {
    sendJson(res, 403, { error: 'Only human role can reset tasks' }); return
  }
  const projectRef = query['project']
  if (!projectRef) {
    sendJson(res, 400, { error: 'project query param is required' }); return
  }
  // Shared scope chokepoint: scoped tokens 403 on anything but their own project.
  const proj = resolveProjectInScope(db, auth, projectRef)
  if (!proj) {
    sendJson(res, 404, { error: `Project not found: ${projectRef}` }); return
  }
  const task = getTaskByKey(db, proj.id, key)
  if (!task) {
    sendJson(res, 404, { error: `Task not found: ${key}` }); return
  }

  // Reset: JUDGE_REJECTED/SELF_CHECK_FAILED -> IN_PROGRESS
  const from = task.state as TaskState
  if (from !== 'JUDGE_REJECTED' && from !== 'SELF_CHECK_FAILED') {
    sendJson(res, 409, { error: `Cannot reset task in state '${from}'` }); return
  }
  const repo = makeTransitionRepo(db)
  const result = propose({
    task_id: task.id,
    current_state: from,
    from,
    to: 'IN_PROGRESS',
    actor_role: 'human',
    actor_token_id: auth.token_id,
    note: 'reset by human',
  }, repo)
  if (!result.ok) {
    sendJson(res, 422, { error: result.error }); return
  }
  // Broadcast SSE event so other clients see the reset live.
  broadcastTransition({
    task_id: task.id,
    project: proj.slug,
    key: task.key,
    from_state: from,
    to_state: 'IN_PROGRESS',
    actor_role: 'human',
    at: result.transition!.at,
  })
  const updated = getTaskById(db, task.id)
  sendJson(res, 200, { task: updated ? taskToResult(db, updated) : null })
}

async function handleRemove(db: Db, key: string, query: Record<string, string>, auth: ResolvedToken, _req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (auth.role !== 'human') {
    sendJson(res, 403, { error: 'Only human role can remove tasks' }); return
  }
  const projectRef = query['project']
  if (!projectRef) {
    sendJson(res, 400, { error: 'project query param is required' }); return
  }
  // Shared scope chokepoint: scoped tokens 403 on anything but their own project.
  const proj = resolveProjectInScope(db, auth, projectRef)
  if (!proj) {
    sendJson(res, 404, { error: `Project not found: ${projectRef}` }); return
  }
  const task = getTaskByKey(db, proj.id, key)
  if (!task) {
    sendJson(res, 404, { error: `Task not found: ${key}` }); return
  }
  db.prepare(`DELETE FROM task WHERE id = ?`).run(task.id)
  // Broadcast SSE 'removed' event so live UIs drop the card without reload.
  broadcastRemoved(proj.slug, task.id, task.key)
  sendJson(res, 200, { removed: true, key })
}

// ---------------------------------------------------------------------------
// Router mount
// ---------------------------------------------------------------------------

/**
 * Mount /api/* routes onto the existing router.
 * Returns a new handler that falls through to the original for non-/api paths.
 */
export function mountApiRoutes(
  handle: (req: IncomingMessage, res: ServerResponse) => void,
  db: Db,
): (req: IncomingMessage, res: ServerResponse) => void {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const { path, query } = parseUrl(req.url ?? '/')

    if (!path.startsWith('/api/') && path !== '/api') {
      handle(req, res)
      return
    }

    // SSE stream — auth optional (EventSource cannot set headers, so anonymous
    // connections keep working). When a bearer IS presented it must be valid,
    // and a project-scoped token gets a per-connection filter so out-of-scope
    // events are never delivered (TASK-042).
    if (path === '/api/stream' && (req.method ?? 'GET').toUpperCase() === 'GET') {
      const streamSecret = parseBearerHeader(req)
      let scopeSlug: string | null = null
      if (streamSecret) {
        const streamAuth = resolveBearer(db, streamSecret)
        if (!streamAuth) {
          sendJson(res, 401, { error: 'Invalid or revoked token' })
          return
        }
        if (streamAuth.project_scope !== null) {
          const scopeProj = getProjectById(db, streamAuth.project_scope)
          // Events carry the project slug; an unresolvable scope matches
          // nothing ('' is never a valid slug).
          scopeSlug = scopeProj ? scopeProj.slug : ''
        }
      }
      handleSseStream(req, res, scopeSlug)
      return
    }

    // All other /api endpoints require bearer auth
    const secret = parseBearerHeader(req)
    if (!secret) {
      sendJson(res, 401, { error: 'Missing or malformed Authorization header' })
      return
    }
    const auth = resolveBearer(db, secret)
    if (!auth) {
      sendJson(res, 401, { error: 'Invalid or revoked token' })
      return
    }

    const method = (req.method ?? 'GET').toUpperCase()

    try {
      // GET endpoints
      if (method === 'GET') {
        if (path === '/api/projects') {
          handleGetProjects(db, query, auth, res); return
        }
        if (path === '/api/tasks') {
          handleGetTasks(db, query, auth, res); return
        }
        if (path === '/api/tokens') {
          handleGetTokens(db, query, auth, res); return
        }
        // GET /api/tasks/:key
        const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/)
        if (taskMatch) {
          handleGetTaskDetail(db, decodeURIComponent(taskMatch[1]!), query, auth, res); return
        }
        // GET /api/evidence/:key
        const evMatch = path.match(/^\/api\/evidence\/([^/]+)$/)
        if (evMatch) {
          handleGetEvidence(db, decodeURIComponent(evMatch[1]!), query, auth, res); return
        }
      }

      // POST write endpoints (human only)
      if (method === 'POST') {
        if (path === '/api/projects') {
          await handleCreateProject(db, query, auth, req, res); return
        }
        if (path === '/api/tasks') {
          await handleCreateTask(db, query, auth, req, res); return
        }
        if (path === '/api/tokens') {
          await handleMintToken(db, query, auth, req, res); return
        }
        const approveMatch = path.match(/^\/api\/tasks\/([^/]+)\/approve$/)
        if (approveMatch) {
          await handleApprove(db, decodeURIComponent(approveMatch[1]!), query, auth, req, res); return
        }
        const resetMatch = path.match(/^\/api\/tasks\/([^/]+)\/reset$/)
        if (resetMatch) {
          await handleReset(db, decodeURIComponent(resetMatch[1]!), query, auth, req, res); return
        }
        const removeMatch = path.match(/^\/api\/tasks\/([^/]+)\/remove$/)
        if (removeMatch) {
          await handleRemove(db, decodeURIComponent(removeMatch[1]!), query, auth, req, res); return
        }
      }

      // DELETE write endpoints (human only)
      if (method === 'DELETE') {
        const tokenMatch = path.match(/^\/api\/tokens\/([^/]+)$/)
        if (tokenMatch) {
          handleRevokeToken(db, decodeURIComponent(tokenMatch[1]!), auth, res); return
        }
      }

      // PATCH write endpoints
      if (method === 'PATCH') {
        const patchMatch = path.match(/^\/api\/tasks\/([^/]+)$/)
        if (patchMatch) {
          await handleUpdateTask(db, decodeURIComponent(patchMatch[1]!), query, auth, req, res); return
        }
      }

      sendJson(res, 404, { error: 'Not found' })
    } catch (err) {
      // Scope violations from the shared chokepoint (auth/scope.ts) → clean
      // 403, never 500. The message is generic by design: it must not leak
      // names or existence of out-of-scope resources.
      if (err instanceof ScopeError) {
        sendJson(res, 403, { error: err.message })
        return
      }
      sendJson(res, 500, { error: 'Internal server error' })
    }
  }
}
