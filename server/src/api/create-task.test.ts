/**
 * create-task.test.ts — AC7 tests for POST /api/tasks (TASK-019).
 *
 * Verifies:
 *   - POST /api/tasks by a human creates a task in TODO state.
 *   - The created task is visible via GET /api/tasks.
 *   - 401 without Authorization header.
 *   - 403 for non-human role (e.g. implementer).
 *   - 400 for missing required fields (project, key, title).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Server } from 'node:http'
import { openMemoryDb, type Db } from '../db/connection.js'
import { runMigrations } from '../db/migrate.js'
import { createHttpServer } from '../http/server.js'
import { mintToken } from '../auth/mint.js'
import { insertProject } from '../db/repositories/project.js'

let server: Server
let baseUrl: string
let db: Db
let humanSecret: string
let implSecret: string

beforeAll(async () => {
  db = openMemoryDb()
  runMigrations(db)

  // Seed a project
  insertProject(db, { id: 'proj_test', slug: 'test-project', name: 'Test Project' })

  const human = mintToken(db, 'human', 'test-human-create')
  humanSecret = human.secret
  const impl = mintToken(db, 'implementer', 'test-impl-create')
  implSecret = impl.secret

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

function authHeaders(secret: string): Record<string, string> {
  return { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }
}

describe('AC7: POST /api/tasks — create task', () => {
  it('human can create a task in TODO state', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: authHeaders(humanSecret),
      body: JSON.stringify({
        project: 'test-project',
        key: 'TASK-001',
        title: 'Test task',
        body_md: 'Test body',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { task: { id: string; key: string; title: string; state: string } }
    expect(body.task).toBeDefined()
    expect(body.task.key).toBe('TASK-001')
    expect(body.task.title).toBe('Test task')
    expect(body.task.state).toBe('TODO')
  })

  it('created task is visible via GET /api/tasks', async () => {
    const res = await fetch(`${baseUrl}/api/tasks?project=test-project`, {
      headers: authHeaders(humanSecret),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { tasks: Array<{ key: string; state: string }> }
    const found = body.tasks.find((t) => t.key === 'TASK-001')
    expect(found).toBeDefined()
    expect(found!.state).toBe('TODO')
  })

  it('returns 401 without Authorization header', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: 'test-project', key: 'TASK-002', title: 'No auth' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when caller is not human', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: authHeaders(implSecret),
      body: JSON.stringify({ project: 'test-project', key: 'TASK-003', title: 'Impl try' }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 400 when missing required fields', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: authHeaders(humanSecret),
      body: JSON.stringify({ project: 'test-project' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 409 when task key already exists', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: authHeaders(humanSecret),
      body: JSON.stringify({ project: 'test-project', key: 'TASK-001', title: 'Duplicate' }),
    })
    expect(res.status).toBe(409)
  })
})
