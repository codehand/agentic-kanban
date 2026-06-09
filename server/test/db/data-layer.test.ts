import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/db/connection.js'
import { runMigrations } from '../../src/db/migrate.js'
import * as projectRepo from '../../src/db/repositories/project.js'
import * as taskRepo from '../../src/db/repositories/task.js'
import * as transitionRepo from '../../src/db/repositories/transition.js'
import * as commentRepo from '../../src/db/repositories/comment.js'
import * as evidenceRepo from '../../src/db/repositories/evidence.js'
import * as gitrefRepo from '../../src/db/repositories/gitref.js'
import * as tokenRepo from '../../src/db/repositories/token.js'
import type { Db } from '../../src/db/connection.js'

// Use :memory: so each test run is isolated
function freshDb(): Db {
  const db = openDatabase(':memory:')
  runMigrations(db)
  return db
}

// ---------------------------------------------------------------------------
// Migration idempotency
// ---------------------------------------------------------------------------
describe('migration idempotency', () => {
  it('can run migrations twice without error', () => {
    const db = openDatabase(':memory:')
    runMigrations(db)
    // Second call must not throw
    expect(() => runMigrations(db)).not.toThrow()
  })

  it('does not duplicate migration entries on re-run', () => {
    const db = openDatabase(':memory:')
    runMigrations(db)
    runMigrations(db)
    const rows = db
      .prepare('SELECT name FROM _migrations ORDER BY name')
      .all() as { name: string }[]
    // Each migration file should appear exactly once
    const names = rows.map((r) => r.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('0001_init.sql')
  })

  it('creates all 7 tables', () => {
    const db = freshDb()
    const tables = (
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_migrations'`,
        )
        .all() as { name: string }[]
    ).map((r) => r.name)
    for (const tbl of ['project', 'task', 'transition', 'comment', 'evidence', 'gitref', 'token']) {
      expect(tables).toContain(tbl)
    }
  })
})

// ---------------------------------------------------------------------------
// project CRUD
// ---------------------------------------------------------------------------
describe('project repository', () => {
  it('insert and retrieve by id', () => {
    const db = freshDb()
    const p = projectRepo.insertProject(db, { id: 'p1', slug: 'my-proj', name: 'My Project' })
    expect(p.id).toBe('p1')
    expect(p.slug).toBe('my-proj')
    const found = projectRepo.getProjectById(db, 'p1')
    expect(found?.name).toBe('My Project')
  })

  it('list all projects', () => {
    const db = freshDb()
    projectRepo.insertProject(db, { id: 'p1', slug: 'a', name: 'A' })
    projectRepo.insertProject(db, { id: 'p2', slug: 'b', name: 'B' })
    expect(projectRepo.listProjects(db)).toHaveLength(2)
  })

  it('get by slug', () => {
    const db = freshDb()
    projectRepo.insertProject(db, { id: 'p1', slug: 'alpha', name: 'Alpha' })
    expect(projectRepo.getProjectBySlug(db, 'alpha')?.id).toBe('p1')
  })
})

// ---------------------------------------------------------------------------
// task CRUD
// ---------------------------------------------------------------------------
describe('task repository', () => {
  let db: Db
  beforeEach(() => {
    db = freshDb()
    projectRepo.insertProject(db, { id: 'p1', slug: 'proj', name: 'Project' })
  })

  it('insert and retrieve', () => {
    const t = taskRepo.insertTask(db, {
      id: 't1',
      project_id: 'p1',
      key: 'TASK-001',
      title: 'First task',
    })
    expect(t.state).toBe('TODO')
    expect(t.allow_no_code_change).toBe(0)
  })

  it('key is unique within project', () => {
    taskRepo.insertTask(db, { id: 't1', project_id: 'p1', key: 'TASK-001', title: 'T1' })
    expect(() =>
      taskRepo.insertTask(db, { id: 't2', project_id: 'p1', key: 'TASK-001', title: 'T2' }),
    ).toThrow()
  })

  it('list tasks by project and state filter', () => {
    taskRepo.insertTask(db, { id: 't1', project_id: 'p1', key: 'TASK-001', title: 'T1' })
    taskRepo.insertTask(db, {
      id: 't2',
      project_id: 'p1',
      key: 'TASK-002',
      title: 'T2',
      state: 'IN_PROGRESS',
    })
    expect(taskRepo.listTasksByProject(db, 'p1')).toHaveLength(2)
    expect(taskRepo.listTasksByProject(db, 'p1', 'TODO')).toHaveLength(1)
    expect(taskRepo.listTasksByProject(db, 'p1', 'IN_PROGRESS')).toHaveLength(1)
  })

  it('update state via gate only — updateTaskState is no longer public', () => {
    taskRepo.insertTask(db, { id: 't1', project_id: 'p1', key: 'TASK-001', title: 'T1' })
    // updateTaskState is internal; state must be written through the gate.
    expect((taskRepo as any).updateTaskState).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// transition — append-only (UPDATE/DELETE must be rejected)
// ---------------------------------------------------------------------------
describe('transition repository — append-only', () => {
  let db: Db
  beforeEach(() => {
    db = freshDb()
    projectRepo.insertProject(db, { id: 'p1', slug: 'proj', name: 'Project' })
    taskRepo.insertTask(db, { id: 't1', project_id: 'p1', key: 'TASK-001', title: 'T1' })
  })

  it('insert transition', () => {
    const tr = transitionRepo.insertTransition(db, {
      id: 'tr1',
      task_id: 't1',
      from_state: 'TODO',
      to_state: 'IN_PROGRESS',
      actor_role: 'implementer',
      actor_token_id: 'tok1',
    })
    expect(tr.id).toBe('tr1')
  })

  it('UPDATE on transition is rejected (trigger)', () => {
    transitionRepo.insertTransition(db, {
      id: 'tr1',
      task_id: 't1',
      from_state: 'TODO',
      to_state: 'IN_PROGRESS',
      actor_role: 'implementer',
      actor_token_id: 'tok1',
    })
    expect(() =>
      db.prepare(`UPDATE transition SET note = 'hacked' WHERE id = 'tr1'`).run(),
    ).toThrow(/append-only/)
  })

  it('DELETE on transition is rejected (trigger)', () => {
    transitionRepo.insertTransition(db, {
      id: 'tr1',
      task_id: 't1',
      from_state: 'TODO',
      to_state: 'IN_PROGRESS',
      actor_role: 'implementer',
      actor_token_id: 'tok1',
    })
    expect(() =>
      db.prepare(`DELETE FROM transition WHERE id = 'tr1'`).run(),
    ).toThrow(/append-only/)
  })
})

// ---------------------------------------------------------------------------
// comment CRUD
// ---------------------------------------------------------------------------
describe('comment repository', () => {
  let db: Db
  beforeEach(() => {
    db = freshDb()
    projectRepo.insertProject(db, { id: 'p1', slug: 'proj', name: 'Project' })
    taskRepo.insertTask(db, { id: 't1', project_id: 'p1', key: 'TASK-001', title: 'T1' })
  })

  it('insert and list comments', () => {
    commentRepo.insertComment(db, {
      id: 'c1',
      task_id: 't1',
      author_role: 'implementer',
      author_token_id: 'tok1',
      kind: 'narrative',
      body_md: 'Done the work',
    })
    commentRepo.insertComment(db, {
      id: 'c2',
      task_id: 't1',
      author_role: 'judge',
      author_token_id: 'tok2',
      kind: 'verdict',
      verdict: 'PASS',
    })
    const comments = commentRepo.listCommentsByTask(db, 't1')
    expect(comments).toHaveLength(2)
    expect(comments[1].verdict).toBe('PASS')
  })
})

// ---------------------------------------------------------------------------
// evidence — append-only (UPDATE/DELETE must be rejected)
// ---------------------------------------------------------------------------
describe('evidence repository — append-only', () => {
  let db: Db
  beforeEach(() => {
    db = freshDb()
    projectRepo.insertProject(db, { id: 'p1', slug: 'proj', name: 'Project' })
    taskRepo.insertTask(db, { id: 't1', project_id: 'p1', key: 'TASK-001', title: 'T1' })
  })

  it('insert evidence', () => {
    const ev = evidenceRepo.insertEvidence(db, {
      id: 'ev1',
      task_id: 't1',
      submitted_by_token_id: 'runner-tok',
      build_exit: 0,
      test_exit: 0,
      ac_exit: 0,
      coverage_pct: 85.5,
      manifest_json: '{"server/src/db/connection.ts": "abc123"}',
      logs_json: '{"build": "sha:xyz"}',
    })
    expect(ev.build_exit).toBe(0)
    expect(ev.coverage_pct).toBe(85.5)
  })

  it('UPDATE on evidence is rejected (trigger)', () => {
    evidenceRepo.insertEvidence(db, {
      id: 'ev1',
      task_id: 't1',
      submitted_by_token_id: 'runner-tok',
      build_exit: 0,
      test_exit: 0,
      ac_exit: 0,
    })
    expect(() =>
      db.prepare(`UPDATE evidence SET build_exit = 1 WHERE id = 'ev1'`).run(),
    ).toThrow(/append-only/)
  })

  it('DELETE on evidence is rejected (trigger)', () => {
    evidenceRepo.insertEvidence(db, {
      id: 'ev1',
      task_id: 't1',
      submitted_by_token_id: 'runner-tok',
      build_exit: 0,
      test_exit: 0,
      ac_exit: 0,
    })
    expect(() =>
      db.prepare(`DELETE FROM evidence WHERE id = 'ev1'`).run(),
    ).toThrow(/append-only/)
  })

  it('getLatestEvidenceByTask returns most recent', () => {
    evidenceRepo.insertEvidence(db, {
      id: 'ev1',
      task_id: 't1',
      submitted_by_token_id: 'runner-tok',
      build_exit: 1,
      test_exit: 1,
      ac_exit: 1,
    })
    evidenceRepo.insertEvidence(db, {
      id: 'ev2',
      task_id: 't1',
      submitted_by_token_id: 'runner-tok',
      build_exit: 0,
      test_exit: 0,
      ac_exit: 0,
    })
    const latest = evidenceRepo.getLatestEvidenceByTask(db, 't1')
    expect(latest?.id).toBe('ev2')
  })
})

// ---------------------------------------------------------------------------
// gitref CRUD + updatability
// ---------------------------------------------------------------------------
describe('gitref repository', () => {
  let db: Db
  beforeEach(() => {
    db = freshDb()
    projectRepo.insertProject(db, { id: 'p1', slug: 'proj', name: 'Project' })
    taskRepo.insertTask(db, { id: 't1', project_id: 'p1', key: 'TASK-001', title: 'T1' })
  })

  it('insert and retrieve', () => {
    const g = gitrefRepo.insertGitRef(db, {
      id: 'gr1',
      task_id: 't1',
      repo: '.',
      branch: 'fix/TASK-001',
      base_sha: 'aaaa',
      head_sha: 'bbbb',
    })
    expect(g.base_sha).toBe('aaaa')
    expect(g.mr_url).toBeNull()
  })

  it('update head_sha and mr_url (gitref is updatable)', () => {
    gitrefRepo.insertGitRef(db, {
      id: 'gr1',
      task_id: 't1',
      repo: '.',
      branch: 'fix/TASK-001',
      base_sha: 'aaaa',
      head_sha: 'bbbb',
    })
    const updated = gitrefRepo.updateGitRef(db, 'gr1', {
      head_sha: 'cccc',
      mr_url: 'https://gitlab.example.com/mr/1',
    })
    expect(updated?.head_sha).toBe('cccc')
    expect(updated?.mr_url).toBe('https://gitlab.example.com/mr/1')
  })
})

// ---------------------------------------------------------------------------
// token CRUD
// ---------------------------------------------------------------------------
describe('token repository', () => {
  it('insert, list active, and revoke', () => {
    const db = freshDb()
    tokenRepo.insertToken(db, {
      id: 'tok1',
      role: 'implementer',
      label: 'impl-agent',
      secret_hash: 'hash1',
    })
    tokenRepo.insertToken(db, {
      id: 'tok2',
      role: 'runner',
      label: 'ci-runner',
      secret_hash: 'hash2',
    })
    expect(tokenRepo.listActiveTokens(db)).toHaveLength(2)

    tokenRepo.revokeToken(db, 'tok1')
    expect(tokenRepo.listActiveTokens(db)).toHaveLength(1)
    expect(tokenRepo.getTokenById(db, 'tok1')?.revoked_at).not.toBeNull()
  })
})
