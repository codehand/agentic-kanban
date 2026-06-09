import Database from 'better-sqlite3';

export interface EvidenceRow {
  id: number;
  task_id: number;
  submitted_by_token_id: number;
  build_exit: number;
  test_exit: number;
  lint_exit: number | null;
  ac_exit: number | null;
  coverage_pct: number | null;
  manifest_json: string;
  logs_json: string;
  created_at: string;
}

export function insertEvidence(db: Database.Database, row: Omit<EvidenceRow, 'id' | 'created_at'>): number {
  const result = db.prepare(`
    INSERT INTO evidence
      (task_id, submitted_by_token_id, build_exit, test_exit, lint_exit, ac_exit, coverage_pct, manifest_json, logs_json)
    VALUES
      (@task_id, @submitted_by_token_id, @build_exit, @test_exit, @lint_exit, @ac_exit, @coverage_pct, @manifest_json, @logs_json)
  `).run(row);
  return result.lastInsertRowid as number;
}
