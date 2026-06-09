import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Db } from './connection.js'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

/**
 * Idempotent migration runner.
 *
 * Creates a `_migrations` tracking table on first run, then applies any SQL
 * files in the migrations directory that have not been recorded yet.
 * Re-running against the same DB is safe — already-applied migrations are
 * skipped.
 *
 * @param db  Open better-sqlite3 instance.
 */
export function runMigrations(db: Db): void {
  // Tracking table: records which migration files have been applied.
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
  `)

  const applied = new Set<string>(
    (db.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map(
      (r) => r.name,
    ),
  )

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const insertMigration = db.prepare(
    `INSERT INTO _migrations (name) VALUES (?)`,
  )

  for (const file of files) {
    if (applied.has(file)) continue

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8')

    // Run each migration inside a transaction for atomicity.
    const run = db.transaction(() => {
      db.exec(sql)
      insertMigration.run(file)
    })
    run()
  }
}
