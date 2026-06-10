/**
 * create-project.test.ts — AC4/AC9 tests for POST /api/projects (TASK-022).
 *
 * Verifies:
 *   - POST /api/projects by a human creates a project (201).
 *   - The created project is visible via GET /api/projects.
 *   - 401 without Authorization header.
 *   - 403 for a role without task.create (e.g. judge).
 *   - 400 for missing or path-unsafe slug.
 *   - 409 for duplicate slug.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Server } from 'node:http'
import { openMemoryDb, type Db } from '../db/connection.js'
import { runMigrations } from '../db/migrate.js'
import { createHttpServer } from '../http/server.js'
import { mintToken } from '../auth/mint.js'

let server: Server
let baseUrl: string
let db: Db
let humanSecret: string
let judgeSecret: string

beforeAll(async () => {
  db = openMemoryDb()
  runMigrations(db)

  const human = mintToken(db, 'human', 'test-human-create-project')
  humanSecret = human.secret
  const judge = mintToken(db, 'judge', 'test-judge-create-project')
  judgeSecret = judge.secret

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

describe('AC4/AC9: POST /api/projects — create project', () => {
  it('human can create a project', async () => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: authHeaders(humanSecret),
      body: JSON.stringify({ slug: 'proj-alpha', name: 'Project Alpha' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { project: { id: string; slug: string; name: string } }
    expect(body.project).toBeDefined()
    expect(body.project.slug).toBe('proj-alpha')
    expect(body.project.name).toBe('Project Alpha')
    expect(body.project.id).toContain('proj-alpha')
  })

  it('created project is visible via GET /api/projects', async () => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      headers: authHeaders(humanSecret),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { projects: Array<{ slug: string }> }
    expect(body.projects.some((p) => p.slug === 'proj-alpha')).toBe(true)
  })

  it('returns 401 without Authorization header', async () => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'proj-noauth', name: 'No Auth' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 for a role without task.create (judge)', async () => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: authHeaders(judgeSecret),
      body: JSON.stringify({ slug: 'proj-judge', name: 'Judge Project' }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 400 for missing slug', async () => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: authHeaders(humanSecret),
      body: JSON.stringify({ name: 'No slug here' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for path-unsafe slug', async () => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: authHeaders(humanSecret),
      body: JSON.stringify({ slug: 'a/b', name: 'Bad slug' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 409 for duplicate slug', async () => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: authHeaders(humanSecret),
      body: JSON.stringify({ slug: 'proj-alpha', name: 'Duplicate' }),
    })
    expect(res.status).toBe(409)
  })

  it('name defaults to slug when omitted', async () => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: authHeaders(humanSecret),
      body: JSON.stringify({ slug: 'proj-noname' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { project: { slug: string; name: string } }
    expect(body.project.name).toBe('proj-noname')
  })
})
