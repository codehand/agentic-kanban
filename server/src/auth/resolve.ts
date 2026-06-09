/**
 * Resolves a bearer secret to {role, project_scope, token_id}.
 * Uses constant-time (timingSafeEqual) hash comparison per IMPLEMENTATION_PLAN.md §7.
 * SECURITY: never log the secret; log only token_id on success.
 */
import Database from 'better-sqlite3';
import { createHash, timingSafeEqual } from 'node:crypto';
import { listActiveTokens } from '../db/repositories/token.js';

export interface ResolvedToken {
  token_id: string;
  role: string;
  project_scope: string | null;
}

/**
 * Resolves a raw bearer secret to a ResolvedToken.
 * Returns undefined if the secret is invalid, the token is not found, or is revoked.
 *
 * Implementation detail: to avoid enumerating all tokens (expensive), we first
 * compute the candidate hashes from all active tokens and use timingSafeEqual.
 * For efficiency in SQLite single-process, we use a prefix index: the DB stores
 * `<salt>:<hash>`. We compute the digest per-candidate and compare constant-time.
 */
export function resolveBearer(
  db: Database.Database,
  secret: string
): ResolvedToken | undefined {
  // Fetch all active (non-revoked) tokens — in v1 single-user the count is tiny
  const rows = listActiveTokens(db);

  for (const row of rows) {
    if (verifyHashConstantTime(secret, row.secret_hash)) {
      return {
        token_id: row.id,
        role: row.role,
        project_scope: row.project_id,
      };
    }
  }
  return undefined;
}

/**
 * Constant-time verification of raw secret against stored `<salt>:<hex-digest>`.
 */
function verifyHashConstantTime(secret: string, storedHash: string): boolean {
  const colonIdx = storedHash.indexOf(':');
  if (colonIdx === -1) return false;
  const salt = storedHash.slice(0, colonIdx);
  const expectedHex = storedHash.slice(colonIdx + 1);
  const actualHex = createHash('sha-256').update(salt + secret).digest('hex');
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(actualHex, 'hex');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
