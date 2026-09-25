/**
 * task-share.test.ts — TASK-076 read-only share links.
 *
 *   (a) POST /api/tasks/:key/shares for every valid ttl: expires_at ≈ now+ttl,
 *       forever -> null.
 *   (b) error matrix: bad ttl/token 400, non-human 403, other-project scope
 *       403, no auth 401, unknown task 404, duplicate token 409.
 *   (c) GET /api/share/:token without a bearer returns exactly the shared task.
 *   (d) expired / unknown / removed-task links: all 404 with an identical body.
 *   (e) a share token is not a bearer: /api/tasks/:key with it -> 401.
 *   (f) the DB stores only the SHA-256 hash, never the raw token.
 *   (g) mountStatic serves /s/<token> with the share page.
 *   plus: GET /api/share-origin is gone (TASK-077) — the share link origin is
 *   the owner's location.origin, so the route 404s like any unknown /api path.
 *
 * Runs a real node:http server (createHttpServer) over an in-memory SQLite DB.
 * Expiry is exercised with an expires_at in the past (no real sleeping).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Server } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { openMemoryDb, type Db } from '../src/db/connection.js'
import { runMigrations } from '../src/db/migrate.js'
import { createHttpServer } from '../src/http/server.js'
import { mintToken } from '../src/auth/mint.js'
import { insertProject } from '../src/db/repositories/project.js'
import { insertTask } from '../src/db/repositories/task.js'
import { insertComment } from '../src/db/repositories/comment.js'

const ALPHA_ID = 'proj_alpha'
const BETA_ID = 'proj_beta'
const TTLS = [300, 900, 3600, 86400]

let db: Db
let server: Server
let baseUrl: string
let human: { tokenId: string; secret: string }
let humanBeta: { tokenId: string; secret: string }
let judge: { tokenId: string; secret: string }

/** Same shape the UI generates: 16 CSPRNG bytes, base64url (22 chars). */
function newToken(): string {
  return randomBytes(16).toString('base64url')
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

const createShare = (key: string, body: unknown, secret: string | null = human.secret, project = 'alpha') =>
  fetch(`${baseUrl}/api/tasks/${key}/shares?project=${project}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(body),
  })

const getShare = (token: string) => fetch(`${baseUrl}/api/share/${token}`)

beforeAll(async () => {
  db = openMemoryDb()
  runMigrations(db)
  insertProject(db, { id: ALPHA_ID, slug: 'alpha', name: 'Alpha' })
  insertProject(db, { id: BETA_ID, slug: 'beta', name: 'Beta' })
  insertTask(db, { id: 'task_A1', project_id: ALPHA_ID, key: 'A-1', title: 'Shared alpha task', body_md: 'Alpha spec body' })
  insertTask(db, { id: 'task_A2', project_id: ALPHA_ID, key: 'A-2', title: 'Other alpha task', body_md: 'SECRET other spec' })
  insertTask(db, { id: 'task_ADEL', project_id: ALPHA_ID, key: 'A-DEL', title: 'Will be removed' })
  insertTask(db, { id: 'task_B1', project_id: BETA_ID, key: 'B-1', title: 'Beta task' })
  human = mintToken(db, 'human', 'human')
  humanBeta = mintToken(db, 'human', 'human-beta', BETA_ID)
  judge = mintToken(db, 'judge', 'judge')
  insertComment(db, {
    id: 'cm_1', task_id: 'task_A1', author_role: 'judge', author_token_id: judge.tokenId,
    kind: 'verdict', verdict: 'PASS', body_md: 'Looks right',
  })

  server = createHttpServer(db)
  await new Promise<void>((r) => server.listen(0, () => r()))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((r, j) => server.close((err) => (err ? j(err) : r())))
})

describe('(a) create share: server-computed expires_at per ttl', () => {
  for (const ttl of TTLS) {
    it(`ttl=${ttl} -> 201, expires_at ≈ now + ${ttl}s`, async () => {
      const before = Date.now()
      const res = await createShare('A-1', { token: newToken(), ttl })
      const after = Date.now()
      expect(res.status).toBe(201)
      const body = (await res.json()) as { expires_at: string }
      const exp = Date.parse(body.expires_at)
      expect(Number.isFinite(exp)).toBe(true)
      expect(exp).toBeGreaterThanOrEqual(before + ttl * 1000 - 1000)
      expect(exp).toBeLessThanOrEqual(after + ttl * 1000 + 1000)
    })
  }

  it('ttl=null (forever) -> 201, expires_at null, stored NULL', async () => {
    const token = newToken()
    const res = await createShare('A-1', { token, ttl: null })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ expires_at: null })
    const row = db.prepare('SELECT expires_at, created_by FROM task_share WHERE token_hash = ?').get(sha256(token)) as { expires_at: string | null; created_by: string }
    expect(row.expires_at).toBeNull()
    expect(row.created_by).toBe(human.tokenId)
  })

  it('ignores any client-sent expires_at', async () => {
    const res = await createShare('A-1', { token: newToken(), ttl: 300, expires_at: '2999-01-01T00:00:00Z' })
    expect(res.status).toBe(201)
    const { expires_at } = (await res.json()) as { expires_at: string }
    expect(Date.parse(expires_at)).toBeLessThan(Date.now() + 301_000)
  })
})

describe('(b) create share: error matrix', () => {
  for (const ttl of [60, 0, -300, 301, '300', true, 1e12]) {
    it(`ttl=${JSON.stringify(ttl)} -> 400`, async () => {
      const res = await createShare('A-1', { token: newToken(), ttl })
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toMatch(/ttl/i)
    })
  }

  it('missing ttl -> 400', async () => {
    const res = await createShare('A-1', { token: newToken() })
    expect(res.status).toBe(400)
  })

  for (const token of ['short', 'a'.repeat(21), 'a'.repeat(65), 'has space in it abcdefghijk', 'plus+slash/equals=abcdefghij', 12345, null]) {
    it(`token=${JSON.stringify(token)} -> 400`, async () => {
      const res = await createShare('A-1', { token, ttl: 300 })
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toMatch(/token/i)
    })
  }

  it('non-human role -> 403', async () => {
    const res = await createShare('A-1', { token: newToken(), ttl: 300 }, judge.secret)
    expect(res.status).toBe(403)
  })

  it('human token scoped to another project -> 403 (and succeeds on its own project)', async () => {
    const own = await createShare('B-1', { token: newToken(), ttl: 300 }, humanBeta.secret, 'beta')
    expect(own.status).toBe(201)
    const res = await createShare('A-1', { token: newToken(), ttl: 300 }, humanBeta.secret, 'alpha')
    expect(res.status).toBe(403)
  })

  it('missing auth -> 401; invalid bearer -> 401', async () => {
    expect((await createShare('A-1', { token: newToken(), ttl: 300 }, null)).status).toBe(401)
    expect((await createShare('A-1', { token: newToken(), ttl: 300 }, 'not-a-real-secret')).status).toBe(401)
  })

  it('unknown task -> 404; unknown project -> 404', async () => {
    expect((await createShare('NOPE-1', { token: newToken(), ttl: 300 })).status).toBe(404)
    expect((await createShare('A-1', { token: newToken(), ttl: 300 }, human.secret, 'nope')).status).toBe(404)
  })

  it('duplicate token -> 409, first link keeps working', async () => {
    const token = newToken()
    expect((await createShare('A-1', { token, ttl: null })).status).toBe(201)
    const dup = await createShare('A-2', { token, ttl: 300 })
    expect(dup.status).toBe(409)
    const view = await getShare(token)
    expect(view.status).toBe(200)
    expect(((await view.json()) as { task: { key: string } }).task.key).toBe('A-1')
  })
})

describe('(c) GET /api/share/:token is public and task-scoped', () => {
  it('returns the shared task payload without a bearer', async () => {
    const token = newToken()
    const created = await createShare('A-1', { token, ttl: 3600 })
    const { expires_at } = (await created.json()) as { expires_at: string }

    const res = await getShare(token) // no Authorization header
    expect(res.status).toBe(200)
    const text = await res.text()
    const body = JSON.parse(text) as Record<string, unknown> & {
      task: { key: string; title: string; body_md: string }
      comments: { body_md: string }[]
      timeline: unknown[]
      gitrefs: unknown[]
    }
    // No evidence row yet -> `evidence` is undefined and omitted, exactly as on GET /api/tasks/:key.
    expect(Object.keys(body).sort()).toEqual(['comments', 'expires_at', 'gitrefs', 'project', 'task', 'timeline'])
    expect(body.task.key).toBe('A-1')
    expect(body.task.title).toBe('Shared alpha task')
    expect(body.task.body_md).toBe('Alpha spec body')
    expect(body.project).toBe('alpha')
    expect(body.expires_at).toBe(expires_at)
    expect(body.comments.map((c) => c.body_md)).toEqual(['Looks right'])
    expect(Array.isArray(body.timeline)).toBe(true)
    expect(Array.isArray(body.gitrefs)).toBe(true)
    // Nothing from other tasks / projects leaks through.
    expect(text).not.toContain('SECRET other spec')
    expect(text).not.toContain('A-2')
    expect(text).not.toContain('Beta')
  })

  it('same payload as the authenticated GET /api/tasks/:key (plus project/expires_at)', async () => {
    const token = newToken()
    await createShare('A-1', { token, ttl: null })
    const pub = (await (await getShare(token)).json()) as Record<string, unknown>
    const auth = (await (await fetch(`${baseUrl}/api/tasks/A-1?project=alpha`, {
      headers: { Authorization: `Bearer ${human.secret}` },
    })).json()) as Record<string, unknown>
    const { project, expires_at, ...rest } = pub
    expect(project).toBe('alpha')
    expect(expires_at).toBeNull()
    expect(rest).toEqual(auth)
  })

  it('live data: an edit after sharing is visible on the next GET', async () => {
    const token = newToken()
    await createShare('A-2', { token, ttl: 300 })
    db.prepare(`UPDATE task SET title = ? WHERE id = ?`).run('Renamed after share', 'task_A2')
    const body = (await (await getShare(token)).json()) as { task: { title: string } }
    expect(body.task.title).toBe('Renamed after share')
  })
})

describe('(d) expired / unknown / removed: identical 404', () => {
  it('all three return 404 with the same body', async () => {
    // Expired: a real link whose expires_at is moved into the past.
    const expired = newToken()
    expect((await createShare('A-1', { token: expired, ttl: 300 })).status).toBe(201)
    expect((await getShare(expired)).status).toBe(200) // positive control
    db.prepare(`UPDATE task_share SET expires_at = ? WHERE token_hash = ?`)
      .run(new Date(Date.now() - 1000).toISOString(), sha256(expired))

    // Removed task: link created, then the task is removed via the real API.
    const removed = newToken()
    expect((await createShare('A-DEL', { token: removed, ttl: null })).status).toBe(201)
    expect((await getShare(removed)).status).toBe(200) // positive control
    const rm = await fetch(`${baseUrl}/api/tasks/A-DEL/remove?project=alpha`, {
      method: 'POST', headers: { Authorization: `Bearer ${human.secret}` },
    })
    expect(rm.status).toBe(200)

    const unknown = newToken()

    const results = await Promise.all([expired, unknown, removed].map(async (t) => {
      const r = await getShare(t)
      return { status: r.status, type: r.headers.get('content-type'), body: await r.text() }
    }))
    for (const r of results) expect(r.status).toBe(404)
    expect(results[1]).toEqual(results[0])
    expect(results[2]).toEqual(results[0])
    // The cascade actually dropped the removed task's link row.
    expect(db.prepare('SELECT COUNT(*) AS n FROM task_share WHERE token_hash = ?').get(sha256(removed))).toEqual({ n: 0 })
  })

  it('expiry is checked on every request (valid now, 404 once past expires_at)', async () => {
    const token = newToken()
    await createShare('A-1', { token, ttl: 900 })
    expect((await getShare(token)).status).toBe(200)
    db.prepare(`UPDATE task_share SET expires_at = ? WHERE token_hash = ?`)
      .run(new Date(Date.now() - 1).toISOString(), sha256(token))
    expect((await getShare(token)).status).toBe(404)
  })

  it('malformed tokens get the same 404 too', async () => {
    const ref = await getShare(newToken())
    const bad = await getShare('..%2F..%2Fetc')
    expect(bad.status).toBe(404)
    expect(await bad.text()).toBe(await ref.text())
  })
})

describe('(e) a share token is not a bearer', () => {
  it('Bearer <share token> on /api/tasks/:key and other routes -> 401', async () => {
    const token = newToken()
    await createShare('A-1', { token, ttl: null })
    const headers = { Authorization: `Bearer ${token}` }
    expect((await fetch(`${baseUrl}/api/tasks/A-1?project=alpha`, { headers })).status).toBe(401)
    expect((await fetch(`${baseUrl}/api/projects`, { headers })).status).toBe(401)
    expect((await fetch(`${baseUrl}/api/share-origin`, { headers })).status).toBe(401)
    expect((await fetch(`${baseUrl}/api/tasks/A-1/remove?project=alpha`, { method: 'POST', headers })).status).toBe(401)
    expect((await fetch(`${baseUrl}/api/tasks/A-1/comments?project=alpha`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ body_md: 'x' }),
    })).status).toBe(401)
    // Writes via the share path itself are not a thing either.
    expect((await fetch(`${baseUrl}/api/share/${token}`, { method: 'POST' })).status).toBe(401)
  })
})

describe('(f) only the hash is stored', () => {
  it('task_share holds sha256(token), never the raw token', async () => {
    const token = newToken()
    await createShare('A-1', { token, ttl: 300 })
    const row = db.prepare('SELECT * FROM task_share WHERE token_hash = ?').get(sha256(token)) as Record<string, unknown>
    expect(row).toBeTruthy()
    expect(row['token_hash']).toMatch(/^[0-9a-f]{64}$/)
    const all = db.prepare('SELECT * FROM task_share').all() as Record<string, unknown>[]
    const dump = JSON.stringify(all)
    expect(dump).not.toContain(token)
    // No column anywhere in the DB file contains the raw token.
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]).map((t) => t.name)
    for (const t of tables) {
      expect(JSON.stringify(db.prepare(`SELECT * FROM "${t}"`).all()), t).not.toContain(token)
    }
  })
})

describe('(g) static /s/<token> serves the share page', () => {
  it('GET /s/<token> returns share.html', async () => {
    const expected = readFileSync(resolve(process.cwd(), 'design-system/share.html'), 'utf8')
    const res = await fetch(`${baseUrl}/s/${newToken()}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toBe(expected)
  })

  it('other /s/ shapes keep falling through', async () => {
    expect((await fetch(`${baseUrl}/s/${newToken()}/extra`)).status).toBe(404)
    expect((await fetch(`${baseUrl}/s/x.js`)).status).toBe(404)
  })
})

describe('GET /api/share-origin is removed (TASK-077)', () => {
  it('human bearer -> 404, same as any unknown /api/* path', async () => {
    const headers = { Authorization: `Bearer ${human.secret}` }
    const res = await fetch(`${baseUrl}/api/share-origin`, { headers })
    expect(res.status).toBe(404)
    const unknown = await fetch(`${baseUrl}/api/no-such-route`, { headers })
    expect(unknown.status).toBe(404)
    expect(await res.json()).toEqual(await unknown.json())
  })

  it('auth still runs first: no auth -> 401', async () => {
    expect((await fetch(`${baseUrl}/api/share-origin`)).status).toBe(401)
  })
})
