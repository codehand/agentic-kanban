import type { Db } from '../connection.js'

export interface Task {
  id: string
  project_id: string
  key: string
  title: string
  body_md: string
  state: string
  allow_no_code_change: number  // SQLite INTEGER boolean (0/1)
  assignee_token_id: string | null
  lease_until: string | null
  created_at: string
  updated_at: string
}

export interface NewTask {
  id: string
  project_id: string
  key: string
  title: string
  body_md?: string
  state?: string
  allow_no_code_change?: boolean
}

export function insertTask(db: Db, t: NewTask): Task {
  db.prepare(`
    INSERT INTO task (id, project_id, key, title, body_md, state, allow_no_code_change)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    t.id,
    t.project_id,
    t.key,
    t.title,
    t.body_md ?? '',
    t.state ?? 'TODO',
    t.allow_no_code_change ? 1 : 0,
  )

  return getTaskById(db, t.id)!
}

export function getTaskById(db: Db, id: string): Task | undefined {
  return db
    .prepare(`SELECT * FROM task WHERE id = ?`)
    .get(id) as Task | undefined
}

export function getTaskByKey(db: Db, projectId: string, key: string): Task | undefined {
  return db
    .prepare(`SELECT * FROM task WHERE project_id = ? AND key = ?`)
    .get(projectId, key) as Task | undefined
}

export function listTasksByProject(db: Db, projectId: string, state?: string): Task[] {
  if (state !== undefined) {
    return db
      .prepare(`SELECT * FROM task WHERE project_id = ? AND state = ? ORDER BY created_at ASC`)
      .all(projectId, state) as Task[]
  }
  return db
    .prepare(`SELECT * FROM task WHERE project_id = ? ORDER BY created_at ASC`)
    .all(projectId) as Task[]
}

export function updateTaskState(db: Db, id: string, state: string): Task | undefined {
  db.prepare(`
    UPDATE task SET state = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?
  `).run(state, id)
  return getTaskById(db, id)
}

export function updateTaskLease(
  db: Db,
  id: string,
  assigneeTokenId: string | null,
  leaseUntil: string | null,
): Task | undefined {
  db.prepare(`
    UPDATE task
    SET assignee_token_id = ?,
        lease_until = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE id = ?
  `).run(assigneeTokenId, leaseUntil, id)
  return getTaskById(db, id)
}
