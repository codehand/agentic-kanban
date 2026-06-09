import Database from 'better-sqlite3';

export interface TaskRow {
  id: number;
  project_id: number;
  key: string;
  title: string;
  body_md: string;
  state: string;
  allow_no_code_change: number;
  assignee_token_id: number | null;
  lease_until: string | null;
  created_at: string;
  updated_at: string;
}

export function insertTask(db: Database.Database, row: Omit<TaskRow, 'id' | 'created_at' | 'updated_at'>): number {
  const result = db.prepare(`
    INSERT INTO task (project_id, key, title, body_md, state, allow_no_code_change, assignee_token_id, lease_until)
    VALUES (@project_id, @key, @title, @body_md, @state, @allow_no_code_change, @assignee_token_id, @lease_until)
  `).run(row);
  return result.lastInsertRowid as number;
}

export function findTaskByKey(db: Database.Database, projectId: number, key: string): TaskRow | undefined {
  return db.prepare('SELECT * FROM task WHERE project_id = ? AND key = ?').get(projectId, key) as TaskRow | undefined;
}
