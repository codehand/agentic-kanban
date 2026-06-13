/**
 * task-dependency.test.ts — TASK-044 dependency enforcement (server hub).
 *
 * Real node:http server + in-memory DB, driven through BOTH transports:
 *   - JSON API (POST /api/tasks, GET /api/tasks, POST .../approve)
 *   - MCP SDK client (task.create, task.claim, task.transition, task.get)
 *
 * Covers:
 *   - depends_on persisted via task_dependency + exposed on reads (both transports)
 *   - self-dependency and cycle creation rejected (400 / tool error)
 *   - every forward transition of a dependent task blocked while its dependency
 *     is not DONE (409 JSON API + MCP tool error)
 *   - dependency DONE -> transition succeeds (positive control)
 *   - deleting the dependency drops the task_dependency row (CASCADE) + unblocks
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { openMemoryDb, type Db } from '../db/connection.js'
import { runMigrations } from '../db/migrate.js'
import { createHttpServer } from '../http/server.js'
import { mountMcpRoute } from '../mcp/server.js'
import { mintToken } from '../auth/mint.js'
import { insertProject } from '../db/repositories/project.js'
import { listDependencyIds } from '../db/repositories/dependency.js'
import { getTaskByKey } from '../db/repositories/task.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

let db: Db
let apiServer: Server
let mcpServer: Server
let apiUrl: string
let mcpUrl: string
let humanSecret: string
let implSecret: string

const PROJECT = 'dep-project'

function authHeaders(secret: string): Record<string, string> {
  return { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }
}

async function makeMcp(secret: string): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const transport = new StreamableHTTPClientTransport(new URL(`${mcpUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${secret}` } },
  })
  const client = new Client({ name: 'dep-test', version: '0.0.1' })
  await client.connect(transport)
  return { client, transport }
}

function toolText(result: { content: unknown }): string {
  return (result.content as Array<{ type: string; text: string }>).map((c) => c.text).join(' ')
}

/** Force a task's state directly in the DB (positive controls / setup). */
function setState(name: string, state: string): void {
  const t = getTaskByKey(db, projectId, k(name))!
  db.prepare(`UPDATE task SET state = ? WHERE id = ?`).run(state, t.id)
}

let projectId: string

beforeAll(async () => {
  db = openMemoryDb()
  runMigrations(db)
  const proj = insertProject(db, { id: 'proj_dep', slug: PROJECT, name: 'Dep Project' })
  projectId = proj.id

  humanSecret = mintToken(db, 'human', 'dep-human').secret
  implSecret = mintToken(db, 'implementer', 'dep-impl').secret

  apiServer = createHttpServer(db)
  await new Promise<void>((r) => apiServer.listen(0, () => r()))
  const a = apiServer.address()
  apiUrl = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`

  const baseRouter = (_req: IncomingMessage, res: ServerResponse) => { res.writeHead(404); res.end() }
  mcpServer = createServer(mountMcpRoute(baseRouter, db))
  await new Promise<void>((r) => mcpServer.listen(0, () => r()))
  const m = mcpServer.address()
  mcpUrl = `http://127.0.0.1:${typeof m === 'object' && m ? m.port : 0}`
})

afterAll(async () => {
  await new Promise<void>((res, rej) => apiServer.close((e) => (e ? rej(e) : res())))
  await new Promise<void>((res, rej) => mcpServer.close((e) => (e ? rej(e) : res())))
})

// Per-test key namespace: transitions are append-only (DELETE is trigger-blocked),
// so we cannot wipe tasks between tests. Instead each test gets a fresh prefix,
// and the logical names TASK-A/B/C below are mapped through k().
let testN = 0
let prefix = ''
function k(name: string): string { return `${prefix}-${name}` }

beforeEach(() => { testN += 1; prefix = `T${testN}` })

async function createTask(name: string, title: string, dependsOn?: string[]): Promise<Response> {
  return fetch(`${apiUrl}/api/tasks`, {
    method: 'POST',
    headers: authHeaders(humanSecret),
    body: JSON.stringify({ project: PROJECT, key: k(name), title, ...(dependsOn ? { depends_on: dependsOn.map(k) } : {}) }),
  })
}

describe('TASK-044: depends_on persistence + read exposure', () => {
  it('JSON API stores task_dependency rows and GET exposes depends_on', async () => {
    expect((await createTask('A', 'Dep A')).status).toBe(201)
    const bRes = await createTask('B', 'Dep B', ['A'])
    expect(bRes.status).toBe(201)

    const b = getTaskByKey(db, projectId, k('B'))!
    const a = getTaskByKey(db, projectId, k('A'))!
    expect(listDependencyIds(db, b.id)).toEqual([a.id])

    const list = await (await fetch(`${apiUrl}/api/tasks?project=${PROJECT}`, { headers: authHeaders(humanSecret) })).json() as { tasks: Array<{ key: string; depends_on: string[] }> }
    const bView = list.tasks.find((t) => t.key === k('B'))!
    expect(bView.depends_on).toEqual([k('A')])

    const detail = await (await fetch(`${apiUrl}/api/tasks/${k('B')}?project=${PROJECT}`, { headers: authHeaders(humanSecret) })).json() as { task: { depends_on: string[] } }
    expect(detail.task.depends_on).toEqual([k('A')])
  })

  it('MCP task.get exposes depends_on', async () => {
    await createTask('A', 'Dep A')
    await createTask('B', 'Dep B', ['A'])
    const c = await makeMcp(humanSecret)
    try {
      const res = await c.client.callTool({ name: 'task.get', arguments: { project: PROJECT, key: k('B') } })
      const parsed = JSON.parse(toolText(res)) as { depends_on: string[] }
      expect(parsed.depends_on).toEqual([k('A')])
    } finally {
      await c.client.close()
    }
  })
})

describe('TASK-044: self-dependency + cycle rejected (400)', () => {
  it('JSON API rejects self-dependency with 400', async () => {
    const res = await createTask('A', 'Dep A', ['A'])
    expect(res.status).toBe(400)
    // And no orphan row was left behind.
    expect(getTaskByKey(db, projectId, k('A'))).toBeUndefined()
  })

  it('JSON API rejects a cycle-creating dependency with 400', async () => {
    await createTask('A', 'Dep A')
    await createTask('B', 'Dep B', ['A']) // B -> A
    // Now try to make A depend on B (A -> B -> A): a cycle.
    const res = await fetch(`${apiUrl}/api/tasks/${k('A')}?project=${PROJECT}`, {
      method: 'PATCH',
      headers: authHeaders(humanSecret),
      body: JSON.stringify({ depends_on: [k('B')] }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/cycle/i)
  })

  it('MCP task.create rejects self-dependency (tool error)', async () => {
    const c = await makeMcp(humanSecret)
    try {
      const res = await c.client.callTool({ name: 'task.create', arguments: { project: PROJECT, key: k('S'), title: 'Self', depends_on: [k('S')] } })
      expect(res.isError).toBe(true)
      expect(toolText(res)).toMatch(/itself|self/i)
    } finally {
      await c.client.close()
    }
  })

  it('MCP task.update rejects a longer cycle A->B->C->A (tool error)', async () => {
    await createTask('A', 'A')
    await createTask('B', 'B', ['A']) // B -> A
    await createTask('C', 'C', ['B']) // C -> B -> A
    const c = await makeMcp(humanSecret)
    try {
      // A -> C would close the loop A -> C -> B -> A.
      const res = await c.client.callTool({ name: 'task.update', arguments: { project: PROJECT, key: k('A'), depends_on: [k('C')] } })
      expect(res.isError).toBe(true)
      expect(toolText(res)).toMatch(/cycle/i)
    } finally {
      await c.client.close()
    }
  })
})

describe('TASK-044: cross-project dependency rejected (400)', () => {
  it('JSON API rejects depends_on referencing a task not in this project', async () => {
    const res = await createTask('B', 'B', ['NOPE'])
    expect(res.status).toBe(400)
  })
})

describe('TASK-044: forward transitions blocked while dependency not DONE (409 / tool error)', () => {
  it('JSON API approve returns 409 while dependency is not DONE', async () => {
    await createTask('A', 'A')
    await createTask('B', 'B', ['A'])
    setState('B', 'JUDGE_PASSED') // poised to approve
    const res = await fetch(`${apiUrl}/api/tasks/${k('B')}/approve?project=${PROJECT}`, {
      method: 'POST', headers: authHeaders(humanSecret), body: '{}',
    })
    expect(res.status).toBe(409)
    const body = await res.json() as { error: string; unmet_dependencies: Array<{ key: string; state: string }> }
    expect(body.error).toMatch(new RegExp(k('A')))
    expect(body.unmet_dependencies[0]).toMatchObject({ key: k('A'), state: 'TODO' })
  })

  it('MCP task.claim is blocked while dependency is not DONE (tool error)', async () => {
    await createTask('A', 'A')
    await createTask('B', 'B', ['A'])
    const c = await makeMcp(implSecret)
    try {
      const res = await c.client.callTool({ name: 'task.claim', arguments: { project: PROJECT, key: k('B') } })
      expect(res.isError).toBe(true)
      expect(toolText(res)).toMatch(new RegExp(k('A')))
      expect(toolText(res)).toMatch(/blocked|dependenc/i)
    } finally {
      await c.client.close()
    }
  })

  it('MCP task.transition TODO->IN_PROGRESS is blocked while dependency not DONE (tool error)', async () => {
    await createTask('A', 'A')
    await createTask('B', 'B', ['A'])
    const c = await makeMcp(implSecret)
    try {
      const res = await c.client.callTool({ name: 'task.transition', arguments: { project: PROJECT, key: k('B'), from: 'TODO', to: 'IN_PROGRESS' } })
      expect(res.isError).toBe(true)
      expect(toolText(res)).toMatch(new RegExp(k('A')))
    } finally {
      await c.client.close()
    }
  })
})

describe('TASK-044: positive control + CASCADE', () => {
  it('dependency DONE -> approve succeeds (200)', async () => {
    await createTask('A', 'A')
    await createTask('B', 'B', ['A'])
    setState('A', 'DONE')
    setState('B', 'JUDGE_PASSED')
    const res = await fetch(`${apiUrl}/api/tasks/${k('B')}/approve?project=${PROJECT}`, {
      method: 'POST', headers: authHeaders(humanSecret), body: '{}',
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { task: { state: string } }
    expect(body.task.state).toBe('DONE')
  })

  it('MCP task.claim succeeds once the dependency is DONE (positive control)', async () => {
    await createTask('A', 'A')
    await createTask('B', 'B', ['A'])
    setState('A', 'DONE')
    const c = await makeMcp(implSecret)
    try {
      const res = await c.client.callTool({ name: 'task.claim', arguments: { project: PROJECT, key: k('B') } })
      expect(res.isError).toBeFalsy()
    } finally {
      await c.client.close()
    }
  })

  it('deleting the dependency drops the task_dependency row (CASCADE) and unblocks the task', async () => {
    await createTask('A', 'A')
    await createTask('B', 'B', ['A'])
    const b = getTaskByKey(db, projectId, k('B'))!
    expect(listDependencyIds(db, b.id).length).toBe(1)

    // Remove the dependency via the API.
    const del = await fetch(`${apiUrl}/api/tasks/${k('A')}/remove?project=${PROJECT}`, {
      method: 'POST', headers: authHeaders(humanSecret), body: '{}',
    })
    expect(del.status).toBe(200)

    // CASCADE: the edge is gone.
    expect(listDependencyIds(db, b.id)).toEqual([])

    // And B is now unblocked: approve succeeds from JUDGE_PASSED.
    setState('B', 'JUDGE_PASSED')
    const res = await fetch(`${apiUrl}/api/tasks/${k('B')}/approve?project=${PROJECT}`, {
      method: 'POST', headers: authHeaders(humanSecret), body: '{}',
    })
    expect(res.status).toBe(200)
  })
})
