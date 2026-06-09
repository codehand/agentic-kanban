/**
 * Token mint and revoke.
 * SECURITY:
 *  - The raw secret is generated with high entropy and returned ONCE to the caller.
 *  - Only SHA-256 + salt (secret_hash) is stored in the DB; plaintext secret is never persisted.
 *  - No secret value is ever passed to the logger.
 */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import Database from 'better-sqlite3';
import { insertToken, revokeToken as actualRevokeToken } from '../db/repositories/token.js';

export type Role = 'human' | 'implementer' | 'self-check' | 'judge' | 'runner';

export interface MintResult {
  tokenId: string;
  /** Raw secret returned exactly once. NEVER log this value. */
  secret: string;
}

/**
 * Hashes a secret with SHA-256 and a random salt.
 * Returns `<salt>:<hex-digest>` stored in the secret_hash column.
 */
export function hashSecret(secret: string): string {
  const salt = randomBytes(16).toString('hex');
  const digest = createHash('sha-256').update(salt + secret).digest('hex');
  return `${salt}:${digest}`;
}

/**
 * Constant-time verification of a raw secret against a stored hash `<salt>:<hex-digest>`.
 * Uses timingSafeEqual to prevent timing side-channels.
 */
export function verifySecret(secret: string, storedHash: string): boolean {
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

/**
 * Mints a new token for the given role (and optionally project scope).
 * Returns the raw secret once — store it securely; it cannot be recovered.
 */
export function mintToken(
  db: Database.Database,
  role: Role,
  label: string,
  projectId?: string | null
): MintResult {
  const secret = randomBytes(32).toString('hex');
  const secret_hash = hashSecret(secret);
  const tokenId = `tk_${randomBytes(16).toString('hex')}`;
  const token = insertToken(db, {
    id: tokenId,
    role,
    project_id: projectId ?? undefined,
    label,
    secret_hash,
  });
  // secret is returned once; NOT stored in plaintext anywhere
  return { tokenId: token.id, secret };
}

/**
 * Revokes a token by id. The token will no longer authenticate.
 */
export function revokeTokenById(db: Database.Database, tokenId: string): void {
  actualRevokeToken(db, tokenId);
}
