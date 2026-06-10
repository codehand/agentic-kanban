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
  priority: string | null
  complexity: string | null
  estimate_hours: number | null
  tags: string  // JSON array string
  link_document: string | null
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
  priority?: string | null
  complexity?: string | null
  estimate_hours?: number | null
  tags?: string[]
  link_document?: string | null
}

export interface TaskAttributesPatch {
  priority?: string | null
  complexity?: string | null
  estimate_hours?: number | null
  tags?: string[]
  link_document?: string | null
}

export function insertTask(db: Db, t: NewTask): Task {
  db.prepare(`
    INSERT INTO task (id, project_id, key, title, body_md, state, allow_no_code_change, priority, complexity, estimate_hours, tags, link_document)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    t.id,
    t.project_id,
    t.key,
    t.title,
    t.body_md ?? '',
    t.state ?? 'TODO',
    t.allow_no_code_change ? 1 : 0,
    t.priority ?? null,
    t.complexity ?? null,
    t.estimate_hours ?? null,
    JSON.stringify(t.tags ?? []),
    t.link_document ?? null,
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

export function updateTaskAttributes(db: Db, id: string, patch: TaskAttributesPatch): Task | undefined {
  const sets: string[] = []
  const params: unknown[] = []

  if ('priority' in patch) {
    sets.push('priority = ?')
    params.push(patch.priority ?? null)
  }
  if ('complexity' in patch) {
    sets.push('complexity = ?')
    params.push(patch.complexity ?? null)
  }
  if ('estimate_hours' in patch) {
    sets.push('estimate_hours = ?')
    params.push(patch.estimate_hours ?? null)
  }
  if ('tags' in patch) {
    sets.push('tags = ?')
    params.push(JSON.stringify(patch.tags ?? []))
  }
  if ('link_document' in patch) {
    sets.push('link_document = ?')
    params.push(patch.link_document ?? null)
  }

  if (sets.length === 0) {
    return getTaskById(db, id)
  }

  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')")
  params.push(id)

  db.prepare(`UPDATE task SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  return getTaskById(db, id)
}
