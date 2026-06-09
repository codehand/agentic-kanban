import type { Db } from '../connection.js'

export type TokenRole = 'human' | 'implementer' | 'self-check' | 'judge' | 'runner'

export interface Token {
  id: string
  role: TokenRole
  project_id: string | null
  label: string
  secret_hash: string
  created_at: string
  revoked_at: string | null
}

export interface NewToken {
  id: string
  role: TokenRole
  project_id?: string
  label?: string
  secret_hash: string
}

export function insertToken(db: Db, t: NewToken): Token {
  db.prepare(`
    INSERT INTO token (id, role, project_id, label, secret_hash)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    t.id,
    t.role,
    t.project_id ?? null,
    t.label ?? '',
    t.secret_hash,
  )

  return getTokenById(db, t.id)!
}

export function getTokenById(db: Db, id: string): Token | undefined {
  return db
    .prepare(`SELECT * FROM token WHERE id = ?`)
    .get(id) as Token | undefined
}

export function listTokens(db: Db): Token[] {
  return db
    .prepare(`SELECT * FROM token ORDER BY created_at ASC`)
    .all() as Token[]
}

export function listActiveTokens(db: Db): Token[] {
  return db
    .prepare(`SELECT * FROM token WHERE revoked_at IS NULL ORDER BY created_at ASC`)
    .all() as Token[]
}

/** Soft-revoke: set revoked_at timestamp. */
export function revokeToken(db: Db, id: string): Token | undefined {
  db.prepare(`
    UPDATE token SET revoked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ? AND revoked_at IS NULL
  `).run(id)
  return getTokenById(db, id)
}
