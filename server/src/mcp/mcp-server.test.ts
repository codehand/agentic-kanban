/**
 * mcp-server.test.ts — Integration tests for the MCP server (TASK-007).
 *
 * Verifies:
 *   AC8:  MCP SDK client connects over Streamable HTTP with a bearer token.
 *   AC9:  Full happy-path lifecycle driven through tools, each role using its own token.
 *   AC10: An implementer token calling evidence.submit returns a role error.
 *   AC11: Tests are real (no skipped, no tautologies).
 *
 * The test spins up a real node:http server with the /mcp route mounted,
 * then drives it via the SDK's StreamableHTTPClientTransport — one Client
 * per role/token.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { openMemoryDb, type Db } from '../db/connection.js'
import { runMigrations } from '../db/migrate.js'
import { mintToken } from '../auth/mint.js'
import { mountMcpRoute } from './server.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

interface TokenSet {
  human: { tokenId: string; secret: string }
  implementer: { tokenId: string; secret: string }
  selfcheck: { tokenId: string; secret: string }
  judge: { tokenId: string; secret: string }
  runner: { tokenId: string; secret: string }
}

let db: Db
let server: Server
let baseUrl: string
let tokens: TokenSet
let projectId: string

/** Create an MCP Client connected with a bearer token. */
async function makeClient(secret: string): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: {
      headers: { Authorization: `Bearer ${secret}` },
    },
  })
  const client = new Client({ name: 'test-client', version: '0.0.1' })
  await client.connect(transport)
  return { client, transport }
}

/** Close a Client + transport pair cleanly. */
async function closeClient(c: { client: Client; transport: StreamableHTTPClientTransport }) {
  try { await c.client.close() } catch { /* already closed */ }
  try { await c.transport.close() } catch { /* already closed */ }
}

beforeAll(async () => {
  db = openMemoryDb()
  runMigrations(db)

  // Mint one token per role.
  const human = mintToken(db, 'human', 'test-human')
  const implementer = mintToken(db, 'implementer', 'test-implementer')
  const selfcheck = mintToken(db, 'self-check', 'test-selfcheck')
  const judge = mintToken(db, 'judge', 'test-judge')
  const runner = mintToken(db, 'runner', 'test-runner')
  tokens = { human, implementer, selfcheck, judge, runner }

  // Seed a project via the raw DB (project.create is a tool; we want tests
  // focused on the lifecycle, not bootstrapping).
  projectId = 'proj-test'
  db.prepare(
    `INSERT INTO project (id, slug, name) VALUES (?, 'test-project', 'Test Project')`,
  ).run(projectId)

  // Mount the MCP router onto a bare node:http server.
  const baseRouter = (_req: any, res: any) => {
    res.writeHead(404)
    res.end()
  }
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

describe('AC8: MCP SDK client connects over Streamable HTTP with bearer token', () => {
  it('connects and lists tools when given a valid bearer token', async () => {
    const { client } = await makeClient(tokens.human.secret)
    try {
      const { tools } = await client.listTools()
      const names = tools.map((t) => t.name)
      // Sanity: at least some of our tools are registered.
      expect(names).toContain('project.list')
      expect(names).toContain('task.transition')
      expect(names).toContain('evidence.submit')
    } finally {
      await closeClient({ client, transport: null as any })
    }
  })

  it('rejects unauthenticated requests', async () => {
    // Connect without Authorization header → should fail.
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`))
    const client = new Client({ name: 'anon', version: '0.0.1' })
    await expect(client.connect(transport)).rejects.toThrow()
  })
})

describe('AC10: implementer calling evidence.submit returns role error', () => {
  it('refuses evidence.submit from a non-runner role', async () => {
    const { client } = await makeClient(tokens.implementer.secret)
    try {
      const result = await client.callTool({
        name: 'evidence.submit',
        arguments: {
          project: 'test-project',
          key: 'TASK-999',
          build_exit: 0,
          test_exit: 0,
          ac_exit: 0,
          manifest_json: '{}',
        },
      })
      expect(result.isError).toBe(true)
      const text = (result.content as Array<{ type: string; text: string }>)
        .map((c) => c.text)
        .join(' ')
      expect(text).toMatch(/forbidden|not permitted|role/i)
    } finally {
      await closeClient({ client, transport: null as any })
    }
  })
})

describe('AC9: full happy-path lifecycle through tools', () => {
  // Each step in the lifecycle uses a fresh Client with the correct role's token.
  // The lifecycle is: TODO → IN_PROGRESS → IMPLEMENTED → SELF_CHECK_PASSED → JUDGE_PASSED.
  const taskKey = 'TASK-001'

  beforeEach(() => {
    // Start from a clean task state for each test run.
    db.prepare(`DELETE FROM transition WHERE task_id IN (SELECT id FROM task WHERE key = ?)`).run(taskKey)
    db.prepare(`DELETE FROM comment WHERE task_id IN (SELECT id FROM task WHERE key = ?)`).run(taskKey)
    db.prepare(`DELETE FROM evidence WHERE task_id IN (SELECT id FROM task WHERE key = ?)`).run(taskKey)
    db.prepare(`DELETE FROM gitref WHERE task_id IN (SELECT id FROM task WHERE key = ?)`).run(taskKey)
    db.prepare(`DELETE FROM task WHERE key = ?`).run(taskKey)
  })

  it('drives TODO → IN_PROGRESS → IMPLEMENTED → SELF_CHECK_PASSED → JUDGE_PASSED', async () => {
    // --- Step 1: human creates a task (→ TODO) ---
    const human1 = await makeClient(tokens.human.secret)
    try {
      const createRes = await human1.client.callTool({
        name: 'task.create',
        arguments: {
          project: 'test-project',
          key: taskKey,
          title: 'Test lifecycle task',
          body_md: 'body',
          allow_no_code_change: false,
        },
      })
      expect(createRes.isError).toBeFalsy()
      const created = JSON.parse((createRes.content as any)[0].text) as { state: string }
      expect(created.state).toBe('TODO')
    } finally {
      await closeClient(human1)
    }

    // --- Step 2: implementer claims the task (lease guard), then transitions TODO → IN_PROGRESS ---
    const impl2 = await makeClient(tokens.implementer.secret)
    try {
      // Claim first — the gate's lease guard (AC5) requires the implementer
      // to hold an active lease for non-human/non-gate transitions.
      const claimRes = await impl2.client.callTool({
        name: 'task.claim',
        arguments: {
          project: 'test-project',
          key: taskKey,
        },
      })
      expect(claimRes.isError).toBeFalsy()

      const trRes = await impl2.client.callTool({
        name: 'task.transition',
        arguments: {
          project: 'test-project',
          key: taskKey,
          from: 'TODO',
          to: 'IN_PROGRESS',
          note: 'starting work',
        },
      })
      expect(trRes.isError).toBeFalsy()
      const transition = JSON.parse((trRes.content as any)[0].text) as { to_state: string }
      expect(transition.to_state).toBe('IN_PROGRESS')
    } finally {
      await closeClient(impl2)
    }

    // --- Step 3: implementer sets a gitref + transitions IN_PROGRESS → IMPLEMENTED ---
    const impl3 = await makeClient(tokens.implementer.secret)
    try {
      const refRes = await impl3.client.callTool({
        name: 'gitref.set',
        arguments: {
          project: 'test-project',
          key: taskKey,
          repo: 'main',
          branch: 'fix/test',
          base_sha: 'a'.repeat(40),
          head_sha: 'b'.repeat(40),
        },
      })
      expect(refRes.isError).toBeFalsy()

      const implRes = await impl3.client.callTool({
        name: 'task.transition',
        arguments: {
          project: 'test-project',
          key: taskKey,
          from: 'IN_PROGRESS',
          to: 'IMPLEMENTED',
          note: 'done',
        },
      })
      expect(implRes.isError).toBeFalsy()
      const tr = JSON.parse((implRes.content as any)[0].text) as { to_state: string }
      expect(tr.to_state).toBe('IMPLEMENTED')
    } finally {
      await closeClient(impl3)
    }

    // --- Step 4: runner submits evidence ---
    const runnerClient = await makeClient(tokens.runner.secret)
    try {
      const evidenceRes = await runnerClient.client.callTool({
        name: 'evidence.submit',
        arguments: {
          project: 'test-project',
          key: taskKey,
          build_exit: 0,
          test_exit: 0,
          ac_exit: 0,
          manifest_json: JSON.stringify({ files: { 'a.ts': 'deadbeef' } }),
        },
      })
      expect(evidenceRes.isError).toBeFalsy()
    } finally {
      await closeClient(runnerClient)
    }

    // --- Step 5: self-check triggers selfcheck → SELF_CHECK_PASSED ---
    const scClient = await makeClient(tokens.selfcheck.secret)
    try {
      const scRes = await scClient.client.callTool({
        name: 'task.selfcheck',
        arguments: {
          project: 'test-project',
          key: taskKey,
        },
      })
      expect(scRes.isError).toBeFalsy()
      const scResult = JSON.parse((scRes.content as any)[0].text) as { success: boolean }
      expect(scResult.success).toBe(true)
    } finally {
      await closeClient(scClient)
    }

    // Verify state is SELF_CHECK_PASSED.
    const state1 = db
      .prepare(`SELECT state FROM task WHERE key = ?`)
      .get(taskKey) as { state: string }
    expect(state1.state).toBe('SELF_CHECK_PASSED')

    // --- Step 6: judge adds verdict comment + transitions → JUDGE_PASSED ---
    const judgeClient = await makeClient(tokens.judge.secret)
    try {
      const cmtRes = await judgeClient.client.callTool({
        name: 'comment.add',
        arguments: {
          project: 'test-project',
          key: taskKey,
          kind: 'verdict',
          body_md: 'Looks good',
          verdict: 'PASS',
        },
      })
      expect(cmtRes.isError).toBeFalsy()

      const judgeRes = await judgeClient.client.callTool({
        name: 'task.transition',
        arguments: {
          project: 'test-project',
          key: taskKey,
          from: 'SELF_CHECK_PASSED',
          to: 'JUDGE_PASSED',
          note: 'approved by judge',
        },
      })
      expect(judgeRes.isError).toBeFalsy()
      const jt = JSON.parse((judgeRes.content as any)[0].text) as { to_state: string }
      expect(jt.to_state).toBe('JUDGE_PASSED')
    } finally {
      await closeClient(judgeClient)
    }

    // Final state check.
    const state2 = db
      .prepare(`SELECT state FROM task WHERE key = ?`)
      .get(taskKey) as { state: string }
    expect(state2.state).toBe('JUDGE_PASSED')
  })
})
