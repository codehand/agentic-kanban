/**
 * ready-to-review.test.ts — TASK-051.
 *
 * Proves, via the REAL statemachine + authorize + route handlers:
 *   - the new edges JUDGE_PASSED→READY_TO_REVIEW (pr-bot) and
 *     READY_TO_REVIEW→DONE (human) exist, the legacy JUDGE_PASSED→DONE (human)
 *     edge is unchanged, and pr-bot can NOT self-approve (negative case);
 *   - pr-bot's permission set is exactly { ready_to_review, update, read };
 *   - PATCH /api/tasks/:key persists a valid pr_url, rejects non-http(s) with
 *     400, and null clears it;
 *   - POST /api/tasks/:key/approve succeeds from READY_TO_REVIEW and from
 *     JUDGE_PASSED, and is still blocked (409) by an unmet dependency.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Server } from 'node:http'
import { isAllowed, allowedRole } from '../src/domain/statemachine.js'
import { authorize } from '../src/auth/authorize.js'
import { openMemoryDb } from '../src/db/connection.js'
import { runMigrations } from '../src/db/migrate.js'
import { createHttpServer } from '../src/http/server.js'
import { mintToken } from '../src/auth/mint.js'
import { insertProject } from '../src/db/repositories/project.js'
import { insertTask } from '../src/db/repositories/task.js'
import { getTaskByKey } from '../src/db/repositories/task.js'
import { setDependencies } from '../src/db/repositories/dependency.js'
import { _clearClients } from '../src/api/stream.js'
import type { Db } from '../src/db/connection.js'

// ---------------------------------------------------------------------------
// State machine edges (AC3b)
// ---------------------------------------------------------------------------

describe('TASK-051 state machine: READY_TO_REVIEW + pr-bot', () => {
  it('pr-bot CAN move JUDGE_PASSED → READY_TO_REVIEW', () => {
    expect(isAllowed('JUDGE_PASSED', 'READY_TO_REVIEW', 'pr-bot')).toBe(true)
  })

  it('human CAN approve READY_TO_REVIEW → DONE', () => {
    expect(isAllowed('READY_TO_REVIEW', 'DONE', 'human')).toBe(true)
  })

  it('human CAN still approve JUDGE_PASSED → DONE (unchanged path)', () => {
    expect(isAllowed('JUDGE_PASSED', 'DONE', 'human')).toBe(true)
  })

  it('pr-bot CANNOT self-approve JUDGE_PASSED → DONE (negative)', () => {
    expect(isAllowed('JUDGE_PASSED', 'DONE', 'pr-bot')).toBe(false)
  })

  it('pr-bot CANNOT approve READY_TO_REVIEW → DONE (negative)', () => {
    expect(isAllowed('READY_TO_REVIEW', 'DONE', 'pr-bot')).toBe(false)
  })

  it('allowedRole resolves the new edges to their required roles', () => {
    expect(allowedRole('JUDGE_PASSED', 'READY_TO_REVIEW')).toBe('pr-bot')
    expect(allowedRole('READY_TO_REVIEW', 'DONE')).toBe('human')
  })
})

// ---------------------------------------------------------------------------
// pr-bot authorization (AC3b)
// ---------------------------------------------------------------------------

describe('TASK-051 authorize: pr-bot permissions', () => {
  it('pr-bot CAN do ready_to_review, update, read', () => {
    expect(authorize('pr-bot', 'task.transition.ready_to_review')).toBe(true)
    expect(authorize('pr-bot', 'task.update')).toBe(true)
    expect(authorize('pr-bot', 'read')).toBe(true)
  })

  it('pr-bot CANNOT approve, judge, mint, or self-check', () => {
    expect(authorize('pr-bot', 'task.transition.approve')).toBe(false)
    expect(authorize('pr-bot', 'task.transition.judge')).toBe(false)
    expect(authorize('pr-bot', 'token.mint')).toBe(false)
    expect(authorize('pr-bot', 'task.transition.self_check')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Route + repo: pr_url PATCH and approve from READY_TO_REVIEW (AC3c/AC3d/AC5)
// ---------------------------------------------------------------------------

describe('TASK-051 routes: pr_url + approve from READY_TO_REVIEW', () => {
  let server: Server
  let baseUrl: string
  let db: Db
  let humanSecret: string
  const PROJECT_ID = 'proj_rtr'
  const SLUG = 'rtr-proj'

  function seedTask(key: string, state: string): string {
    const id = `task_${key}`
    insertTask(db, { id, project_id: PROJECT_ID, key, title: `t ${key}`, body_md: 'b', state })
    return id
  }

  beforeAll(async () => {
    db = openMemoryDb()
    runMigrations(db)
    insertProject(db, { id: PROJECT_ID, slug: SLUG, name: 'RTR' })
    humanSecret = mintToken(db, 'human', 'h').secret

    server = createHttpServer(db)
    await new Promise<void>((resolve) => server.listen(0, () => resolve()))
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
  })

  const auth = () => ({ Authorization: `Bearer ${humanSecret}`, 'Content-Type': 'application/json' })

  it('PATCH persists a valid pr_url and taskToResult exposes it', async () => {
    seedTask('TASK-PR1', 'JUDGE_PASSED')
    const res = await fetch(`${baseUrl}/api/tasks/TASK-PR1?project=${SLUG}`, {
      method: 'PATCH',
      headers: auth(),
      body: JSON.stringify({ pr_url: 'https://git.example.com/pr/1' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { task: { pr_url: string } }
    expect(body.task.pr_url).toBe('https://git.example.com/pr/1')
    expect(getTaskByKey(db, PROJECT_ID, 'TASK-PR1')!.pr_url).toBe('https://git.example.com/pr/1')
  })

  it('PATCH rejects a non-http(s) pr_url with 400 (javascript: blocked)', async () => {
    seedTask('TASK-PR2', 'JUDGE_PASSED')
    const res = await fetch(`${baseUrl}/api/tasks/TASK-PR2?project=${SLUG}`, {
      method: 'PATCH',
      headers: auth(),
      body: JSON.stringify({ pr_url: 'javascript:alert(1)' }),
    })
    expect(res.status).toBe(400)
    // Not persisted.
    expect(getTaskByKey(db, PROJECT_ID, 'TASK-PR2')!.pr_url).toBeNull()
  })

  it('PATCH with null clears a previously-set pr_url', async () => {
    const id = seedTask('TASK-PR3', 'JUDGE_PASSED')
    db.prepare('UPDATE task SET pr_url = ? WHERE id = ?').run('https://git.example.com/pr/3', id)
    const res = await fetch(`${baseUrl}/api/tasks/TASK-PR3?project=${SLUG}`, {
      method: 'PATCH',
      headers: auth(),
      body: JSON.stringify({ pr_url: null }),
    })
    expect(res.status).toBe(200)
    expect(getTaskByKey(db, PROJECT_ID, 'TASK-PR3')!.pr_url).toBeNull()
  })

  it('approve succeeds from READY_TO_REVIEW (human)', async () => {
    _clearClients()
    seedTask('TASK-PR4', 'READY_TO_REVIEW')
    const res = await fetch(`${baseUrl}/api/tasks/TASK-PR4/approve?project=${SLUG}`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    expect(getTaskByKey(db, PROJECT_ID, 'TASK-PR4')!.state).toBe('DONE')
  })

  it('approve still succeeds from JUDGE_PASSED (pr-bot offline path)', async () => {
    _clearClients()
    seedTask('TASK-PR5', 'JUDGE_PASSED')
    const res = await fetch(`${baseUrl}/api/tasks/TASK-PR5/approve?project=${SLUG}`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    expect(getTaskByKey(db, PROJECT_ID, 'TASK-PR5')!.state).toBe('DONE')
  })

  it('approve from READY_TO_REVIEW is blocked (409) by an unmet dependency', async () => {
    _clearClients()
    const depId = seedTask('TASK-PR6DEP', 'JUDGE_PASSED') // not DONE
    const taskId = seedTask('TASK-PR6', 'READY_TO_REVIEW')
    setDependencies(db, taskId, [depId])
    const res = await fetch(`${baseUrl}/api/tasks/TASK-PR6/approve?project=${SLUG}`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(409)
    // Still READY_TO_REVIEW — the block prevented the transition.
    expect(getTaskByKey(db, PROJECT_ID, 'TASK-PR6')!.state).toBe('READY_TO_REVIEW')
  })
})
