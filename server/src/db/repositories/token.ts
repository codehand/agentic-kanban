/**
 * Token repository.
 * SECURITY: only secret_hash is stored; plaintext secret is never persisted.
 */
import Database from 'better-sqlite3';

export interface TokenRow {
  id: number;
  role: string;
  project_id: number | null;
  label: string;
  secret_hash: string;
  created_at: string;
  revoked_at: string | null;
}

export function insertToken(
  db: Database.Database,
  row: Omit<TokenRow, 'id' | 'created_at'>
): number {
  const result = db.prepare(`
    INSERT INTO token (role, project_id, label, secret_hash, revoked_at)
    VALUES (@role, @project_id, @label, @secret_hash, @revoked_at)
  `).run(row);
  return result.lastInsertRowid as number;
}

export function findTokenByHash(
  db: Database.Database,
  secretHash: string
): TokenRow | undefined {
  return db.prepare(`
    SELECT * FROM token WHERE secret_hash = ? AND revoked_at IS NULL
  `).get(secretHash) as TokenRow | undefined;
}

export function findTokenById(
  db: Database.Database,
  id: number
): TokenRow | undefined {
  return db.prepare('SELECT * FROM token WHERE id = ?').get(id) as TokenRow | undefined;
}

export function findActiveTokensByRole(
  db: Database.Database,
  role: string
): TokenRow[] {
  return db.prepare(`
    SELECT * FROM token WHERE role = ? AND revoked_at IS NULL
  `).all(role) as TokenRow[];
}

export function revokeToken(db: Database.Database, id: number): void {
  db.prepare(`
    UPDATE token SET revoked_at = datetime('now') WHERE id = ?
  `).run(id);
}
