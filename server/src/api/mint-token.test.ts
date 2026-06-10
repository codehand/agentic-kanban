/**
 * mint-token.test.ts — AC7 tests for POST /api/tokens (TASK-024).
 *
 * Verifies:
 *   - POST /api/tokens by a human returns { id, role, label, project, secret }.
 *   - The secret is a non-empty string, not present in GET /api/tokens output.
 *   - 401 without Authorization header.
 *   - 403 for non-human role (e.g. implementer).
 *   - 400 for invalid role.
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
let implSecret: string

beforeAll(async () => {
  db = openMemoryDb()
  runMigrations(db)

  const human = mintToken(db, 'human', 'test-human-mint')
  humanSecret = human.secret
  const impl = mintToken(db, 'implementer', 'test-impl-mint')
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

describe('AC7: POST /api/tokens — mint returns secret', () => {
  it('human can mint a token and receives a secret', async () => {
    const res = await fetch(`${baseUrl}/api/tokens`, {
      method: 'POST',
      headers: authHeaders(humanSecret),
      body: JSON.stringify({ role: 'judge', label: 'judge-minted', project: null }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { id: string; role: string; label: string; secret: string }
    expect(body.id).toMatch(/^tk_/)
    expect(body.role).toBe('judge')
    expect(body.label).toBe('judge-minted')
    expect(typeof body.secret).toBe('string')
    expect(body.secret.length).toBeGreaterThan(0)
  })

  it('minted secret is NOT leaked by GET /api/tokens', async () => {
    // Mint first
    const mintRes = await fetch(`${baseUrl}/api/tokens`, {
      method: 'POST',
      headers: authHeaders(humanSecret),
      body: JSON.stringify({ role: 'runner', label: 'runner-leak-check' }),
    })
    expect(mintRes.status).toBe(200)
    const minted = await mintRes.json() as { secret: string; id: string }
    expect(minted.secret).toBeTruthy()

    // List tokens — response body must not contain the secret
    const listRes = await fetch(`${baseUrl}/api/tokens`, {
      headers: authHeaders(humanSecret),
    })
    expect(listRes.status).toBe(200)
    const text = await listRes.text()
    expect(text).not.toContain(minted.secret)
    // Also verify the JSON structure has no `secret` field on any token
    const list = JSON.parse(text) as { tokens: Array<Record<string, unknown>> }
    for (const t of list.tokens) {
      expect(Object.prototype.hasOwnProperty.call(t, 'secret')).toBe(false)
    }
  })
})

describe('AC7: POST /api/tokens — auth + role enforcement', () => {
  it('returns 401 without Authorization header', async () => {
    const res = await fetch(`${baseUrl}/api/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'judge', label: 'no-auth' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when caller is not human', async () => {
    const res = await fetch(`${baseUrl}/api/tokens`, {
      method: 'POST',
      headers: authHeaders(implSecret),
      body: JSON.stringify({ role: 'judge', label: 'impl-try-mint' }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 400 for invalid role', async () => {
    const res = await fetch(`${baseUrl}/api/tokens`, {
      method: 'POST',
      headers: authHeaders(humanSecret),
      body: JSON.stringify({ role: 'not-a-real-role', label: 'bad-role' }),
    })
    expect(res.status).toBe(400)
  })
})
