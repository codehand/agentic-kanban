import Database from 'better-sqlite3';

export interface CommentRow {
  id: number;
  task_id: number;
  author_role: string;
  author_token_id: number | null;
  kind: 'narrative' | 'verdict' | 'review' | 'note';
  verdict: 'PASS' | 'REJECT' | null;
  body_md: string;
  created_at: string;
}

export function insertComment(db: Database.Database, row: Omit<CommentRow, 'id' | 'created_at'>): number {
  const result = db.prepare(`
    INSERT INTO comment (task_id, author_role, author_token_id, kind, verdict, body_md)
    VALUES (@task_id, @author_role, @author_token_id, @kind, @verdict, @body_md)
  `).run(row);
  return result.lastInsertRowid as number;
}
