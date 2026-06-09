import Database from 'better-sqlite3'
import type { Database as Db } from 'better-sqlite3'

/**
 * Open a better-sqlite3 database and apply recommended pragmas.
 *
 * @param dbPath  Filesystem path (or ':memory:' for in-memory).
 * @returns       Open database instance.
 */
export function openDatabase(dbPath: string): Db {
  const db = new Database(dbPath)

  // WAL for concurrent readers + single writer safety
  db.pragma('journal_mode = WAL')
  // Enforce FK constraints (off by default in SQLite)
  db.pragma('foreign_keys = ON')
  // Reduce crash-window while keeping acceptable performance
  db.pragma('synchronous = NORMAL')

  return db
}

export type { Db }
