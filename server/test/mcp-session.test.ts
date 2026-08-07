/**
 * mcp-session.test.ts — session routing on /mcp.
 *
 * Covers the seam no existing test touched: what the route answers for an
 * Mcp-Session-Id it does not recognise.
 *
 *   - unknown/expired session id  → 404 (was 400). 404 is the spec's signal
 *     that the client must reopen a session; 400 lets a client replay a dead
 *     id forever, so every tool call after a hub restart failed until the
 *     client process was restarted.
 *   - missing session id          → 400, unchanged.
 *   - initialize carrying a stale id → new session, not a rejection. This is
 *     the recovery path that does not depend on the client honouring the 404.
 *   - a session id presented by a different token → 404, never that session.
 *     Tool handlers close over the auth context captured at initialize, so
 *     serving it would run the call with the opening token's role.
 *   - McpServer is built once per session, not once per request.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'

// Counts McpServer constructions so the per-request-build regression is
// observable. The subclass changes no behaviour.
const counter = vi.hoisted(() => ({ builds: 0 }))
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', async () => {
  const actual = await vi.importActual<typeof import('@modelcontextprotocol/sdk/server/mcp.js')>(
    '@modelcontextprotocol/sdk/server/mcp.js',
  )
  class CountingMcpServer extends actual.McpServer {
    constructor(...args: ConstructorParameters<typeof actual.McpServer>) {
      super(...args)
      counter.builds++
    }
  }
  return { ...actual, McpServer: CountingMcpServer }
})

const { openMemoryDb } = await import('../src/db/connection.js')
const { runMigrations } = await import('../src/db/migrate.js')
const { mintToken } = await import('../src/auth/mint.js')
const { mountMcpRoute } = await import('../src/mcp/server.js')
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')

type Db = ReturnType<typeof openMemoryDb>
type ClientTransport = InstanceType<typeof StreamableHTTPClientTransport>

let db: Db
let server: Server
let baseUrl: string
let humanSecret: string
let implSecret: string
const PROJECT_ID = 'proj_session'
const SLUG = 'session-proj'

const ACCEPT = 'application/json, text/event-stream'

function initBody(): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'session-test', version: '0.0.1' },
    },
  })
}

function listBody(): string {
  return JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
}

/** Raw request to /mcp; drains the body so SSE responses do not leak sockets. */
async function call(
  method: string,
  opts: { secret: string; sessionId?: string; body?: string } ,
): Promise<{ status: number; sessionId: string | null; json: unknown }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.secret}`,
    Accept: ACCEPT,
    'Content-Type': 'application/json',
  }
  if (opts.sessionId !== undefined) headers['Mcp-Session-Id'] = opts.sessionId

  const res = await fetch(`${baseUrl}/mcp`, { method, headers, body: opts.body })
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json')
  let json: unknown = null
  if (isJson) json = await res.json()
  else await res.body?.cancel()

  return { status: res.status, sessionId: res.headers.get('mcp-session-id'), json }
}

function errCode(json: unknown): number | undefined {
  return (json as { error?: { code?: number } } | null)?.error?.code
}

/** A real SDK session, so tests get a session id the server actually knows. */
async function openSession(secret: string): Promise<{ client: InstanceType<typeof Client>; transport: ClientTransport }> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${secret}` } },
  })
  const client = new Client({ name: 'session-test', version: '0.0.1' })
  await client.connect(transport)
  return { client, transport }
}

async function closeSession(s: { client: InstanceType<typeof Client>; transport: ClientTransport }): Promise<void> {
  try { await s.client.close() } catch { /* already closed */ }
  try { await s.transport.close() } catch { /* already closed */ }
}

beforeAll(async () => {
  db = openMemoryDb()
  runMigrations(db)
  db.prepare(`INSERT INTO project (id, slug, name) VALUES (?, ?, 'Session Project')`).run(PROJECT_ID, SLUG)
  humanSecret = mintToken(db, 'human', 'test-human').secret
  implSecret = mintToken(db, 'implementer', 'test-impl').secret

  const baseRouter = (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(404)
    res.end()
  }
  server = createServer(mountMcpRoute(baseRouter, db))
  await new Promise<void>((resolve) => server.listen(0, () => resolve()))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
})

describe('unknown Mcp-Session-Id → 404', () => {
  it('POST with an unrecognised session id answers 404, not 400', async () => {
    const r = await call('POST', { secret: humanSecret, sessionId: randomUUID(), body: listBody() })
    expect(r.status).toBe(404)
    expect(errCode(r.json)).toBe(-32001)
  })

  it('GET with an unrecognised session id answers 404', async () => {
    const r = await call('GET', { secret: humanSecret, sessionId: randomUUID() })
    expect(r.status).toBe(404)
    expect(errCode(r.json)).toBe(-32001)
  })

  it('DELETE with an unrecognised session id answers 404', async () => {
    const r = await call('DELETE', { secret: humanSecret, sessionId: randomUUID() })
    expect(r.status).toBe(404)
    expect(errCode(r.json)).toBe(-32001)
  })
})

describe('missing Mcp-Session-Id → 400', () => {
  it('POST without a session id on a non-initialize request answers 400', async () => {
    const r = await call('POST', { secret: humanSecret, body: listBody() })
    expect(r.status).toBe(400)
    expect(errCode(r.json)).toBe(-32600)
  })

  it('GET without a session id answers 400', async () => {
    const r = await call('GET', { secret: humanSecret })
    expect(r.status).toBe(400)
    expect(errCode(r.json)).toBe(-32600)
  })

  it('DELETE without a session id answers 400', async () => {
    const r = await call('DELETE', { secret: humanSecret })
    expect(r.status).toBe(400)
    expect(errCode(r.json)).toBe(-32600)
  })
})

describe('recovery: initialize is honoured despite a stale session id', () => {
  it('opens a new session when initialize carries a dead session id', async () => {
    const dead = randomUUID()
    const r = await call('POST', { secret: humanSecret, sessionId: dead, body: initBody() })
    expect(r.status).toBe(200)
    expect(r.sessionId).toBeTruthy()
    expect(r.sessionId).not.toBe(dead)
  })

  it('still opens a session when initialize carries no session id', async () => {
    const r = await call('POST', { secret: humanSecret, body: initBody() })
    expect(r.status).toBe(200)
    expect(r.sessionId).toBeTruthy()
  })
})

describe('sessions are bound to the token that opened them', () => {
  it('refuses another token’s session id with 404 rather than running as its owner', async () => {
    const owner = await openSession(humanSecret)
    try {
      const sid = owner.transport.sessionId
      expect(sid).toBeTruthy()

      // Same live session id, different valid bearer: must not be served.
      const r = await call('POST', { secret: implSecret, sessionId: sid!, body: listBody() })
      expect(r.status).toBe(404)
      expect(errCode(r.json)).toBe(-32001)

      // The owner's own session keeps working — the check is scoped, not a
      // blanket invalidation.
      const tools = await owner.client.listTools()
      expect(tools.tools.length).toBeGreaterThan(0)
    } finally {
      await closeSession(owner)
    }
  })

  it('refuses another token’s session id on GET and DELETE', async () => {
    const owner = await openSession(humanSecret)
    try {
      const sid = owner.transport.sessionId!
      const get = await call('GET', { secret: implSecret, sessionId: sid })
      expect(get.status).toBe(404)
      const del = await call('DELETE', { secret: implSecret, sessionId: sid })
      expect(del.status).toBe(404)
      // Not torn down by the foreign DELETE.
      const tools = await owner.client.listTools()
      expect(tools.tools.length).toBeGreaterThan(0)
    } finally {
      await closeSession(owner)
    }
  })
})

describe('McpServer is built per session, not per request', () => {
  it('does not rebuild the server for requests routed to a live session', async () => {
    const s = await openSession(humanSecret)
    try {
      const after = counter.builds
      await s.client.listTools()
      await s.client.listTools()
      await s.client.listTools()
      expect(counter.builds).toBe(after)
    } finally {
      await closeSession(s)
    }
  })

  it('builds exactly one server for a new session', async () => {
    const before = counter.builds
    const s = await openSession(humanSecret)
    try {
      expect(counter.builds).toBe(before + 1)
    } finally {
      await closeSession(s)
    }
  })
})
