/**
 * share.ts — persistence for read-only task share links (TASK-076).
 *
 * A row maps the SHA-256 hex of a share token to one task. The raw token is
 * never stored; callers hash before every insert/lookup.
 */
import type { Db } from '../connection.js'

export interface TaskShare {
  token_hash: string
  task_id: string
  expires_at: string | null
  created_at: string
  created_by: string
}

export interface NewTaskShare {
  token_hash: string
  task_id: string
  expires_at: string | null
  created_by: string
}

export function insertShare(db: Db, s: NewTaskShare): void {
  db.prepare(
    `INSERT INTO task_share (token_hash, task_id, expires_at, created_by) VALUES (?, ?, ?, ?)`,
  ).run(s.token_hash, s.task_id, s.expires_at, s.created_by)
}

export function getShareByHash(db: Db, tokenHash: string): TaskShare | undefined {
  return db.prepare(`SELECT * FROM task_share WHERE token_hash = ?`).get(tokenHash) as TaskShare | undefined
}
