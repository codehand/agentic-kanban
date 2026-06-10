/**
 * engine-thin-client.test.ts — Integration test for the .ai engine thin-client → server path (TASK-010).
 *
 * Verifies that the MCP tools the engine scripts (gate.sh, run-evidence.sh, new-task.sh)
 * call as a thin client actually work end-to-end against the server:
 *   - task.create     (new-task.sh)
 *   - task.transition (gate.sh propose)
 *   - gitref.set      (gate.sh worktree/gitref mapping)
 *   - evidence.submit (run-evidence.sh — runner role)
 *   - task.selfcheck  (gate.sh selfcheck)
 *   - task.approve    (gate.sh approve)
 *
 * Each step uses the role-appropriate token, mirroring what the bash thin client
 * does when TASK_HUB_URL is set (with TASK_HUB_TOKEN / TASK_HUB_RUNNER_TOKEN).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { openMemoryDb, type Db } from '../src/db/connection.js'
import { runMigrations } from '../src/db/migrate.js'
import { mintToken } from '../src/auth/mint.js'
import { mountMcpRoute } from '../src/mcp/server.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

let db: Db
let server: Server
let baseUrl: string

const tokens = {
  implementer: { tokenId: '', secret: '' },
  selfcheck: { tokenId: '', secret: '' },
  judge: { tokenId: '', secret: '' },
  human: { tokenId: '', secret: '' },
  runner: { tokenId: '', secret: '' },
}

const PROJECT_ID = 'proj-engine-thin'
const TASK_KEY = 'TASK-ENG-001'

async function makeClient(secret: string): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: {
      headers: { Authorization: `Bearer ${secret}` },
    },
  })
  const client = new Client({ name: 'engine-thin-client-test', version: '0.0.1' })
  await client.connect(transport)
  return { client, transport }
}

async function closeClient(c: { client: Client; transport: StreamableHTTPClientTransport }) {
  try { await c.client.close() } catch { /* already closed */ }
  try { await c.transport.close() } catch { /* already closed */ }
}

beforeAll(async () => {
  db = openMemoryDb()
  runMigrations(db)

  // Mint one token per role — engine scripts use these via TASK_HUB_TOKEN / TASK_HUB_RUNNER_TOKEN.
  tokens.implementer = mintToken(db, 'implementer', 'test-impl-thin')
  tokens.selfcheck = mintToken(db, 'self-check', 'test-selfcheck-thin')
  tokens.judge = mintToken(db, 'judge', 'test-judge-thin')
  tokens.human = mintToken(db, 'human', 'test-human-thin')
  tokens.runner = mintToken(db, 'runner', 'test-runner-thin')

  // Seed a project
  db.prepare(
    `INSERT INTO project (id, slug, name) VALUES (?, 'engine-thin-proj', 'Engine Thin Client Test')`,
  ).run(PROJECT_ID)

  // Mount MCP router on a bare http server (same as production)
  const baseRouter = (_req: IncomingMessage, res: ServerResponse) => { res.writeHead(404); res.end() }
  const router = mountMcpRoute(baseRouter, db)
  server = createServer(router)
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
// AC8: engine thin-client → server integration
// ---------------------------------------------------------------------------

describe('engine thin-client → server integration', () => {
  // ----- new-task.sh → task.create -----
  it('task.create: new-task.sh thin-client creates a task on the server', async () => {
    const { client, transport } = await makeClient(tokens.human.secret)
    try {
      const res = await client.callTool({
        name: 'task.create',
        arguments: {
          project: PROJECT_ID,
          key: TASK_KEY,
          title: 'Engine thin-client test task',
          body_md: 'Integration test for gate.sh / run-evidence.sh / new-task.sh thin client',
        },
      })
      expect(res.isError).toBeFalsy()
      const created = JSON.parse((res.content as Array<{ text: string }>)[0].text) as Record<string, unknown>
      expect(created).toHaveProperty('id')
      expect(created).toHaveProperty('state', 'TODO')
      expect(created.key).toBe(TASK_KEY)
    } finally {
      await closeClient({ client, transport })
    }
  })

  // ----- gate.sh propose → task.claim + task.transition (TODO → IN_PROGRESS) -----
  it('task.transition: gate.sh propose drives TODO → IN_PROGRESS on the server', async () => {
    const { client, transport } = await makeClient(tokens.implementer.secret)
    try {
      // Claim first (lease guard)
      const claimRes = await client.callTool({
        name: 'task.claim',
        arguments: { project: PROJECT_ID, key: TASK_KEY },
      })
      expect(claimRes.isError).toBeFalsy()

      // Transition TODO → IN_PROGRESS (gate.sh propose)
      const trRes = await client.callTool({
        name: 'task.transition',
        arguments: {
          project: PROJECT_ID,
          key: TASK_KEY,
          from: 'TODO',
          to: 'IN_PROGRESS',
          note: 'starting work via thin client',
        },
      })
      expect(trRes.isError).toBeFalsy()
      const tr = JSON.parse((trRes.content as Array<{ text: string }>)[0].text) as { to_state: string }
      expect(tr.to_state).toBe('IN_PROGRESS')

      // Verify server state
      const task = db.prepare(
        `SELECT state FROM task WHERE project_id = ? AND key = ?`
      ).get(PROJECT_ID, TASK_KEY) as { state: string }
      expect(task.state).toBe('IN_PROGRESS')
    } finally {
      await closeClient({ client, transport })
    }
  })

  // ----- gate.sh propose → gitref.set + task.transition (IN_PROGRESS → IMPLEMENTED) -----
  it('gitref.set + task.transition: gate.sh maps gitref and drives IN_PROGRESS → IMPLEMENTED', async () => {
    const { client, transport } = await makeClient(tokens.implementer.secret)
    try {
      // Set gitref (gate.sh maps local worktree gitref → server via gitref.set)
      const refRes = await client.callTool({
        name: 'gitref.set',
        arguments: {
          project: PROJECT_ID,
          key: TASK_KEY,
          repo: 'main',
          branch: 'fix/TASK-ENG-001-test',
          base_sha: 'a'.repeat(40),
          head_sha: 'b'.repeat(40),
        },
      })
      expect(refRes.isError).toBeFalsy()
      const ref = JSON.parse((refRes.content as Array<{ text: string }>)[0].text) as Record<string, unknown>
      expect(ref).toHaveProperty('head_sha', 'b'.repeat(40))
      expect(ref).toHaveProperty('branch', 'fix/TASK-ENG-001-test')

      // Transition IN_PROGRESS → IMPLEMENTED
      const implRes = await client.callTool({
        name: 'task.transition',
        arguments: {
          project: PROJECT_ID,
          key: TASK_KEY,
          from: 'IN_PROGRESS',
          to: 'IMPLEMENTED',
          note: 'done via thin client',
        },
      })
      expect(implRes.isError).toBeFalsy()
      const tr = JSON.parse((implRes.content as Array<{ text: string }>)[0].text) as { to_state: string }
      expect(tr.to_state).toBe('IMPLEMENTED')
    } finally {
      await closeClient({ client, transport })
    }
  })

  // ----- run-evidence.sh → evidence.submit (runner token, distinct from implementer) -----
  it('evidence.submit: run-evidence.sh submits evidence via runner role (distinct from implementer)', async () => {
    // Runner token (TASK_HUB_RUNNER_TOKEN) — distinct from implementer credentials (per §7)
    const { client, transport } = await makeClient(tokens.runner.secret)
    try {
      const res = await client.callTool({
        name: 'evidence.submit',
        arguments: {
          project: PROJECT_ID,
          key: TASK_KEY,
          build_exit: 0,
          test_exit: 0,
          ac_exit: 0,
          coverage_pct: 85.0,
          manifest_json: JSON.stringify({
            task: TASK_KEY,
            build_exit: '0',
            test_exit: '0',
            files: { 'build.log': 'abc123' },
          }),
        },
      })
      expect(res.isError).toBeFalsy()
      const ev = JSON.parse((res.content as Array<{ text: string }>)[0].text) as Record<string, unknown>
      expect(ev).toHaveProperty('id')
      expect(ev).toHaveProperty('manifest_checksum')

      // Verify evidence was persisted
      const evRow = db.prepare(
        `SELECT manifest_json FROM evidence WHERE task_id = (SELECT id FROM task WHERE project_id = ? AND key = ?) ORDER BY id DESC LIMIT 1`
      ).get(PROJECT_ID, TASK_KEY) as { manifest_json: string }
      expect(evRow.manifest_json).toContain('build_exit')
    } finally {
      await closeClient({ client, transport })
    }
  })

  // ----- run-evidence.sh rejects implementer role for evidence.submit -----
  it('evidence.submit: implementer role is rejected (runner-only per §7)', async () => {
    const { client, transport } = await makeClient(tokens.implementer.secret)
    try {
      const res = await client.callTool({
        name: 'evidence.submit',
        arguments: {
          project: PROJECT_ID,
          key: TASK_KEY,
          build_exit: 0,
          test_exit: 0,
          ac_exit: 0,
          manifest_json: '{}',
        },
      })
      expect(res.isError).toBe(true)
      const text = (res.content as Array<{ type: string; text: string }>)
        .map((c) => c.text)
        .join(' ')
      expect(text).toMatch(/forbidden|not permitted|role/i)
    } finally {
      await closeClient({ client, transport })
    }
  })

  // ----- gate.sh selfcheck → task.selfcheck -----
  it('task.selfcheck: gate.sh selfcheck drives IMPLEMENTED → SELF_CHECK_PASSED', async () => {
    const { client, transport } = await makeClient(tokens.selfcheck.secret)
    try {
      const res = await client.callTool({
        name: 'task.selfcheck',
        arguments: {
          project: PROJECT_ID,
          key: TASK_KEY,
        },
      })
      expect(res.isError).toBeFalsy()
      const result = JSON.parse((res.content as Array<{ text: string }>)[0].text) as { success: boolean }
      expect(result.success).toBe(true)

      // Verify server state
      const task = db.prepare(
        `SELECT state FROM task WHERE project_id = ? AND key = ?`
      ).get(PROJECT_ID, TASK_KEY) as { state: string }
      expect(task.state).toBe('SELF_CHECK_PASSED')
    } finally {
      await closeClient({ client, transport })
    }
  })

  // ----- gate.sh approve → task.approve (via JUDGE_PASSED → DONE) -----
  it('task.approve: gate.sh approve drives JUDGE_PASSED → DONE (human role)', async () => {
    // First, judge adds verdict comment + transitions → JUDGE_PASSED
    const judgeClient = await makeClient(tokens.judge.secret)
    try {
      const cmtRes = await judgeClient.client.callTool({
        name: 'comment.add',
        arguments: {
          project: PROJECT_ID,
          key: TASK_KEY,
          kind: 'verdict',
          body_md: 'LGTM',
          verdict: 'PASS',
        },
      })
      expect(cmtRes.isError).toBeFalsy()

      const judgeRes = await judgeClient.client.callTool({
        name: 'task.transition',
        arguments: {
          project: PROJECT_ID,
          key: TASK_KEY,
          from: 'SELF_CHECK_PASSED',
          to: 'JUDGE_PASSED',
        },
      })
      expect(judgeRes.isError).toBeFalsy()
    } finally {
      await closeClient(judgeClient)
    }

    // Now approve via human role (task.approve tool — gate.sh approve thin client)
    const { client, transport } = await makeClient(tokens.human.secret)
    try {
      const res = await client.callTool({
        name: 'task.approve',
        arguments: {
          project: PROJECT_ID,
          key: TASK_KEY,
        },
      })
      expect(res.isError).toBeFalsy()

      // Verify server state is DONE
      const task = db.prepare(
        `SELECT state FROM task WHERE project_id = ? AND key = ?`
      ).get(PROJECT_ID, TASK_KEY) as { state: string }
      expect(task.state).toBe('DONE')
    } finally {
      await closeClient({ client, transport })
    }
  })

  // ----- Full lifecycle: verify end-to-end thin-client flow -----
  it('full lifecycle: create → transition → evidence → selfcheck → judge → approve', async () => {
    // Verify the task reached DONE state through the entire thin-client flow
    const task = db.prepare(
      `SELECT state, key FROM task WHERE project_id = ? AND key = ?`
    ).get(PROJECT_ID, TASK_KEY) as { state: string; key: string }
    expect(task.state).toBe('DONE')
    expect(task.key).toBe(TASK_KEY)

    // Verify transitions were recorded (append-only)
    const transitions = db.prepare(
      `SELECT from_state, to_state, actor_role FROM transition WHERE task_id = (SELECT id FROM task WHERE project_id = ? AND key = ?) ORDER BY at ASC`
    ).all(PROJECT_ID, TASK_KEY) as Array<{ from_state: string; to_state: string; actor_role: string }>
    expect(transitions.length).toBeGreaterThanOrEqual(4)
    const stateSequence = transitions.map(t => t.to_state)
    expect(stateSequence).toContain('IN_PROGRESS')
    expect(stateSequence).toContain('IMPLEMENTED')
    expect(stateSequence).toContain('SELF_CHECK_PASSED')
    expect(stateSequence).toContain('DONE')

    // Verify gitref was mapped (single-repo flow)
    const gitrefs = db.prepare(
      `SELECT repo, branch, head_sha FROM gitref WHERE task_id = (SELECT id FROM task WHERE project_id = ? AND key = ?)`
    ).all(PROJECT_ID, TASK_KEY) as Array<{ repo: string; branch: string; head_sha: string }>
    expect(gitrefs.length).toBeGreaterThanOrEqual(1)
    expect(gitrefs[0].branch).toBe('fix/TASK-ENG-001-test')
    expect(gitrefs[0].head_sha).toBe('b'.repeat(40))
  })
})
