import Database from 'better-sqlite3';

export interface TransitionRow {
  id: number;
  task_id: number;
  from_state: string | null;
  to_state: string;
  actor_role: string;
  actor_token_id: number | null;
  note: string | null;
  evidence_id: number | null;
  at: string;
}

export function insertTransition(db: Database.Database, row: Omit<TransitionRow, 'id' | 'at'>): number {
  const result = db.prepare(`
    INSERT INTO transition (task_id, from_state, to_state, actor_role, actor_token_id, note, evidence_id)
    VALUES (@task_id, @from_state, @to_state, @actor_role, @actor_token_id, @note, @evidence_id)
  `).run(row);
  return result.lastInsertRowid as number;
}
