/**
 * usagelog-integration.test.ts — TASK-028 integration tests.
 *
 * Boots a real node:http server with the /mcp route mounted (same pattern as
 * mcp-server.test.ts) and drives it through the MCP SDK client, then asserts:
 *   - a successful tool call emits one schema-correct event with outcome=ok;
 *   - a rejected tool call (wrong role) emits an event with outcome!=ok;
 *   - the bearer secret never appears in the log file;
 *   - when USAGE_LOG_DIR points at an unwritable path the tool call still
 *     succeeds (fire-and-forget).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openMemoryDb, type Db } from '../db/connection.js'
import { runMigrations } from '../db/migrate.js'
import { mintToken } from '../auth/mint.js'
import { mountMcpRoute } from './server.js'
import { readJsonl, readText } from './jsonl-test-helpers.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

let db: Db
let server: Server
let baseUrl: string
let humanSecret: string
let implementerSecret: string

async function makeClient(secret: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${secret}` } },
  })
  const client = new Client({ name: 'usagelog-test', version: '0.0.1' })
  await client.connect(transport)
  return client
}

function todayFile(dir: string): string {
  return join(dir, `usage-${new Date().toISOString().slice(0, 10)}.jsonl`)
}

const ORIGINAL_DIR = process.env['USAGE_LOG_DIR']
const tmpDirs: string[] = []

beforeAll(async () => {
  db = openMemoryDb()
  runMigrations(db)
  humanSecret = mintToken(db, 'human', 'ul-human').secret
  implementerSecret = mintToken(db, 'implementer', 'ul-impl').secret
  db.prepare(`INSERT INTO project (id, slug, name) VALUES ('ul-proj', 'ul-project', 'UL Project')`).run()

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
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
})

afterEach(() => {
  if (ORIGINAL_DIR === undefined) delete process.env['USAGE_LOG_DIR']
  else process.env['USAGE_LOG_DIR'] = ORIGINAL_DIR
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('TASK-028 AC3/AC4: tool calls emit schema-correct events without leaking the secret', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ul-int-'))
    tmpDirs.push(dir)
    process.env['USAGE_LOG_DIR'] = dir
  })

  it('emits outcome=ok for a successful call and outcome!=ok for a rejected one', async () => {
    const human = await makeClient(humanSecret)
    const ok = await human.callTool({ name: 'project.list', arguments: {} })
    expect(ok.isError).toBeFalsy()
    await human.close()

    // implementer calling evidence.submit (runner-only) is rejected, not crashed.
    const impl = await makeClient(implementerSecret)
    const rejected = await impl.callTool({
      name: 'evidence.submit',
      arguments: {
        project: 'ul-project',
        key: 'TASK-X',
        build_exit: 0,
        test_exit: 0,
        ac_exit: 0,
        manifest_json: '{}',
      },
    })
    expect(rejected.isError).toBe(true)
    await impl.close()

    // Allow the async fire-and-forget writes to flush.
    await new Promise((r) => setTimeout(r, 100))

    const evs = readJsonl(todayFile(dir))
    expect(evs.length).toBeGreaterThanOrEqual(2)
    const need = ['ts', 'tool', 'role', 'token_id', 'outcome', 'duration_ms']
    for (const e of evs) for (const k of need) expect(k in e).toBe(true)

    const okEv = evs.find((e) => e.tool === 'project.list')
    expect(okEv?.outcome).toBe('ok')
    expect(okEv?.role).toBe('human')
    expect(okEv?.error_message).toBeNull()

    const rejEv = evs.find((e) => e.tool === 'evidence.submit')
    expect(rejEv).toBeDefined()
    expect(rejEv?.outcome).not.toBe('ok')
    expect(rejEv?.project).toBe('ul-project')
    expect(rejEv?.task_key).toBe('TASK-X')
    expect(typeof rejEv?.error_message).toBe('string')
  })

  it('never writes the bearer secret into the log file', async () => {
    const human = await makeClient(humanSecret)
    await human.callTool({ name: 'project.list', arguments: {} })
    await human.close()
    await new Promise((r) => setTimeout(r, 100))
    const raw = readText(todayFile(dir))
    expect(raw).not.toContain(humanSecret)
  })
})

describe('TASK-028 AC5: fire-and-forget — unwritable log dir does not fail the tool call', () => {
  it('returns a normal result even when USAGE_LOG_DIR cannot be created', async () => {
    const base = mkdtempSync(join(tmpdir(), 'ul-block-'))
    tmpDirs.push(base)
    const blocker = join(base, 'blocker')
    writeFileSync(blocker, 'x') // regular file → mkdir under it fails
    const unwritable = join(blocker, 'sub')
    process.env['USAGE_LOG_DIR'] = unwritable

    const human = await makeClient(humanSecret)
    const res = await human.callTool({ name: 'project.list', arguments: {} })
    await human.close()

    expect(res.isError).toBeFalsy()
    expect(existsSync(unwritable)).toBe(false)
  })
})
