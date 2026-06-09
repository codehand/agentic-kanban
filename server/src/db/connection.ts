/**
 * SQLite connection via better-sqlite3.
 * Enables WAL mode and foreign keys pragma.
 */
import Database from 'better-sqlite3';
import { config } from '../config/index.js';

let _db: Database.Database | undefined;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(config.dbPath);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = undefined;
  }
}

/** For tests: open an in-memory database */
export function openMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
