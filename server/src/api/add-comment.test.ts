/**
 * add-comment.test.ts — tests for POST /api/tasks/:key/comments (TASK-057).
 *
 * Verifies:
 *   - A human (holds comment.review) can add a review comment; the created
 *     comment is returned and appears in GET /api/tasks/:key.
 *   - 401 without Authorization header.
 *   - 403 for a forbidden role (runner has no comment.* permission).
 *   - 422 for an empty body.
 *   - 404 for an unknown task; 400 for a missing project param.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Server } from 'node:http'
import { openMemoryDb, type Db } from '../db/connection.js'
import { runMigrations } from '../db/migrate.js'
import { createHttpServer } from '../http/server.js'
import { mintToken } from '../auth/mint.js'
import { insertProject } from '../db/repositories/project.js'
import { insertTask } from '../db/repositories/task.js'

let server: Server
let baseUrl: string
let db: Db
let humanSecret: string
let runnerSecret: string

beforeAll(async () => {
  db = openMemoryDb()
  runMigrations(db)

  insertProject(db, { id: 'proj_test', slug: 'test-project', name: 'Test Project' })
  insertTask(db, {
    id: 'task_c1',
    project_id: 'proj_test',
    key: 'TASK-C01',
    title: 'Commentable task',
    body_md: 'spec',
    state: 'IN_PROGRESS',
    allow_no_code_change: false,
  })

  humanSecret = mintToken(db, 'human', 'test-human-comment').secret
  runnerSecret = mintToken(db, 'runner', 'test-runner-comment').secret

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

function authHeaders(secret: string): Record<string, string> {
  return { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }
}

describe('POST /api/tasks/:key/comments', () => {
  it('human can add a review comment and it is returned', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/TASK-C01/comments?project=test-project`, {
      method: 'POST',
      headers: authHeaders(humanSecret),
      body: JSON.stringify({ body_md: 'Looks good to me.' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { comment: { id: string; kind: string; author_role: string; body_md: string } }
    expect(body.comment).toBeDefined()
    expect(body.comment.kind).toBe('review')
    expect(body.comment.author_role).toBe('human')
    expect(body.comment.body_md).toBe('Looks good to me.')
  })

  it('the comment appears in GET /api/tasks/:key', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/TASK-C01?project=test-project`, {
      headers: authHeaders(humanSecret),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { comments: Array<{ kind: string; body_md: string }> }
    const found = body.comments.find((c) => c.body_md === 'Looks good to me.')
    expect(found).toBeDefined()
    expect(found!.kind).toBe('review')
  })

  it('returns 401 without Authorization header', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/TASK-C01/comments?project=test-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body_md: 'no auth' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 for a forbidden role (runner)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/TASK-C01/comments?project=test-project`, {
      method: 'POST',
      headers: authHeaders(runnerSecret),
      body: JSON.stringify({ body_md: 'runner try' }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 422 for an empty body', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/TASK-C01/comments?project=test-project`, {
      method: 'POST',
      headers: authHeaders(humanSecret),
      body: JSON.stringify({ body_md: '   ' }),
    })
    expect(res.status).toBe(422)
  })

  it('returns 400 when project query param is missing', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/TASK-C01/comments`, {
      method: 'POST',
      headers: authHeaders(humanSecret),
      body: JSON.stringify({ body_md: 'hi' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 404 for an unknown task', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/TASK-NOPE/comments?project=test-project`, {
      method: 'POST',
      headers: authHeaders(humanSecret),
      body: JSON.stringify({ body_md: 'hi' }),
    })
    expect(res.status).toBe(404)
  })
})
