/**
 * routes.ts — JSON REST API routes for the Web UI.
 *
 * Read endpoints (any authenticated role):
 *   GET /api/projects          — list projects
 *   GET /api/tasks?project=&state= — list tasks (filtered)
 *   GET /api/tasks/:key?project= — get task detail (spec + gitrefs + evidence + timeline)
 *   GET /api/evidence/:key?project= — list evidence for a task
 *   GET /api/tokens            — list active tokens
 *
 * Write endpoints (bearer role = human only):
 *   POST /api/projects                     — create project (slug + name)
 *   POST /api/tasks/:key/approve?project= — approve JUDGE_PASSED → DONE
 *   POST /api/tasks/:key/reset?project=   — reset task to IN_PROGRESS
 *   POST /api/tasks/:key/remove?project=  — remove task
 *
 * All endpoints require bearer auth (401 if missing/invalid).
 */
import { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { Db } from '../db/connection.js'
import { parseBearerHeader } from '../auth/parse.js'
import { resolveBearer, type ResolvedToken } from '../auth/resolve.js'
import { authorize, type Role } from '../auth/authorize.js'
import { listProjects, getProjectBySlug, getProjectById, insertProject } from '../db/repositories/project.js'
import { listTasksByProject, getTaskByKey, getTaskById, insertTask } from '../db/repositories/task.js'
import { listCommentsByTask } from '../db/repositories/comment.js'
import { getLatestEvidenceByTask, listEvidenceByTask } from '../db/repositories/evidence.js'
import { listGitRefsByTask } from '../db/repositories/gitref.js'
import { listTransitionsByTask } from '../db/repositories/transition.js'
import { listActiveTokens } from '../db/repositories/token.js'
import { insertTransition } from '../db/repositories/transition.js'
import { mintToken as mintTokenFn, type Role as MintRole } from '../auth/mint.js'
import { propose, type TransitionRepository } from '../domain/gate.js'
import type { TaskState } from '../domain/statemachine.js'
import { handleSseStream, broadcastCreated, broadcastTransition, broadcastRemoved } from './stream.js'

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

function resolveProject(db: Db, ref: string) {
  const bySlug = getProjectBySlug(db, ref)
  if (bySlug) return bySlug
  const byId = getProjectById(db, ref)
  if (byId) return byId
  return null
}

function taskToResult(t: { id: string; project_id: string; key: string; title: string; body_md: string; state: string; allow_no_code_change: number; assignee_token_id: string | null; lease_until: string | null; created_at: string; updated_at: string }) {
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

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function handleGetProjects(db: Db, _query: Record<string, string>, auth: ResolvedToken, res: ServerResponse): void {
  if (!authorize(auth.role as Role, 'read')) {
    sendJson(res, 403, { error: 'Forbidden' }); return
  }
  const projects = listProjects(db)
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
  const proj = resolveProject(db, projectRef)
  if (!proj) {
    sendJson(res, 404, { error: `Project not found: ${projectRef}` }); return
  }
  const stateFilter = query['state']
  const tasks = listTasksByProject(db, proj.id, stateFilter)
  sendJson(res, 200, { tasks: tasks.map(taskToResult) })
}

function handleGetTaskDetail(db: Db, key: string, query: Record<string, string>, auth: ResolvedToken, res: ServerResponse): void {
  if (!authorize(auth.role as Role, 'read')) {
    sendJson(res, 403, { error: 'Forbidden' }); return
  }
  const projectRef = query['project']
  if (!projectRef) {
    sendJson(res, 400, { error: 'project query param is required' }); return
  }
  const proj = resolveProject(db, projectRef)
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
    task: taskToResult(task),
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
  const proj = resolveProject(db, projectRef)
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
  const tokens = listActiveTokens(db).map((t) => ({
    id: t.id,
    role: t.role,
    project_id: t.project_id,
    label: t.label,
    created_at: t.created_at,
    revoked_at: t.revoked_at,
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
  const result = mintTokenFn(db, role as MintRole, label, project ?? null)
  // SECURITY: secret is returned exactly once. Never log it.
  sendJson(res, 200, {
    id: result.tokenId,
    role,
    label,
    project: project ?? null,
    secret: result.secret,
  })
}

// Slugs become URL path segments (/<project-id>/index.html) — keep them path-safe.
const SLUG_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/

async function handleCreateProject(db: Db, _query: Record<string, string>, auth: ResolvedToken, req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Same permission as MCP project.create (human only).
  if (!authorize(auth.role as Role, 'task.create')) {
    sendJson(res, 403, { error: 'Forbidden' }); return
  }
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
  const proj = resolveProject(db, projectRef)
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
  })
  // Broadcast SSE 'created' event so live UI picks up the new task.
  broadcastCreated({
    task_id: task.id,
    project_id: proj.id,
    project: proj.slug,
    key: task.key,
    title: task.title,
    at: task.created_at,
  })
  sendJson(res, 201, { task: taskToResult(task) })
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
  const proj = resolveProject(db, projectRef)
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
  sendJson(res, 200, { task: updated ? taskToResult(updated) : null, transition: result.transition })
}

async function handleReset(db: Db, key: string, query: Record<string, string>, auth: ResolvedToken, _req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (auth.role !== 'human') {
    sendJson(res, 403, { error: 'Only human role can reset tasks' }); return
  }
  const projectRef = query['project']
  if (!projectRef) {
    sendJson(res, 400, { error: 'project query param is required' }); return
  }
  const proj = resolveProject(db, projectRef)
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
  sendJson(res, 200, { task: updated ? taskToResult(updated) : null })
}

async function handleRemove(db: Db, key: string, query: Record<string, string>, auth: ResolvedToken, _req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (auth.role !== 'human') {
    sendJson(res, 403, { error: 'Only human role can remove tasks' }); return
  }
  const projectRef = query['project']
  if (!projectRef) {
    sendJson(res, 400, { error: 'project query param is required' }); return
  }
  const proj = resolveProject(db, projectRef)
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

    // SSE stream — no auth required for read-only event subscription
    if (path === '/api/stream' && (req.method ?? 'GET').toUpperCase() === 'GET') {
      handleSseStream(req, res)
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

      sendJson(res, 404, { error: 'Not found' })
    } catch (err) {
      sendJson(res, 500, { error: 'Internal server error' })
    }
  }
}
