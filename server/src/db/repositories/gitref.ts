import Database from 'better-sqlite3';

export interface GitrefRow {
  id: number;
  task_id: number;
  repo: string;
  branch: string;
  base_sha: string;
  head_sha: string | null;
  mr_url: string | null;
  mr_state: string | null;
  updated_at: string;
}

export function upsertGitref(db: Database.Database, row: Omit<GitrefRow, 'id' | 'updated_at'>): number {
  const existing = db.prepare(
    'SELECT id FROM gitref WHERE task_id = ? AND repo = ?'
  ).get(row.task_id, row.repo) as { id: number } | undefined;

  if (existing) {
    db.prepare(`
      UPDATE gitref SET branch=@branch, base_sha=@base_sha, head_sha=@head_sha,
        mr_url=@mr_url, mr_state=@mr_state, updated_at=datetime('now')
      WHERE id=@id
    `).run({ ...row, id: existing.id });
    return existing.id;
  }

  const result = db.prepare(`
    INSERT INTO gitref (task_id, repo, branch, base_sha, head_sha, mr_url, mr_state)
    VALUES (@task_id, @repo, @branch, @base_sha, @head_sha, @mr_url, @mr_state)
  `).run(row);
  return result.lastInsertRowid as number;
}
