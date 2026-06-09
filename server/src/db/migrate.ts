/**
 * Idempotent migration runner.
 * Reads numbered SQL files from migrations/ and executes them in order.
 * Uses a migrations_applied table to track which have run.
 */
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

export function runMigrations(db: Database.Database): void {
  // Create tracking table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations_applied (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    (db.prepare('SELECT name FROM migrations_applied').all() as Array<{name: string}>)
      .map(r => r.name)
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    db.exec(sql);
    db.prepare('INSERT INTO migrations_applied (name) VALUES (?)').run(file);
  }
}
