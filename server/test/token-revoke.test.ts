/**
 * token-revoke.test.ts — DELETE /api/tokens/:id (TASK-032).
 *
 * Covers:
 *   - Happy path: human revokes a runner token → 200 with {id, role, label, revoked_at}
 *   - Revoked secret no longer authenticates → 401
 *   - Repeat revoke of same id → 409 (already revoked; design choice documented in task report)
 *   - Non-human caller → 403
 *   - Unknown id → 404
 *   - Last active human token cannot be revoked → 409 (lockout guard), bearer keeps working
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Server } from 'node:http'
import { openMemoryDb } from '../src/db/connection.js'
import { runMigrations } from '../src/db/migrate.js'
import { createHttpServer } from '../src/http/server.js'
import { mintToken } from '../src/auth/mint.js'
import type { Db } from '../src/db/connection.js'

let server: Server
let baseUrl: string
let db: Db
let humanId: string
let humanSecret: string
let implSecret: string

beforeAll(async () => {
  db = openMemoryDb()
  runMigrations(db)

  const human = mintToken(db, 'human', 'test-human')
  humanId = human.tokenId
  humanSecret = human.secret
  const impl = mintToken(db, 'implementer', 'test-impl')
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

const del = (id: string, secret: string) =>
  fetch(`${baseUrl}/api/tokens/${id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${secret}` },
  })

const listTokensWith = (secret: string) =>
  fetch(`${baseUrl}/api/tokens`, { headers: { 'Authorization': `Bearer ${secret}` } })

describe('DELETE /api/tokens/:id — happy path + revoked secret 401 + repeat revoke', () => {
  it('revokes a runner token, kills its secret, and rejects a repeat revoke', async () => {
    const runner = mintToken(db, 'runner', 'revoke-me')

    // Secret authenticates before revoke
    const before = await listTokensWith(runner.secret)
    expect(before.status).toBe(200)

    // Human revokes it → 200 with the revoked row
    const res = await del(runner.tokenId, humanSecret)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.id).toBe(runner.tokenId)
    expect(body.role).toBe('runner')
    expect(body.label).toBe('revoke-me')
    expect(body.revoked_at).toBeTruthy()
    // SECURITY: no secret material in the response
    expect(body).not.toHaveProperty('secret')
    expect(body).not.toHaveProperty('secret_hash')

    // Revoked secret must now get 401
    const after = await listTokensWith(runner.secret)
    expect(after.status).toBe(401)

    // Repeat revoke → 409 (already revoked)
    const again = await del(runner.tokenId, humanSecret)
    expect(again.status).toBe(409)
  })
})

describe('DELETE /api/tokens/:id — rejection paths', () => {
  it('returns 403 for a non-human caller', async () => {
    const victim = mintToken(db, 'runner', 'untouchable')
    const res = await del(victim.tokenId, implSecret)
    expect(res.status).toBe(403)
    // Token untouched: its secret still authenticates
    const check = await listTokensWith(victim.secret)
    expect(check.status).toBe(200)
  })

  it('returns 404 for an unknown token id', async () => {
    const res = await del('tk_does_not_exist', humanSecret)
    expect(res.status).toBe(404)
  })

  it('returns 401 without a bearer token', async () => {
    const res = await fetch(`${baseUrl}/api/tokens/${humanId}`, { method: 'DELETE' })
    expect(res.status).toBe(401)
  })
})

describe('DELETE /api/tokens/:id — last active human token guard', () => {
  it('allows revoking a human token while another active human token remains', async () => {
    const secondHuman = mintToken(db, 'human', 'spare-human')
    const res = await del(secondHuman.tokenId, humanSecret)
    expect(res.status).toBe(200)
  })

  it('rejects revoking the last active human token and keeps the bearer working', async () => {
    const res = await del(humanId, humanSecret)
    expect(res.status).toBe(409)
    const body = await res.json() as Record<string, unknown>
    expect(String(body.error)).toMatch(/last active human/i)

    // Operator is NOT locked out
    const check = await listTokensWith(humanSecret)
    expect(check.status).toBe(200)
    const tokens = (await check.json() as { tokens: Array<{ id: string; revoked_at: string | null }> }).tokens
    expect(tokens.some((t) => t.id === humanId && !t.revoked_at)).toBe(true)
  })
})
