/**
 * mcp/tools/read.ts — Read-only tools (project/task/comment/evidence/gitref listings).
 *
 * All read tools require the 'read' action permission. Since every role has
 * 'read' in TASK_HUB_DESIGN.md §3, any authenticated caller can invoke them.
 *
 * Thrown errors are caught by the MCP SDK and surfaced as `isError: true`
 * tool results — handlers don't need to wrap them.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  listProjects,
  getProjectBySlug,
  getProjectById,
  insertProject,
} from '../../db/repositories/project.js'
import {
  listTasksByProject,
  getTaskByKey,
  type Task,
} from '../../db/repositories/task.js'
import { listCommentsByTask } from '../../db/repositories/comment.js'
import { getLatestEvidenceByTask } from '../../db/repositories/evidence.js'
import { listGitRefsByTask } from '../../db/repositories/gitref.js'
import { assertAuthorized } from '../../auth/authorize.js'
import type { McpContext } from '../context.js'

/**
 * Serialize a task row to a JSON-friendly object (sqlite integer booleans → JS booleans).
 */
function taskToResult(t: Task) {
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
    created_at: t.created_at,
    updated_at: t.updated_at,
  }
}

/**
 * Resolve a project by slug or id; throws a clear error if missing.
 */
function resolveProject(ctx: McpContext, ref: string) {
  const bySlug = getProjectBySlug(ctx.db, ref)
  if (bySlug) return bySlug
  const byId = getProjectById(ctx.db, ref)
  if (byId) return byId
  throw new Error(`Project not found: ${ref}`)
}

export function registerReadTools(mcp: McpServer, ctx: McpContext): void {
  // ---------- project.list ----------
  mcp.registerTool('project.list', {
    description: 'List all projects on this server.',
    inputSchema: {},
  }, async () => {
    assertAuthorized(ctx.auth.role as never, 'read')
    const rows = listProjects(ctx.db)
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] }
  })

  // ---------- project.create ----------
  mcp.registerTool('project.create', {
    description: 'Create a new project. Requires task.create permission.',
    inputSchema: {
      slug: z.string().min(1),
      name: z.string().min(1),
    },
  }, async ({ slug, name }) => {
    assertAuthorized(ctx.auth.role as never, 'task.create')
    const existing = getProjectBySlug(ctx.db, slug)
    if (existing) throw new Error(`Project with slug '${slug}' already exists`)
    const id = `proj_${slug}_${Date.now().toString(36)}`
    const project = insertProject(ctx.db, { id, slug, name })
    return { content: [{ type: 'text', text: JSON.stringify(project, null, 2) }] }
  })

  // ---------- task.list ----------
  mcp.registerTool('task.list', {
    description: 'List tasks in a project, optionally filtered by state.',
    inputSchema: {
      project: z.string().min(1).describe('Project slug or id'),
      state: z.string().optional().describe('Filter by state'),
    },
  }, async ({ project, state }) => {
    assertAuthorized(ctx.auth.role as never, 'read')
    const proj = resolveProject(ctx, project)
    const rows = listTasksByProject(ctx.db, proj.id, state)
    return { content: [{ type: 'text', text: JSON.stringify(rows.map(taskToResult), null, 2) }] }
  })

  // ---------- task.get ----------
  mcp.registerTool('task.get', {
    description: 'Get a single task by key (e.g. TASK-001).',
    inputSchema: {
      project: z.string().min(1),
      key: z.string().min(1),
    },
  }, async ({ project, key }) => {
    assertAuthorized(ctx.auth.role as never, 'read')
    const proj = resolveProject(ctx, project)
    const task = getTaskByKey(ctx.db, proj.id, key)
    if (!task) throw new Error(`Task not found: ${key} in project ${project}`)
    return { content: [{ type: 'text', text: JSON.stringify(taskToResult(task), null, 2) }] }
  })

  // ---------- task.next ----------
  mcp.registerTool('task.next', {
    description: 'Return the next TODO task for the given project.',
    inputSchema: {
      project: z.string().min(1),
      role: z.string().optional().describe('Role to filter availability for'),
    },
  }, async ({ project }) => {
    assertAuthorized(ctx.auth.role as never, 'read')
    const proj = resolveProject(ctx, project)
    const todos = listTasksByProject(ctx.db, proj.id, 'TODO')
    const next = todos[0]
    if (!next) {
      return { content: [{ type: 'text', text: JSON.stringify({ next: null }) }] }
    }
    return { content: [{ type: 'text', text: JSON.stringify({ next: taskToResult(next) }, null, 2) }] }
  })

  // ---------- comment.list ----------
  mcp.registerTool('comment.list', {
    description: 'List comments for a task.',
    inputSchema: {
      project: z.string().min(1),
      key: z.string().min(1),
    },
  }, async ({ project, key }) => {
    assertAuthorized(ctx.auth.role as never, 'read')
    const proj = resolveProject(ctx, project)
    const task = getTaskByKey(ctx.db, proj.id, key)
    if (!task) throw new Error(`Task not found: ${key}`)
    const comments = listCommentsByTask(ctx.db, task.id)
    return { content: [{ type: 'text', text: JSON.stringify(comments, null, 2) }] }
  })

  // ---------- evidence.get ----------
  mcp.registerTool('evidence.get', {
    description: 'Get the latest evidence record for a task.',
    inputSchema: {
      project: z.string().min(1),
      key: z.string().min(1),
    },
  }, async ({ project, key }) => {
    assertAuthorized(ctx.auth.role as never, 'read')
    const proj = resolveProject(ctx, project)
    const task = getTaskByKey(ctx.db, proj.id, key)
    if (!task) throw new Error(`Task not found: ${key}`)
    const evidence = getLatestEvidenceByTask(ctx.db, task.id)
    if (!evidence) {
      return { content: [{ type: 'text', text: JSON.stringify({ evidence: null }) }] }
    }
    return { content: [{ type: 'text', text: JSON.stringify(evidence, null, 2) }] }
  })

  // ---------- gitref.list ----------
  mcp.registerTool('gitref.list', {
    description: 'List git references for a task.',
    inputSchema: {
      project: z.string().min(1),
      key: z.string().min(1),
    },
  }, async ({ project, key }) => {
    assertAuthorized(ctx.auth.role as never, 'read')
    const proj = resolveProject(ctx, project)
    const task = getTaskByKey(ctx.db, proj.id, key)
    if (!task) throw new Error(`Task not found: ${key}`)
    const refs = listGitRefsByTask(ctx.db, task.id)
    return { content: [{ type: 'text', text: JSON.stringify(refs, null, 2) }] }
  })
}
