/**
 * api.test.ts — Smoke + AC5 tests for the REST API (TASK-009).
 *
 * Covers:
 *   - Smoke: GET /api/projects, /api/tasks, /api/tokens
 *   - Approve: POST /api/tasks/:key/approve persists JUDGE_PASSED → DONE
 *   - SSE: /api/stream emits transition events (text/event-stream)
 *   - 401: missing or invalid token returns 401
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Server } from 'node:http'
import { openMemoryDb } from '../src/db/connection.js'
import { runMigrations } from '../src/db/migrate.js'
import { createHttpServer } from '../src/http/server.js'
import { mintToken } from '../src/auth/mint.js'
import { bootstrapAdminToken } from '../src/auth/bootstrap.js'
import { insertProject } from '../src/db/repositories/project.js'
import { insertTask } from '../src/db/repositories/task.js'
import { _clearClients, getClientCount, sseBus } from '../src/api/stream.js'
import type { Db } from '../src/db/connection.js'

let server: Server
let baseUrl: string
let db: Db
let humanSecret: string
let implSecret: string
const PROJECT_ID = 'proj_test'
const TASK_ID = 'task_test_approve'
const TASK_KEY = 'TASK-099'

beforeAll(async () => {
  db = openMemoryDb()
  runMigrations(db)

  // Seed project + task in JUDGE_PASSED state
  insertProject(db, { id: PROJECT_ID, slug: 'test-proj', name: 'Test Project' })
  insertTask(db, {
    id: TASK_ID,
    project_id: PROJECT_ID,
    key: TASK_KEY,
    title: 'Approve test task',
    body_md: 'body',
    state: 'JUDGE_PASSED',
  })

  // Mint tokens
  const human = mintToken(db, 'human', 'test-human')
  humanSecret = human.secret
  const impl = mintToken(db, 'implementer', 'test-impl')
  implSecret = impl.secret

  // Bootstrap admin (idempotent)
  bootstrapAdminToken(db, 'admin-secret')

  server = createHttpServer(db)
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve())
  })
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
})

beforeEach(() => {
  _clearClients()
})

// ---------------------------------------------------------------------------
// AC5: 401 for missing token
// ---------------------------------------------------------------------------

describe('AC5: 401 for missing token', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await fetch(`${baseUrl}/api/projects`)
    expect(res.status).toBe(401)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toMatch(/[Mm]issing|[Aa]uthorization/)
  })

  it('returns 401 for invalid bearer token', async () => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      headers: { 'Authorization': 'Bearer totally-invalid-secret' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 for malformed Authorization header', async () => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      headers: { 'Authorization': 'Basic dXNlcjpwYXNz' },
    })
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Smoke: GET /api/projects, /api/tasks, /api/tokens
// ---------------------------------------------------------------------------

describe('Smoke: read endpoints', () => {
  const headers = () => ({ 'Authorization': `Bearer ${humanSecret}` })

  it('GET /api/projects returns project list', async () => {
    const res = await fetch(`${baseUrl}/api/projects`, { headers: headers() })
    expect(res.status).toBe(200)
    const body = await res.json() as { projects: Array<{ id: string }> }
    expect(body.projects).toBeDefined()
    expect(body.projects.length).toBeGreaterThanOrEqual(1)
    expect(body.projects.some((p) => p.id === PROJECT_ID)).toBe(true)
  })

  it('GET /api/tasks?project= returns tasks', async () => {
    const res = await fetch(`${baseUrl}/api/tasks?project=test-proj`, { headers: headers() })
    expect(res.status).toBe(200)
    const body = await res.json() as { tasks: Array<{ key: string; state: string }> }
    expect(body.tasks).toBeDefined()
    expect(body.tasks.some((t) => t.key === TASK_KEY)).toBe(true)
  })

  it('GET /api/tasks?project=&state= filters by state', async () => {
    const res = await fetch(`${baseUrl}/api/tasks?project=test-proj&state=JUDGE_PASSED`, { headers: headers() })
    expect(res.status).toBe(200)
    const body = await res.json() as { tasks: Array<{ key: string; state: string }> }
    expect(body.tasks.every((t) => t.state === 'JUDGE_PASSED')).toBe(true)
  })

  it('GET /api/tokens returns active tokens (no secret_hash)', async () => {
    const res = await fetch(`${baseUrl}/api/tokens`, { headers: headers() })
    expect(res.status).toBe(200)
    const body = await res.json() as { tokens: Array<{ id: string; role: string }> }
    expect(body.tokens).toBeDefined()
    expect(body.tokens.length).toBeGreaterThanOrEqual(1)
    // Verify secret_hash is NOT exposed
    const firstToken = body.tokens[0] as Record<string, unknown>
    expect(firstToken).not.toHaveProperty('secret_hash')
  })
})

// ---------------------------------------------------------------------------
// AC5: Approve persist JUDGE_PASSED → DONE
// ---------------------------------------------------------------------------

describe('AC5: approve human-only persists JUDGE_PASSED→DONE', () => {
  it('POST /api/tasks/:key/approve transitions task from JUDGE_PASSED to DONE', async () => {
    // Ensure task is in JUDGE_PASSED state
    const taskBefore = db.prepare('SELECT state FROM task WHERE id = ?').get(TASK_ID) as { state: string }
    expect(taskBefore.state).toBe('JUDGE_PASSED')

    const headers = {
      'Authorization': `Bearer ${humanSecret}`,
      'Content-Type': 'application/json',
    }
    const res = await fetch(
      `${baseUrl}/api/tasks/${TASK_KEY}/approve?project=test-proj`,
      { method: 'POST', headers, body: JSON.stringify({ note: 'Looks good' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json() as { task: { state: string }; transition: { from_state: string; to_state: string; actor_role: string } }
    expect(body.task.state).toBe('DONE')
    expect(body.transition.from_state).toBe('JUDGE_PASSED')
    expect(body.transition.to_state).toBe('DONE')
    expect(body.transition.actor_role).toBe('human')

    // Verify persistence: reload from DB
    const taskAfter = db.prepare('SELECT state FROM task WHERE id = ?').get(TASK_ID) as { state: string }
    expect(taskAfter.state).toBe('DONE')

    // Verify transition record was written
    const transitions = db.prepare('SELECT * FROM transition WHERE task_id = ? ORDER BY at DESC').all(TASK_ID) as Array<{ from_state: string; to_state: string; actor_role: string }>
    expect(transitions.length).toBeGreaterThanOrEqual(1)
    expect(transitions[0].from_state).toBe('JUDGE_PASSED')
    expect(transitions[0].to_state).toBe('DONE')
    expect(transitions[0].actor_role).toBe('human')
  })

  it('rejects approve from non-human role (implementer)', async () => {
    // Reset task state back to JUDGE_PASSED for this test
    db.prepare(`UPDATE task SET state = 'JUDGE_PASSED' WHERE id = ?`).run(TASK_ID)

    const headers = {
      'Authorization': `Bearer ${implSecret}`,
      'Content-Type': 'application/json',
    }
    const res = await fetch(
      `${baseUrl}/api/tasks/${TASK_KEY}/approve?project=test-proj`,
      { method: 'POST', headers, body: JSON.stringify({}) },
    )
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// AC5: SSE /api/stream emits transition events
// ---------------------------------------------------------------------------

describe('AC5: SSE stream emits events', () => {
  it('GET /api/stream returns text/event-stream content-type', async () => {
    const controller = new AbortController()
    const resPromise = fetch(`${baseUrl}/api/stream`, {
      headers: { 'Accept': 'text/event-stream' },
      signal: controller.signal,
    })

    const res = await resPromise
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)

    // Read a chunk to verify SSE format
    const reader = res.body!.getReader()
    const { value } = await reader.read()
    const text = new TextDecoder().decode(value)
    expect(text).toContain('event: connected')

    controller.abort()
    await reader.cancel().catch(() => {})
  })

  it('SSE clients receive transition events', async () => {
    // Connect an SSE client
    const controller = new AbortController()
    await fetch(`${baseUrl}/api/stream`, {
      headers: { 'Accept': 'text/event-stream' },
      signal: controller.signal,
    })
    // Give time for connection registration
    await new Promise((r) => setTimeout(r, 100))
    expect(getClientCount()).toBeGreaterThanOrEqual(1)

    // Listen for the event via the bus
    const evtPromise = new Promise<{ task_id: string; key: string; to_state: string }>((resolve) => {
      sseBus.once('transition', resolve)
    })

    // Emit a test transition
    const { broadcastTransition } = await import('../src/api/stream.js')
    broadcastTransition({
      task_id: 'test-task',
      project: 'test-proj',
      key: 'TEST-1',
      from_state: 'TODO',
      to_state: 'IN_PROGRESS',
      actor_role: 'implementer',
      at: new Date().toISOString(),
    })

    const evt = await evtPromise
    expect(evt.task_id).toBe('test-task')
    expect(evt.key).toBe('TEST-1')
    expect(evt.to_state).toBe('IN_PROGRESS')

    controller.abort()
  })
})

// ---------------------------------------------------------------------------
// TASK-025: reset/remove broadcast SSE events (human actions go live)
// ---------------------------------------------------------------------------

describe('TASK-025: reset and remove broadcast SSE events', () => {
  it('POST /api/tasks/:key/reset broadcasts a transition event with key and to_state IN_PROGRESS', async () => {
    insertTask(db, {
      id: 'task_reset_sse',
      project_id: PROJECT_ID,
      key: 'TASK-RESET-1',
      title: 'Reset broadcast test',
      body_md: '',
      state: 'JUDGE_REJECTED',
    })

    const evtPromise = new Promise<{ task_id: string; key: string; from_state: string; to_state: string }>((resolve) => {
      sseBus.once('transition', resolve)
    })

    const res = await fetch(`${baseUrl}/api/tasks/TASK-RESET-1/reset?project=test-proj`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${humanSecret}` },
    })
    expect(res.status).toBe(200)

    const evt = await evtPromise
    expect(evt.task_id).toBe('task_reset_sse')
    expect(evt.key).toBe('TASK-RESET-1')
    expect(evt.from_state).toBe('JUDGE_REJECTED')
    expect(evt.to_state).toBe('IN_PROGRESS')
  })

  it('POST /api/tasks/:key/remove broadcasts a removed event with project and key', async () => {
    insertTask(db, {
      id: 'task_remove_sse',
      project_id: PROJECT_ID,
      key: 'TASK-REMOVE-1',
      title: 'Remove broadcast test',
      body_md: '',
      state: 'TODO',
    })

    const evtPromise = new Promise<{ task_id: string; project: string; key: string; at: string }>((resolve) => {
      sseBus.once('removed', resolve)
    })

    const res = await fetch(`${baseUrl}/api/tasks/TASK-REMOVE-1/remove?project=test-proj`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${humanSecret}` },
    })
    expect(res.status).toBe(200)

    const evt = await evtPromise
    expect(evt.task_id).toBe('task_remove_sse')
    expect(evt.project).toBe('test-proj')
    expect(evt.key).toBe('TASK-REMOVE-1')
    expect(typeof evt.at).toBe('string')
  })
})

// ---------------------------------------------------------------------------
// GET /api/tasks/:key (detail)
// ---------------------------------------------------------------------------

describe('GET /api/tasks/:key', () => {
  it('returns task detail with gitrefs, evidence, comments, timeline', async () => {
    const headers = { 'Authorization': `Bearer ${humanSecret}` }
    const res = await fetch(`${baseUrl}/api/tasks/${TASK_KEY}?project=test-proj`, { headers })
    expect(res.status).toBe(200)
    const body = await res.json() as {
      task: { key: string; state: string }
      gitrefs: unknown[]
      evidence: unknown
      comments: unknown[]
      timeline: unknown[]
    }
    expect(body.task.key).toBe(TASK_KEY)
    expect(body.gitrefs).toBeDefined()
    expect(body.comments).toBeDefined()
    expect(body.timeline).toBeDefined()
  })

  it('returns 404 for unknown task', async () => {
    const headers = { 'Authorization': `Bearer ${humanSecret}` }
    const res = await fetch(`${baseUrl}/api/tasks/TASK-NONE?project=test-proj`, { headers })
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// GET /api/evidence/:key
// ---------------------------------------------------------------------------

describe('GET /api/evidence/:key', () => {
  it('returns evidence list for a task', async () => {
    const headers = { 'Authorization': `Bearer ${humanSecret}` }
    const res = await fetch(`${baseUrl}/api/evidence/${TASK_KEY}?project=test-proj`, { headers })
    expect(res.status).toBe(200)
    const body = await res.json() as { evidence: unknown[] }
    expect(body.evidence).toBeDefined()
    expect(Array.isArray(body.evidence)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// TASK-063: human reject at the review stage (JUDGE_PASSED/READY_TO_REVIEW
// -> JUDGE_REJECTED). The reject edge carries NO judge verdict comment, so it
// must pass the gate; a note is mandatory and is recorded as a comment.
// ---------------------------------------------------------------------------

describe('TASK-063: human reject JUDGE_PASSED/READY_TO_REVIEW -> JUDGE_REJECTED', () => {
  const REJ_PROJECT = 'test-proj'

  function seedRejectTask(id: string, key: string, state: string): void {
    db.prepare('DELETE FROM task WHERE id = ?').run(id)
    insertTask(db, { id, project_id: PROJECT_ID, key, title: 'Reject test', body_md: 'b', state: state as 'JUDGE_PASSED' })
  }

  it('POST /reject from JUDGE_PASSED transitions to JUDGE_REJECTED WITHOUT a judge verdict comment', async () => {
    const id = 'task_reject_jp', key = 'TASK-REJ-1'
    seedRejectTask(id, key, 'JUDGE_PASSED')
    const res = await fetch(`${baseUrl}/api/tasks/${key}/reject?project=${REJ_PROJECT}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${humanSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'Please add an integration test before merge.' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { task: { state: string }; transition: { from_state: string; to_state: string; actor_role: string } }
    expect(body.task.state).toBe('JUDGE_REJECTED')
    expect(body.transition.from_state).toBe('JUDGE_PASSED')
    expect(body.transition.to_state).toBe('JUDGE_REJECTED')
    expect(body.transition.actor_role).toBe('human')

    // The note is recorded as a comment the implementer can read.
    const comments = db.prepare('SELECT body_md, author_role FROM comment WHERE task_id = ?').all(id) as Array<{ body_md: string; author_role: string }>
    expect(comments.some((c) => c.body_md.includes('integration test') && c.author_role === 'human')).toBe(true)
  })

  it('POST /reject from READY_TO_REVIEW also transitions to JUDGE_REJECTED', async () => {
    const id = 'task_reject_rtr', key = 'TASK-REJ-2'
    seedRejectTask(id, key, 'READY_TO_REVIEW')
    const res = await fetch(`${baseUrl}/api/tasks/${key}/reject?project=${REJ_PROJECT}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${humanSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'Rework required.' }),
    })
    expect(res.status).toBe(200)
    const taskAfter = db.prepare('SELECT state FROM task WHERE id = ?').get(id) as { state: string }
    expect(taskAfter.state).toBe('JUDGE_REJECTED')
  })

  it('rejects with 400 when note is missing/empty', async () => {
    const id = 'task_reject_nonote', key = 'TASK-REJ-3'
    seedRejectTask(id, key, 'JUDGE_PASSED')
    const res = await fetch(`${baseUrl}/api/tasks/${key}/reject?project=${REJ_PROJECT}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${humanSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: '   ' }),
    })
    expect(res.status).toBe(400)
    // State unchanged.
    const taskAfter = db.prepare('SELECT state FROM task WHERE id = ?').get(id) as { state: string }
    expect(taskAfter.state).toBe('JUDGE_PASSED')
  })

  it('rejects non-human role (implementer) with 403', async () => {
    const id = 'task_reject_role', key = 'TASK-REJ-4'
    seedRejectTask(id, key, 'JUDGE_PASSED')
    const res = await fetch(`${baseUrl}/api/tasks/${key}/reject?project=${REJ_PROJECT}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${implSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'should not pass' }),
    })
    expect(res.status).toBe(403)
  })

  it('rejects wrong state (IN_PROGRESS) with 409', async () => {
    const id = 'task_reject_state', key = 'TASK-REJ-5'
    seedRejectTask(id, key, 'IN_PROGRESS')
    const res = await fetch(`${baseUrl}/api/tasks/${key}/reject?project=${REJ_PROJECT}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${humanSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'too early' }),
    })
    expect(res.status).toBe(409)
  })
})
