/**
 * task-attributes.test.ts — Tests for TASK-021: task attribute fields.
 *
 * Verifies:
 *   - Create task with attributes persists them.
 *   - PATCH /api/tasks/:key updates attributes.
 *   - Invalid enum values are rejected (400).
 *   - Invalid estimate_hours (negative) is rejected (400).
 *   - Invalid link_document (non-URL) is rejected (400).
 *   - Invalid tags (non-array) is rejected (400).
 *   - GET returns new fields.
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

beforeAll(async () => {
  db = openMemoryDb()
  runMigrations(db)

  insertProject(db, { id: 'proj_test', slug: 'test-project', name: 'Test Project' })

  const human = mintToken(db, 'human', 'test-human-attrs')
  humanSecret = human.secret

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

describe('TASK-021: task attributes', () => {
  it('creates a task with all attributes and they persist', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: authHeaders(humanSecret),
      body: JSON.stringify({
        project: 'test-project',
        key: 'TASK-ATTR-001',
        title: 'Task with attributes',
        priority: 'P1',
        complexity: 'M',
        estimate_hours: 4.5,
        tags: ['backend', 'api'],
        link_document: 'https://docs.example.com/spec',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { task: Record<string, unknown> }
    expect(body.task.priority).toBe('P1')
    expect(body.task.complexity).toBe('M')
    expect(body.task.estimate_hours).toBe(4.5)
    expect(body.task.tags).toEqual(['backend', 'api'])
    expect(body.task.link_document).toBe('https://docs.example.com/spec')
  })

  it('GET returns attributes for created task', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/TASK-ATTR-001?project=test-project`, {
      headers: authHeaders(humanSecret),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { task: Record<string, unknown> }
    expect(body.task.priority).toBe('P1')
    expect(body.task.complexity).toBe('M')
    expect(body.task.tags).toEqual(['backend', 'api'])
  })

  it('PATCH updates task attributes', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/TASK-ATTR-001?project=test-project`, {
      method: 'PATCH',
      headers: authHeaders(humanSecret),
      body: JSON.stringify({
        priority: 'P0',
        complexity: 'XL',
        estimate_hours: 16,
        tags: ['urgent', 'critical'],
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { task: Record<string, unknown> }
    expect(body.task.priority).toBe('P0')
    expect(body.task.complexity).toBe('XL')
    expect(body.task.estimate_hours).toBe(16)
    expect(body.task.tags).toEqual(['urgent', 'critical'])
    // link_document unchanged
    expect(body.task.link_document).toBe('https://docs.example.com/spec')
  })

  it('rejects invalid priority enum', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: authHeaders(humanSecret),
      body: JSON.stringify({
        project: 'test-project',
        key: 'TASK-ATTR-BAD1',
        title: 'Bad priority',
        priority: 'P9',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects invalid complexity enum', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: authHeaders(humanSecret),
      body: JSON.stringify({
        project: 'test-project',
        key: 'TASK-ATTR-BAD2',
        title: 'Bad complexity',
        complexity: 'XXL',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects negative estimate_hours', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: authHeaders(humanSecret),
      body: JSON.stringify({
        project: 'test-project',
        key: 'TASK-ATTR-BAD3',
        title: 'Bad estimate',
        estimate_hours: -5,
      }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects invalid link_document (not a URL)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: authHeaders(humanSecret),
      body: JSON.stringify({
        project: 'test-project',
        key: 'TASK-ATTR-BAD4',
        title: 'Bad link',
        link_document: 'not-a-url',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects invalid tags (non-array)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: authHeaders(humanSecret),
      body: JSON.stringify({
        project: 'test-project',
        key: 'TASK-ATTR-BAD5',
        title: 'Bad tags',
        tags: 'not-an-array',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('PATCH rejects invalid priority on update', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/TASK-ATTR-001?project=test-project`, {
      method: 'PATCH',
      headers: authHeaders(humanSecret),
      body: JSON.stringify({ priority: 'INVALID' }),
    })
    expect(res.status).toBe(400)
  })

  it('creates a task with no attributes (defaults)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: authHeaders(humanSecret),
      body: JSON.stringify({
        project: 'test-project',
        key: 'TASK-ATTR-DEF',
        title: 'Default attributes',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { task: Record<string, unknown> }
    expect(body.task.priority).toBeNull()
    expect(body.task.complexity).toBeNull()
    expect(body.task.estimate_hours).toBeNull()
    expect(body.task.tags).toEqual([])
    expect(body.task.link_document).toBeNull()
  })
})
