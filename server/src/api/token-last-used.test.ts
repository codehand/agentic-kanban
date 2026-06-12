/**
 * token-last-used.test.ts — presence telemetry on token rows (TASK-041).
 *
 * Verifies:
 *   - A freshly minted token has last_used_at = NULL, and GET /api/tokens
 *     exposes the field.
 *   - A successfully authenticated request sets last_used_at (the touch lives
 *     in resolveBearer, the single chokepoint shared by JSON API and MCP).
 *   - The throttle: a request while the stored value is < 60s old does NOT
 *     bump it (no UPDATE per request on a hot token); a stale value IS bumped.
 *   - Revoked tokens still appear in GET /api/tokens (with revoked_at set),
 *     and no secret material ever leaks.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Server } from 'node:http'
import { openMemoryDb, type Db } from '../db/connection.js'
import { runMigrations } from '../db/migrate.js'
import { createHttpServer } from '../http/server.js'
import { mintToken, revokeTokenById } from '../auth/mint.js'
import { resolveBearer } from '../auth/resolve.js'
import { getTokenById } from '../db/repositories/token.js'

let server: Server
let baseUrl: string
let db: Db
let humanSecret: string

beforeAll(async () => {
  db = openMemoryDb()
  runMigrations(db)
  const human = mintToken(db, 'human', 'lu-human')
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

const listTokensWith = (secret: string) =>
  fetch(`${baseUrl}/api/tokens`, { headers: { Authorization: `Bearer ${secret}` } })

async function lastUsedOf(id: string): Promise<string | null | undefined> {
  const res = await listTokensWith(humanSecret)
  expect(res.status).toBe(200)
  const body = await res.json() as { tokens: Array<{ id: string; last_used_at: string | null }> }
  const row = body.tokens.find((t) => t.id === id)
  return row?.last_used_at
}

/** Backdate last_used_at by `seconds` so throttle behavior is deterministic. */
function backdate(id: string, seconds: number): string {
  const iso = new Date(Date.now() - seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
  db.prepare(`UPDATE token SET last_used_at = ? WHERE id = ?`).run(iso, id)
  return iso
}

describe('last_used_at — set on first authenticated use, exposed by GET /api/tokens', () => {
  it('is NULL after mint and a non-NULL timestamp after the token authenticates a request', async () => {
    const impl = mintToken(db, 'implementer', 'lu-fresh')

    // Exposed by the API and NULL before any use.
    expect(await lastUsedOf(impl.tokenId)).toBeNull()

    // First authenticated request with the token itself → touch.
    const res = await listTokensWith(impl.secret)
    expect(res.status).toBe(200)

    const after = await lastUsedOf(impl.tokenId)
    expect(after).toBeTruthy()
    expect(Number.isFinite(Date.parse(after!))).toBe(true)
  })

  it('resolveBearer (shared by JSON API and MCP) performs the touch directly', () => {
    const judge = mintToken(db, 'judge', 'lu-mcp-path')
    expect(getTokenById(db, judge.tokenId)!.last_used_at).toBeNull()

    const resolved = resolveBearer(db, judge.secret)
    expect(resolved?.token_id).toBe(judge.tokenId)
    expect(getTokenById(db, judge.tokenId)!.last_used_at).toBeTruthy()
  })
})

describe('last_used_at — throttled (no UPDATE per request on a hot token)', () => {
  it('does NOT bump a value fresher than the 60s window', async () => {
    const runner = mintToken(db, 'runner', 'lu-hot')
    const seeded = backdate(runner.tokenId, 30) // 30s old < 60s throttle

    const res = await listTokensWith(runner.secret)
    expect(res.status).toBe(200)

    expect(await lastUsedOf(runner.tokenId)).toBe(seeded)
  })

  it('bumps a value older than the 60s window', async () => {
    const runner = mintToken(db, 'runner', 'lu-stale')
    const seeded = backdate(runner.tokenId, 120) // 2 min old > 60s throttle

    const res = await listTokensWith(runner.secret)
    expect(res.status).toBe(200)

    const after = await lastUsedOf(runner.tokenId)
    expect(after).not.toBe(seeded)
    expect(Date.parse(after!)).toBeGreaterThan(Date.parse(seeded))
  })
})

describe('GET /api/tokens — revoked rows included, no secret material', () => {
  it('lists a revoked token with revoked_at set and never leaks secret/hash', async () => {
    const victim = mintToken(db, 'runner', 'lu-revoked')
    revokeTokenById(db, victim.tokenId)

    const res = await listTokensWith(humanSecret)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain(victim.secret)
    const body = JSON.parse(text) as { tokens: Array<Record<string, unknown>> }
    const row = body.tokens.find((t) => t['id'] === victim.tokenId)
    expect(row).toBeTruthy()
    expect(row!['revoked_at']).toBeTruthy()
    expect(row).not.toHaveProperty('secret')
    expect(row).not.toHaveProperty('secret_hash')
    expect(Object.prototype.hasOwnProperty.call(row, 'last_used_at')).toBe(true)
  })
})
