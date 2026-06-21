/**
 * pr-bot-mcp.test.ts — TASK-053.
 *
 * Drives the REAL MCP write-tool handlers (registerWriteTools, mounted via
 * mountMcpRoute) over the SDK Streamable HTTP client, under a pr-bot-role
 * token. This is the seam TASK-051 never exercised: transitionAction's
 * JUDGE_PASSED→READY_TO_REVIEW mapping + the gate lease guard together.
 *
 * Asserts:
 *   - a JUDGE_PASSED task transitions to READY_TO_REVIEW via task.transition
 *     under a pr-bot context — no auth error, no lease error — and the
 *     persisted state is READY_TO_REVIEW;
 *   - task.update {pr_url} via the MCP handler persists the URL (task.get
 *     read-back returns the exact URL);
 *   - negative: pr-bot calling task.transition JUDGE_PASSED→DONE is still
 *     rejected (pr-bot can never self-approve);
 *   - task.update with a non-http(s) pr_url is rejected (validation parity).
 *
 * These FAIL on the unpatched code: transitionAction returns the rework
 * fallback (pr-bot lacks rework → auth error), the gate lease guard rejects
 * the lease-less pr-bot, and the task.update schema strips pr_url.
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
let prBotSecret: string
const PROJECT_ID = 'proj_prbot'
const SLUG = 'prbot-proj'

async function makeClient(secret: string): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${secret}` } },
  })
  const client = new Client({ name: 'pr-bot-test', version: '0.0.1' })
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
  db.prepare(`INSERT INTO project (id, slug, name) VALUES (?, ?, 'PR-Bot Project')`).run(PROJECT_ID, SLUG)
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

describe('TASK-053: pr-bot drives JUDGE_PASSED → READY_TO_REVIEW over MCP', () => {
  // Each test seeds its own task key; the transition table is append-only so
  // we never delete between tests.
  it('transitions a JUDGE_PASSED task to READY_TO_REVIEW (no auth/lease error)', async () => {
    seedTask('TASK-RTR1', 'JUDGE_PASSED')
    const c = await makeClient(prBotSecret)
    try {
      const res = await c.client.callTool({
        name: 'task.transition',
        arguments: {
          project: SLUG,
          key: 'TASK-RTR1',
          from: 'JUDGE_PASSED',
          to: 'READY_TO_REVIEW',
          note: 'PR opened',
        },
      })
      // No auth error ("not permitted"/"rework") and no lease error.
      expect(res.isError).toBeFalsy()
      const tr = JSON.parse(errText(res)) as { to_state: string }
      expect(tr.to_state).toBe('READY_TO_REVIEW')
    } finally {
      await closeClient(c)
    }
    // Persisted state.
    const row = db.prepare(`SELECT state FROM task WHERE key = ?`).get('TASK-RTR1') as { state: string }
    expect(row.state).toBe('READY_TO_REVIEW')
  })

  it('task.update {pr_url} persists the URL (tool echo + repo read are exact)', async () => {
    seedTask('TASK-RTR2', 'JUDGE_PASSED')
    const c = await makeClient(prBotSecret)
    try {
      const upd = await c.client.callTool({
        name: 'task.update',
        arguments: { project: SLUG, key: 'TASK-RTR2', pr_url: 'https://git.example.com/pr/42' },
      })
      expect(upd.isError).toBeFalsy()
      // The tool echoes the updated row (updateTaskAttributes) — pr_url present.
      const echoed = JSON.parse(errText(upd)) as { pr_url: string }
      expect(echoed.pr_url).toBe('https://git.example.com/pr/42')
    } finally {
      await closeClient(c)
    }
    // Follow-up repo read — straight from the DB, not just the tool echo.
    const row = db.prepare(`SELECT pr_url FROM task WHERE key = ?`).get('TASK-RTR2') as { pr_url: string }
    expect(row.pr_url).toBe('https://git.example.com/pr/42')
  })

  it('rejects pr-bot self-approval JUDGE_PASSED → DONE (negative)', async () => {
    seedTask('TASK-RTR3', 'JUDGE_PASSED')
    const c = await makeClient(prBotSecret)
    try {
      let rejected = false
      let message = ''
      try {
        const res = await c.client.callTool({
          name: 'task.transition',
          arguments: { project: SLUG, key: 'TASK-RTR3', from: 'JUDGE_PASSED', to: 'DONE' },
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
    // Untouched — still JUDGE_PASSED.
    const row = db.prepare(`SELECT state FROM task WHERE key = ?`).get('TASK-RTR3') as { state: string }
    expect(row.state).toBe('JUDGE_PASSED')
  })

  it('rejects a non-http(s) pr_url and persists nothing (validation parity)', async () => {
    seedTask('TASK-RTR4', 'JUDGE_PASSED')
    const c = await makeClient(prBotSecret)
    try {
      let rejected = false
      let message = ''
      try {
        const res = await c.client.callTool({
          name: 'task.update',
          arguments: { project: SLUG, key: 'TASK-RTR4', pr_url: 'javascript:alert(1)' },
        })
        if (res.isError) { rejected = true; message = errText(res) }
      } catch (err) {
        rejected = true
        message = err instanceof Error ? err.message : String(err)
      }
      expect(rejected).toBe(true)
      expect(message).toMatch(/url|http|invalid/i)
    } finally {
      await closeClient(c)
    }
    const row = db.prepare(`SELECT pr_url FROM task WHERE key = ?`).get('TASK-RTR4') as { pr_url: string | null }
    expect(row.pr_url).toBeNull()
  })
})
