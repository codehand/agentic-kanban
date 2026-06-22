/**
 * comment-verdict-rest.test.ts — B2 (TASK-059).
 *
 * REST `POST /api/tasks/:key/comments` must reach kind/verdict parity with the
 * MCP `comment.add` tool:
 *   - a judge can post `{kind:'verdict', verdict:'PASS'}` and it persists as
 *     kind='verdict' + verdict='PASS' (visible in GET /api/tasks/:key);
 *   - the default (no kind) still stores kind='review';
 *   - a human posting kind:'verdict' is rejected 403 (lacks comment.verdict);
 *   - an out-of-enum kind returns 400;
 *   - a missing body_md returns 422.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Server } from 'node:http'
import { openMemoryDb } from '../src/db/connection.js'
import { runMigrations } from '../src/db/migrate.js'
import { createHttpServer } from '../src/http/server.js'
import { mintToken } from '../src/auth/mint.js'
import { insertProject } from '../src/db/repositories/project.js'
import { insertTask } from '../src/db/repositories/task.js'
import type { Db } from '../src/db/connection.js'

let server: Server
let baseUrl: string
let db: Db
let humanSecret: string
let judgeSecret: string

const PROJECT_SLUG = 'cmt-proj'
const TASK_KEY = 'TASK-CMT-1'

beforeAll(async () => {
  db = openMemoryDb()
  runMigrations(db)

  insertProject(db, { id: 'proj_cmt', slug: PROJECT_SLUG, name: 'Comment Project' })
  insertTask(db, {
    id: 'task_cmt_1',
    project_id: 'proj_cmt',
    key: TASK_KEY,
    title: 'Comment parity task',
    body_md: 'body',
    state: 'SELF_CHECK_PASSED',
  })

  humanSecret = mintToken(db, 'human', 'cmt-human').secret
  judgeSecret = mintToken(db, 'judge', 'cmt-judge').secret

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

function postComment(secret: string, payload: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/tasks/${TASK_KEY}/comments?project=${PROJECT_SLUG}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

async function getComments(): Promise<Array<{ kind: string; verdict: string | null; body_md: string }>> {
  const res = await fetch(`${baseUrl}/api/tasks/${TASK_KEY}?project=${PROJECT_SLUG}`, {
    headers: { 'Authorization': `Bearer ${humanSecret}` },
  })
  expect(res.status).toBe(200)
  const body = await res.json() as { comments: Array<{ kind: string; verdict: string | null; body_md: string }> }
  return body.comments
}

describe('B2: REST comment kind/verdict parity', () => {
  it('a judge can post a verdict comment that persists kind=verdict + verdict=PASS', async () => {
    const res = await postComment(judgeSecret, { kind: 'verdict', verdict: 'PASS', body_md: 'looks good — PASS' })
    expect(res.status).toBe(201)
    const created = (await res.json() as { comment: { kind: string; verdict: string | null } }).comment
    expect(created.kind).toBe('verdict')
    expect(created.verdict).toBe('PASS')

    const comments = await getComments()
    const verdictComment = comments.find((c) => c.body_md === 'looks good — PASS')
    expect(verdictComment).toBeDefined()
    expect(verdictComment!.kind).toBe('verdict')
    expect(verdictComment!.verdict).toBe('PASS')
  })

  it('default (no kind) still stores kind=review with null verdict', async () => {
    const res = await postComment(humanSecret, { body_md: 'a plain review note' })
    expect(res.status).toBe(201)
    const created = (await res.json() as { comment: { kind: string; verdict: string | null } }).comment
    expect(created.kind).toBe('review')
    expect(created.verdict).toBeNull()
  })

  it('a human posting kind:verdict is rejected 403', async () => {
    const res = await postComment(humanSecret, { kind: 'verdict', verdict: 'PASS', body_md: 'human verdict attempt' })
    expect(res.status).toBe(403)
  })

  it('an out-of-enum kind returns 400', async () => {
    const res = await postComment(judgeSecret, { kind: 'bogus', body_md: 'bad kind' })
    expect(res.status).toBe(400)
  })

  it('missing body_md returns 422', async () => {
    const res = await postComment(humanSecret, { kind: 'review' })
    expect(res.status).toBe(422)
  })
})
