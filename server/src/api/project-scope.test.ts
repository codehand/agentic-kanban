/**
 * project-scope.test.ts — TASK-042 full case matrix for token project_scope
 * enforcement and revocation, across BOTH transports (JSON API + MCP).
 *
 *   A. project_scope — JSON API (A1–A8, incl. real SSE stream, not mocked)
 *   B. revocation (B1–B3: 401 on JSON API + MCP, immediate effect)
 *   C. project_scope — MCP parity (C1–C3)
 *   D. baseline (D1 invalid secret 401 both transports, D3 mint with scope)
 *
 * Every "blocked" case has a positive control: the same operation succeeds on
 * the token's own project before we assert it is blocked on the other project.
 *
 * Runs a real node:http server (API + MCP + SSE) over an in-memory SQLite DB.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Server } from 'node:http'
import { openMemoryDb, type Db } from '../db/connection.js'
import { runMigrations } from '../db/migrate.js'
import { createHttpServer } from '../http/server.js'
import { mintToken } from '../auth/mint.js'
import { insertProject } from '../db/repositories/project.js'
import { insertTask, getTaskByKey } from '../db/repositories/task.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const ALPHA_ID = 'proj_alpha'
const BETA_ID = 'proj_beta'

let db: Db
let server: Server
let baseUrl: string

let humanGlobal: { tokenId: string; secret: string }   // unscoped human
let humanAlpha: { tokenId: string; secret: string }    // human scoped to alpha
let implAlpha: { tokenId: string; secret: string }     // implementer scoped to alpha

beforeAll(async () => {
  db = openMemoryDb()
  runMigrations(db)

  insertProject(db, { id: ALPHA_ID, slug: 'alpha', name: 'Alpha' })
  insertProject(db, { id: BETA_ID, slug: 'beta', name: 'Beta' })

  // Seed tasks. Dedicated rows per case group so blocked-path checks are not
  // perturbed by earlier tests.
  insertTask(db, { id: 'task_A1', project_id: ALPHA_ID, key: 'A-1', title: 'Alpha task' })
  insertTask(db, { id: 'task_ARESET', project_id: ALPHA_ID, key: 'A-RESET', title: 'Alpha resettable', state: 'JUDGE_REJECTED' })
  insertTask(db, { id: 'task_ADEL', project_id: ALPHA_ID, key: 'A-DEL', title: 'Alpha removable' })
  insertTask(db, { id: 'task_ACLAIM', project_id: ALPHA_ID, key: 'A-CLAIM', title: 'Alpha claimable' })
  insertTask(db, { id: 'task_B1', project_id: BETA_ID, key: 'B-1', title: 'Beta task' })
  insertTask(db, { id: 'task_BRESET', project_id: BETA_ID, key: 'B-RESET', title: 'Beta resettable', state: 'JUDGE_REJECTED' })
  insertTask(db, { id: 'task_BDEL', project_id: BETA_ID, key: 'B-DEL', title: 'Beta removable' })

  // mintToken stores project_id as given — use the canonical project id,
  // exactly what POST /api/tokens now stores after slug resolution.
  humanGlobal = mintToken(db, 'human', 'human-global')
  humanAlpha = mintToken(db, 'human', 'human-alpha', ALPHA_ID)
  implAlpha = mintToken(db, 'implementer', 'impl-alpha', ALPHA_ID)

  server = createHttpServer(db)
  await new Promise<void>((resolve) => server.listen(0, () => resolve()))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
})

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function authHeaders(secret: string): Record<string, string> {
  return { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }
}

const get = (path: string, secret: string) =>
  fetch(`${baseUrl}${path}`, { headers: authHeaders(secret) })

const post = (path: string, secret: string, body?: unknown) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: authHeaders(secret),
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const patch = (path: string, secret: string, body: unknown) =>
  fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: authHeaders(secret),
    body: JSON.stringify(body),
  })

const del = (path: string, secret: string) =>
  fetch(`${baseUrl}${path}`, { method: 'DELETE', headers: authHeaders(secret) })

/** Assert a scope-403: status, generic message, no leak of the other project. */
async function expectScope403(res: Response): Promise<void> {
  expect(res.status).toBe(403)
  const text = await res.text()
  const body = JSON.parse(text) as { error: string }
  expect(body.error).toMatch(/scope/i)
  // Must not leak names/existence of out-of-scope resources.
  expect(text).not.toContain('beta')
  expect(text).not.toContain('B-1')
  expect(text).not.toContain(BETA_ID)
}

/** Connect an MCP SDK client with the given bearer secret. */
async function makeMcpClient(secret: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${secret}` } },
  })
  const client = new Client({ name: 'scope-test', version: '0.0.1' })
  await client.connect(transport)
  return client
}

interface ToolResult { isError?: boolean; content?: Array<{ type: string; text?: string }> }

function toolText(result: ToolResult): string {
  return (result.content ?? []).map((c) => c.text ?? '').join(' ')
}

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult
}

/** Raw MCP initialize over HTTP — used where we only care about the HTTP status. */
async function mcpInitialize(secret: string): Promise<number> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } },
    }),
  })
  await res.body?.cancel()
  return res.status
}

async function waitFor(cond: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('timeout waiting for condition')
    await new Promise((r) => setTimeout(r, 25))
  }
}

/** Open a REAL SSE connection (fetch + ReadableStream — not mocked). */
async function openSse(secret?: string): Promise<{ buf: () => string; close: () => void }> {
  const ctrl = new AbortController()
  const headers: Record<string, string> = {}
  if (secret) headers['Authorization'] = `Bearer ${secret}`
  const res = await fetch(`${baseUrl}/api/stream`, { headers, signal: ctrl.signal })
  expect(res.status).toBe(200)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  const state = { buf: '' }
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        state.buf += decoder.decode(value, { stream: true })
      }
    } catch {
      /* aborted at end of test */
    }
  })()
  // Server greets every accepted connection.
  await waitFor(() => state.buf.includes('event: connected'))
  return { buf: () => state.buf, close: () => ctrl.abort() }
}

// ---------------------------------------------------------------------------
// A. project_scope — JSON API
// ---------------------------------------------------------------------------

describe('A. project_scope enforcement — JSON API', () => {
  it('A1: scoped GET /api/tasks is filtered — own project visible, other project empty (no 403, no leak)', async () => {
    // Positive control: own project lists its tasks.
    const own = await get('/api/tasks?project=alpha', humanAlpha.secret)
    expect(own.status).toBe(200)
    const ownBody = await own.json() as { tasks: Array<{ key: string; project_id: string }> }
    expect(ownBody.tasks.length).toBeGreaterThan(0)
    expect(ownBody.tasks.some((t) => t.key === 'A-1')).toBe(true)
    for (const t of ownBody.tasks) expect(t.project_id).toBe(ALPHA_ID)

    // List endpoints FILTER instead of 403: other project yields an empty list.
    const other = await get('/api/tasks?project=beta', humanAlpha.secret)
    expect(other.status).toBe(200)
    const otherText = await other.text()
    expect(JSON.parse(otherText)).toEqual({ tasks: [] })
    expect(otherText).not.toContain('B-1')
  })

  it('A2: scoped GET /api/tasks/:key of the other project → 403 (own project → 200)', async () => {
    // Positive control first: the same token CAN read its own project's task.
    const own = await get('/api/tasks/A-1?project=alpha', humanAlpha.secret)
    expect(own.status).toBe(200)

    const blocked = await get('/api/tasks/B-1?project=beta', humanAlpha.secret)
    await expectScope403(blocked)
  })

  it('A3: scoped GET /api/evidence/:key of the other project → 403 (own project → 200)', async () => {
    const own = await get('/api/evidence/A-1?project=alpha', humanAlpha.secret)
    expect(own.status).toBe(200)

    const blocked = await get('/api/evidence/B-1?project=beta', humanAlpha.secret)
    await expectScope403(blocked)
  })

  it('A4a: scoped PATCH on the other project task → 403; own project → 200', async () => {
    // Positive control: implementer scoped to alpha can PATCH alpha's task.
    const own = await patch('/api/tasks/A-1?project=alpha', implAlpha.secret, { priority: 'P1' })
    expect(own.status).toBe(200)
    const ownBody = await own.json() as { task: { priority: string } }
    expect(ownBody.task.priority).toBe('P1')

    const blocked = await patch('/api/tasks/B-1?project=beta', implAlpha.secret, { priority: 'P1' })
    await expectScope403(blocked)
    // DB unchanged for the out-of-scope task.
    expect(getTaskByKey(db, BETA_ID, 'B-1')!.priority).toBeNull()
  })

  it('A4b: scoped transition (reset) on the other project task → 403; own project → 200', async () => {
    // Positive control: scoped human resets its own JUDGE_REJECTED task.
    const own = await post('/api/tasks/A-RESET/reset?project=alpha', humanAlpha.secret)
    expect(own.status).toBe(200)
    expect(getTaskByKey(db, ALPHA_ID, 'A-RESET')!.state).toBe('IN_PROGRESS')

    const blocked = await post('/api/tasks/B-RESET/reset?project=beta', humanAlpha.secret)
    await expectScope403(blocked)
    expect(getTaskByKey(db, BETA_ID, 'B-RESET')!.state).toBe('JUDGE_REJECTED') // unchanged
  })

  it('A4c: scoped remove on the other project task → 403; own project → 200', async () => {
    const own = await post('/api/tasks/A-DEL/remove?project=alpha', humanAlpha.secret)
    expect(own.status).toBe(200)
    expect(getTaskByKey(db, ALPHA_ID, 'A-DEL')).toBeUndefined()

    const blocked = await post('/api/tasks/B-DEL/remove?project=beta', humanAlpha.secret)
    await expectScope403(blocked)
    expect(getTaskByKey(db, BETA_ID, 'B-DEL')).toBeDefined() // still there
  })

  it('A5: scoped POST /api/tasks into the other project → 403; own project → 201', async () => {
    const own = await post('/api/tasks', humanAlpha.secret, { project: 'alpha', key: 'A-NEW', title: 'created in scope' })
    expect(own.status).toBe(201)
    expect(getTaskByKey(db, ALPHA_ID, 'A-NEW')).toBeDefined()

    const blocked = await post('/api/tasks', humanAlpha.secret, { project: 'beta', key: 'B-NEW', title: 'cross-scope create' })
    await expectScope403(blocked)
    expect(getTaskByKey(db, BETA_ID, 'B-NEW')).toBeUndefined()
  })

  it('A6: scoped GET /api/projects → only the scoped project', async () => {
    const res = await get('/api/projects', humanAlpha.secret)
    expect(res.status).toBe(200)
    const body = await res.json() as { projects: Array<{ id: string; slug: string }> }
    expect(body.projects).toHaveLength(1)
    expect(body.projects[0]!.id).toBe(ALPHA_ID)
  })

  it('A7: unscoped token sees and touches every project (regression)', async () => {
    const projects = await get('/api/projects', humanGlobal.secret)
    const projBody = await projects.json() as { projects: Array<{ id: string }> }
    expect(projBody.projects.map((p) => p.id).sort()).toEqual([ALPHA_ID, BETA_ID])

    const betaTasks = await get('/api/tasks?project=beta', humanGlobal.secret)
    expect(betaTasks.status).toBe(200)
    const betaBody = await betaTasks.json() as { tasks: Array<{ key: string }> }
    expect(betaBody.tasks.some((t) => t.key === 'B-1')).toBe(true)

    const detail = await get('/api/tasks/B-1?project=beta', humanGlobal.secret)
    expect(detail.status).toBe(200)
  })

  it('A8: SSE — scoped connection receives in-scope events but NEVER out-of-scope ones (real stream)', async () => {
    const scoped = await openSse(humanAlpha.secret)
    const unscoped = await openSse(humanGlobal.secret)
    try {
      // Emit a beta event FIRST, then an alpha event, through the real write
      // path (task creation broadcasts 'created' on /api/stream).
      const betaRes = await post('/api/tasks', humanGlobal.secret, { project: 'beta', key: 'SSE-B', title: 'beta sse probe' })
      expect(betaRes.status).toBe(201)
      const alphaRes = await post('/api/tasks', humanGlobal.secret, { project: 'alpha', key: 'SSE-A', title: 'alpha sse probe' })
      expect(alphaRes.status).toBe(201)

      // In-scope event IS delivered to the scoped connection…
      await waitFor(() => scoped.buf().includes('"key":"SSE-A"'))
      // …and since SSE frames are delivered in order, the earlier beta event
      // would already be in the buffer if it had been sent. It must not be.
      expect(scoped.buf()).not.toContain('SSE-B')

      // Control: the unscoped connection received BOTH events.
      await waitFor(() => unscoped.buf().includes('"key":"SSE-A"'))
      expect(unscoped.buf()).toContain('"key":"SSE-B"')
    } finally {
      scoped.close()
      unscoped.close()
    }
  })

  it('scoped token cannot create projects (global resource) → 403', async () => {
    const blocked = await post('/api/projects', humanAlpha.secret, { slug: 'gamma', name: 'Gamma' })
    expect(blocked.status).toBe(403)
    const body = await blocked.json() as { error: string }
    expect(body.error).toMatch(/scope/i)

    // Positive control: the unscoped human can.
    const ok = await post('/api/projects', humanGlobal.secret, { slug: 'gamma', name: 'Gamma' })
    expect(ok.status).toBe(201)
  })
})

// ---------------------------------------------------------------------------
// B. Revocation
// ---------------------------------------------------------------------------

describe('B. revocation — 401 on both transports, immediate effect', () => {
  it('B1+B3: JSON API — request OK, then revoke, then next request is 401 (immediate, no cache)', async () => {
    const mint = await post('/api/tokens', humanGlobal.secret, { role: 'implementer', label: 'revoke-json' })
    expect(mint.status).toBe(200)
    const minted = await mint.json() as { id: string; secret: string }

    // Works before revocation (positive control).
    const before = await get('/api/tasks?project=alpha', minted.secret)
    expect(before.status).toBe(200)

    // Revoke through the API.
    const revoked = await del(`/api/tokens/${minted.id}`, humanGlobal.secret)
    expect(revoked.status).toBe(200)

    // The very next request must be rejected.
    const after = await get('/api/tasks?project=alpha', minted.secret)
    expect(after.status).toBe(401)
  })

  it('B2: MCP — initialize succeeds before revoke and is rejected with 401 after', async () => {
    const mint = await post('/api/tokens', humanGlobal.secret, { role: 'implementer', label: 'revoke-mcp' })
    expect(mint.status).toBe(200)
    const minted = await mint.json() as { id: string; secret: string }

    expect(await mcpInitialize(minted.secret)).toBe(200)

    const revoked = await del(`/api/tokens/${minted.id}`, humanGlobal.secret)
    expect(revoked.status).toBe(200)

    expect(await mcpInitialize(minted.secret)).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// C. project_scope — MCP parity
// ---------------------------------------------------------------------------

describe('C. project_scope enforcement — MCP tools', () => {
  it('C1: scoped MCP read tools — project.list filtered; task.list works in scope, scope-errors out of scope', async () => {
    const client = await makeMcpClient(implAlpha.secret)
    try {
      const projects = await callTool(client, 'project.list')
      expect(projects.isError).toBeFalsy()
      const projRows = JSON.parse(toolText(projects)) as Array<{ id: string }>
      expect(projRows.map((p) => p.id)).toEqual([ALPHA_ID])

      // Positive control: own project's tasks are readable.
      const own = await callTool(client, 'task.list', { project: 'alpha' })
      expect(own.isError).toBeFalsy()
      const ownRows = JSON.parse(toolText(own)) as Array<{ project_id: string }>
      expect(ownRows.length).toBeGreaterThan(0)
      for (const t of ownRows) expect(t.project_id).toBe(ALPHA_ID)

      // Out-of-scope read → clean scope error, no leak of beta's data.
      const blocked = await callTool(client, 'task.list', { project: 'beta' })
      expect(blocked.isError).toBe(true)
      expect(toolText(blocked)).toMatch(/scope/i)
      expect(toolText(blocked)).not.toContain('B-1')
    } finally {
      await client.close()
    }
  })

  it('C2: scoped MCP write tools — own project succeeds; other project → scope error, DB unchanged', async () => {
    const client = await makeMcpClient(implAlpha.secret)
    try {
      // Positive control: claim + transition the in-scope task.
      const claimOwn = await callTool(client, 'task.claim', { project: 'alpha', key: 'A-CLAIM' })
      expect(claimOwn.isError).toBeFalsy()
      const transitionOwn = await callTool(client, 'task.transition', {
        project: 'alpha', key: 'A-CLAIM', from: 'TODO', to: 'IN_PROGRESS',
      })
      expect(transitionOwn.isError).toBeFalsy()
      expect(getTaskByKey(db, ALPHA_ID, 'A-CLAIM')!.state).toBe('IN_PROGRESS')

      // Blocked: claim on the other project's task — scope error, not a crash.
      const claimBlocked = await callTool(client, 'task.claim', { project: 'beta', key: 'B-1' })
      expect(claimBlocked.isError).toBe(true)
      expect(toolText(claimBlocked)).toMatch(/scope/i)
      expect(getTaskByKey(db, BETA_ID, 'B-1')!.assignee_token_id).toBeNull() // DB unchanged

      // Blocked: transition on the other project's task.
      const transitionBlocked = await callTool(client, 'task.transition', {
        project: 'beta', key: 'B-1', from: 'TODO', to: 'IN_PROGRESS',
      })
      expect(transitionBlocked.isError).toBe(true)
      expect(toolText(transitionBlocked)).toMatch(/scope/i)
      expect(getTaskByKey(db, BETA_ID, 'B-1')!.state).toBe('TODO') // DB unchanged

    } finally {
      await client.close()
    }

    // Blocked: project.create is global → a scoped token may not, even with a
    // role (human) that passes the role check. Scope is what blocks it.
    const humanScopedClient = await makeMcpClient(humanAlpha.secret)
    try {
      const createBlocked = await callTool(humanScopedClient, 'project.create', { slug: 'delta', name: 'Delta' })
      expect(createBlocked.isError).toBe(true)
      expect(toolText(createBlocked)).toMatch(/scope/i)
    } finally {
      await humanScopedClient.close()
    }
  })

  it('C3: unscoped token over MCP — unchanged behavior (regression)', async () => {
    const client = await makeMcpClient(humanGlobal.secret)
    try {
      const projects = await callTool(client, 'project.list')
      expect(projects.isError).toBeFalsy()
      const rows = JSON.parse(toolText(projects)) as Array<{ id: string }>
      expect(rows.map((p) => p.id)).toContain(ALPHA_ID)
      expect(rows.map((p) => p.id)).toContain(BETA_ID)

      const betaTask = await callTool(client, 'task.get', { project: 'beta', key: 'B-1' })
      expect(betaTask.isError).toBeFalsy()
      expect(toolText(betaTask)).toContain('"key": "B-1"')
    } finally {
      await client.close()
    }
  })
})

// ---------------------------------------------------------------------------
// D. Baseline
// ---------------------------------------------------------------------------

describe('D. baseline — invalid secrets and scoped mint', () => {
  it('D1: invalid/missing secret → 401 on JSON API and on MCP', async () => {
    const api = await get('/api/tasks?project=alpha', 'not-a-real-secret')
    expect(api.status).toBe(401)

    const apiNoAuth = await fetch(`${baseUrl}/api/tasks?project=alpha`)
    expect(apiNoAuth.status).toBe(401)

    expect(await mcpInitialize('not-a-real-secret')).toBe(401)
  })

  it('D3: mint with project scope stores the resolved project_id and GET /api/tokens shows it', async () => {
    const mint = await post('/api/tokens', humanGlobal.secret, {
      role: 'implementer', label: 'scoped-mint', project: 'alpha', // slug in, id stored
    })
    expect(mint.status).toBe(200)
    const minted = await mint.json() as { id: string; project: string; secret: string }
    expect(minted.project).toBe(ALPHA_ID)

    // DB row carries the canonical project_id (token.project_id = project_scope).
    const row = db.prepare(`SELECT project_id FROM token WHERE id = ?`).get(minted.id) as { project_id: string }
    expect(row.project_id).toBe(ALPHA_ID)

    // Token listing surfaces the scope.
    const list = await get('/api/tokens', humanGlobal.secret)
    expect(list.status).toBe(200)
    const tokens = (await list.json() as { tokens: Array<{ id: string; project_id: string | null }> }).tokens
    expect(tokens.find((t) => t.id === minted.id)!.project_id).toBe(ALPHA_ID)

    // And the minted token actually enforces: own project readable, other filtered.
    const own = await get('/api/tasks?project=alpha', minted.secret)
    expect(own.status).toBe(200)
    const other = await get('/api/tasks?project=beta', minted.secret)
    expect(other.status).toBe(200)
    expect(await other.json()).toEqual({ tasks: [] })

    // Minting an unknown project is rejected up front.
    const bad = await post('/api/tokens', humanGlobal.secret, { role: 'runner', label: 'bad-scope', project: 'no-such-project' })
    expect(bad.status).toBe(400)
  })
})
