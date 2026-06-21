/**
 * approve-mcp.test.ts — TASK-055.
 *
 * Drives the REAL MCP `task.approve` handler (registerWriteTools, mounted via
 * mountMcpRoute) over the SDK Streamable HTTP client. This is the seam TASK-051
 * never exercised: the REST `/approve` accepted both JUDGE_PASSED and
 * READY_TO_REVIEW, but the MCP tool hardcoded from='JUDGE_PASSED'.
 *
 * Asserts:
 *   - a READY_TO_REVIEW task is approved → DONE by a human over MCP, with no
 *     "State mismatch" error (FAILS on unpatched code, which throws
 *     "State mismatch: task is in 'READY_TO_REVIEW', proposal declares
 *     from='JUDGE_PASSED'");
 *   - regression: approving a JUDGE_PASSED task over MCP still works;
 *   - negative: a non-human role (pr-bot) calling task.approve is rejected.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { openMemoryDb, type Db } from '../src/db/connection.js'
import { runMigrations } from '../src/db/migrate.js'
import { mintToken } from '../src/auth/mint.js'
import { insertTask } from '../src/db/repositories/task.js'
import { mountMcpRoute } from '../src/mcp/server.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

let db: Db
let server: Server
let baseUrl: string
let humanSecret: string
let prBotSecret: string
const PROJECT_ID = 'proj_approve'
const SLUG = 'approve-proj'

async function makeClient(secret: string): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${secret}` } },
  })
  const client = new Client({ name: 'approve-test', version: '0.0.1' })
  await client.connect(transport)
  return { client, transport }
}

async function closeClient(c: { client: Client; transport: StreamableHTTPClientTransport | null }) {
  try { await c.client.close() } catch { /* already closed */ }
  try { if (c.transport) await c.transport.close() } catch { /* already closed */ }
}

function seedTask(key: string, state: string): string {
  const id = `task_${key}`
  insertTask(db, { id, project_id: PROJECT_ID, key, title: `t ${key}`, body_md: 'b', state })
  return id
}

function errText(result: { content: unknown }): string {
  return (result.content as Array<{ type: string; text: string }>).map((c) => c.text).join(' ')
}

beforeAll(async () => {
  db = openMemoryDb()
  runMigrations(db)
  db.prepare(`INSERT INTO project (id, slug, name) VALUES (?, ?, 'Approve Project')`).run(PROJECT_ID, SLUG)
  humanSecret = mintToken(db, 'human', 'test-human').secret
  prBotSecret = mintToken(db, 'pr-bot', 'test-pr-bot').secret

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

describe('TASK-055: MCP task.approve accepts READY_TO_REVIEW', () => {
  it('approves a READY_TO_REVIEW task → DONE over MCP (no State mismatch)', async () => {
    seedTask('TASK-APR1', 'READY_TO_REVIEW')
    const c = await makeClient(humanSecret)
    try {
      const res = await c.client.callTool({
        name: 'task.approve',
        arguments: { project: SLUG, key: 'TASK-APR1' },
      })
      // The unpatched handler throws "State mismatch: ... from='JUDGE_PASSED'".
      expect(res.isError).toBeFalsy()
      expect(errText(res)).not.toMatch(/State mismatch/i)
      const tr = JSON.parse(errText(res)) as { from_state: string; to_state: string }
      expect(tr.from_state).toBe('READY_TO_REVIEW')
      expect(tr.to_state).toBe('DONE')
    } finally {
      await closeClient(c)
    }
    const row = db.prepare(`SELECT state FROM task WHERE key = ?`).get('TASK-APR1') as { state: string }
    expect(row.state).toBe('DONE')
  })

  it('regression: approves a JUDGE_PASSED task → DONE over MCP', async () => {
    seedTask('TASK-APR2', 'JUDGE_PASSED')
    const c = await makeClient(humanSecret)
    try {
      const res = await c.client.callTool({
        name: 'task.approve',
        arguments: { project: SLUG, key: 'TASK-APR2' },
      })
      expect(res.isError).toBeFalsy()
      const tr = JSON.parse(errText(res)) as { from_state: string; to_state: string }
      expect(tr.from_state).toBe('JUDGE_PASSED')
      expect(tr.to_state).toBe('DONE')
    } finally {
      await closeClient(c)
    }
    const row = db.prepare(`SELECT state FROM task WHERE key = ?`).get('TASK-APR2') as { state: string }
    expect(row.state).toBe('DONE')
  })

  it('rejects a non-human role (pr-bot) calling task.approve (negative)', async () => {
    seedTask('TASK-APR3', 'READY_TO_REVIEW')
    const c = await makeClient(prBotSecret)
    try {
      let rejected = false
      let message = ''
      try {
        const res = await c.client.callTool({
          name: 'task.approve',
          arguments: { project: SLUG, key: 'TASK-APR3' },
        })
        if (res.isError) { rejected = true; message = errText(res) }
      } catch (err) {
        rejected = true
        message = err instanceof Error ? err.message : String(err)
      }
      expect(rejected).toBe(true)
      expect(message).toMatch(/permitted|forbidden|role|allowed/i)
    } finally {
      await closeClient(c)
    }
    // Untouched — still READY_TO_REVIEW.
    const row = db.prepare(`SELECT state FROM task WHERE key = ?`).get('TASK-APR3') as { state: string }
    expect(row.state).toBe('READY_TO_REVIEW')
  })
})
