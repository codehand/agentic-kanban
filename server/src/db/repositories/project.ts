import Database from 'better-sqlite3';

export interface ProjectRow {
  id: number;
  slug: string;
  name: string;
  created_at: string;
}

export function insertProject(db: Database.Database, row: Omit<ProjectRow, 'id' | 'created_at'>): number {
  const result = db.prepare(`INSERT INTO project (slug, name) VALUES (@slug, @name)`).run(row);
  return result.lastInsertRowid as number;
}

export function findProjectBySlug(db: Database.Database, slug: string): ProjectRow | undefined {
  return db.prepare('SELECT * FROM project WHERE slug = ?').get(slug) as ProjectRow | undefined;
}

export function listProjects(db: Database.Database): ProjectRow[] {
  return db.prepare('SELECT * FROM project ORDER BY created_at').all() as ProjectRow[];
}
