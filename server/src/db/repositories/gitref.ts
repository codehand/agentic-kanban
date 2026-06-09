import type { Db } from '../connection.js'

export interface GitRef {
  id: string
  task_id: string
  repo: string
  branch: string
  base_sha: string
  head_sha: string
  mr_url: string | null
  mr_state: string | null
  updated_at: string
}

export interface NewGitRef {
  id: string
  task_id: string
  repo: string
  branch: string
  base_sha: string
  head_sha: string
  mr_url?: string
  mr_state?: string
}

export function insertGitRef(db: Db, g: NewGitRef): GitRef {
  db.prepare(`
    INSERT INTO gitref (id, task_id, repo, branch, base_sha, head_sha, mr_url, mr_state)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    g.id,
    g.task_id,
    g.repo,
    g.branch,
    g.base_sha,
    g.head_sha,
    g.mr_url ?? null,
    g.mr_state ?? null,
  )

  return getGitRefById(db, g.id)!
}

export function getGitRefById(db: Db, id: string): GitRef | undefined {
  return db
    .prepare(`SELECT * FROM gitref WHERE id = ?`)
    .get(id) as GitRef | undefined
}

export function getGitRefByTaskAndRepo(
  db: Db,
  taskId: string,
  repo: string,
): GitRef | undefined {
  return db
    .prepare(`SELECT * FROM gitref WHERE task_id = ? AND repo = ?`)
    .get(taskId, repo) as GitRef | undefined
}

export function listGitRefsByTask(db: Db, taskId: string): GitRef[] {
  return db
    .prepare(`SELECT * FROM gitref WHERE task_id = ? ORDER BY updated_at ASC`)
    .all(taskId) as GitRef[]
}

/**
 * Update head_sha and/or mr_url on an existing gitref row.
 * gitref is updatable (unlike evidence/transition).
 */
export function updateGitRef(
  db: Db,
  id: string,
  fields: { head_sha?: string; mr_url?: string; mr_state?: string },
): GitRef | undefined {
  const sets: string[] = [`updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`]
  const values: (string | null)[] = []

  if (fields.head_sha !== undefined) {
    sets.push('head_sha = ?')
    values.push(fields.head_sha)
  }
  if (fields.mr_url !== undefined) {
    sets.push('mr_url = ?')
    values.push(fields.mr_url)
  }
  if (fields.mr_state !== undefined) {
    sets.push('mr_state = ?')
    values.push(fields.mr_state)
  }

  if (sets.length === 1) return getGitRefById(db, id) // nothing to update

  values.push(id)
  db.prepare(`UPDATE gitref SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  return getGitRefById(db, id)
}
