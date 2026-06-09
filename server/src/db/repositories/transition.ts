import type { Db } from '../connection.js'

export interface Transition {
  id: string
  task_id: string
  from_state: string
  to_state: string
  actor_role: string
  actor_token_id: string
  note: string | null
  evidence_id: string | null
  at: string
}

export interface NewTransition {
  id: string
  task_id: string
  from_state: string
  to_state: string
  actor_role: string
  actor_token_id: string
  note?: string
  evidence_id?: string
}

/**
 * Insert a new transition record.
 *
 * transition is append-only — UPDATE and DELETE are blocked by SQLite triggers
 * (defense-in-depth: the trigger fires before any UPDATE/DELETE reaches storage).
 * This function only exposes INSERT to enforce that at the repository layer as well.
 */
export function insertTransition(db: Db, t: NewTransition): Transition {
  db.prepare(`
    INSERT INTO transition (id, task_id, from_state, to_state, actor_role, actor_token_id, note, evidence_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    t.id,
    t.task_id,
    t.from_state,
    t.to_state,
    t.actor_role,
    t.actor_token_id,
    t.note ?? null,
    t.evidence_id ?? null,
  )

  return getTransitionById(db, t.id)!
}

export function getTransitionById(db: Db, id: string): Transition | undefined {
  return db
    .prepare(`SELECT * FROM transition WHERE id = ?`)
    .get(id) as Transition | undefined
}

export function listTransitionsByTask(db: Db, taskId: string): Transition[] {
  return db
    .prepare(`SELECT * FROM transition WHERE task_id = ? ORDER BY at ASC`)
    .all(taskId) as Transition[]
}

// No update or delete functions — transition is append-only by design.
