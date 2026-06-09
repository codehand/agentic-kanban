import type { Db } from '../connection.js'

export interface Evidence {
  id: string
  task_id: string
  submitted_by_token_id: string
  build_exit: number
  test_exit: number
  lint_exit: number | null
  ac_exit: number
  coverage_pct: number | null
  manifest_json: string
  logs_json: string
  created_at: string
}

export interface NewEvidence {
  id: string
  task_id: string
  submitted_by_token_id: string
  build_exit: number
  test_exit: number
  lint_exit?: number
  ac_exit: number
  coverage_pct?: number
  manifest_json?: string
  logs_json?: string
}

/**
 * Insert a new evidence record.
 *
 * evidence is append-only — UPDATE and DELETE are blocked by SQLite triggers
 * (defense-in-depth). This function only exposes INSERT at the repository layer.
 */
export function insertEvidence(db: Db, e: NewEvidence): Evidence {
  db.prepare(`
    INSERT INTO evidence
      (id, task_id, submitted_by_token_id,
       build_exit, test_exit, lint_exit, ac_exit, coverage_pct,
       manifest_json, logs_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    e.id,
    e.task_id,
    e.submitted_by_token_id,
    e.build_exit,
    e.test_exit,
    e.lint_exit ?? null,
    e.ac_exit,
    e.coverage_pct ?? null,
    e.manifest_json ?? '{}',
    e.logs_json ?? '{}',
  )

  return getEvidenceById(db, e.id)!
}

export function getEvidenceById(db: Db, id: string): Evidence | undefined {
  return db
    .prepare(`SELECT * FROM evidence WHERE id = ?`)
    .get(id) as Evidence | undefined
}

/** Returns the most recent evidence row for a task (gate uses latest). */
export function getLatestEvidenceByTask(db: Db, taskId: string): Evidence | undefined {
  return db
    .prepare(
      `SELECT * FROM evidence WHERE task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(taskId) as Evidence | undefined
}

export function listEvidenceByTask(db: Db, taskId: string): Evidence[] {
  return db
    .prepare(`SELECT * FROM evidence WHERE task_id = ? ORDER BY created_at ASC`)
    .all(taskId) as Evidence[]
}

// No update or delete functions — evidence is append-only by design.
