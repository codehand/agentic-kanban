/**
 * Bootstrap: reads ADMIN_TOKEN from env and creates exactly one `human` token.
 * Idempotent across restarts — does NOT create a duplicate if a human token
 * with label 'admin' already exists.
 *
 * SECURITY:
 *  - The ADMIN_TOKEN raw value is only used to hash and store; it is NOT logged.
 *  - If ADMIN_TOKEN is not set, bootstrap is skipped (server can still run if a
 *    human token was created previously).
 */
import Database from 'better-sqlite3';
import { logger } from '../logger.js';
import { hashSecret } from './mint.js';
import { findActiveTokensByRole } from '../db/repositories/token.js';
import { insertToken } from '../db/repositories/token.js';

export const BOOTSTRAP_LABEL = 'admin';

export interface BootstrapResult {
  created: boolean;
  tokenId: number | null;
}

/**
 * Ensures exactly one active `human` token with label 'admin' exists.
 * Re-runs are safe (idempotent): if the token already exists, nothing is created.
 *
 * @param db - database connection (already migrated)
 * @param adminToken - raw ADMIN_TOKEN secret (from env); undefined means skip
 * @returns BootstrapResult indicating whether a new token was created
 */
export function bootstrapAdminToken(
  db: Database.Database,
  adminToken: string | undefined
): BootstrapResult {
  if (!adminToken) {
    logger.info({ msg: 'ADMIN_TOKEN not set; skipping bootstrap' });
    return { created: false, tokenId: null };
  }

  // Idempotency: check if a human token labelled 'admin' already exists
  const existing = findActiveTokensByRole(db, 'human').find(
    t => t.label === BOOTSTRAP_LABEL
  );
  if (existing) {
    logger.info({ msg: 'Bootstrap: human admin token already exists', token_id: existing.id });
    return { created: false, tokenId: existing.id };
  }

  // SECURITY: hash the ADMIN_TOKEN; never log its value
  const secret_hash = hashSecret(adminToken);
  const tokenId = insertToken(db, {
    role: 'human',
    project_id: null,
    label: BOOTSTRAP_LABEL,
    secret_hash,
    revoked_at: null,
  });
  logger.info({ msg: 'Bootstrap: created human admin token', token_id: tokenId });
  return { created: true, tokenId };
}
