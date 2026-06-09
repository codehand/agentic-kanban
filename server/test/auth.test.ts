/**
 * Auth tests for P2: bootstrap, mint/hash, parse/resolve (401/403), and authorize per role.
 *
 * All tests run against an in-memory SQLite database.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openMemoryDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { bootstrapAdminToken, BOOTSTRAP_LABEL } from '../src/auth/bootstrap.js';
import { mintToken, hashSecret, verifySecret } from '../src/auth/mint.js';
import { resolveBearer } from '../src/auth/resolve.js';
import { authorize, assertAuthorized, AuthorizationError } from '../src/auth/authorize.js';
import { parseBearerHeader } from '../src/auth/parse.js';
import { findActiveTokensByRole } from '../src/db/repositories/token.js';
import type { IncomingMessage } from 'node:http';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(): Database.Database {
  const db = openMemoryDb();
  runMigrations(db);
  return db;
}

/** Minimal fake IncomingMessage with a custom Authorization header */
function fakeReq(authHeader?: string): IncomingMessage {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  } as unknown as IncomingMessage;
}

// ---------------------------------------------------------------------------
// hashSecret / verifySecret
// ---------------------------------------------------------------------------

describe('hashSecret / verifySecret', () => {
  it('stores a SHA-256 + salt value, not plaintext', () => {
    const secret = 'my-raw-secret';
    const hash = hashSecret(secret);
    expect(hash).not.toContain(secret);
    expect(hash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    // contains salt separator
    expect(hash.split(':').length).toBe(2);
  });

  it('verifies correct secret constant-time (timingSafeEqual path)', () => {
    const secret = 'correct-secret';
    const hash = hashSecret(secret);
    expect(verifySecret(secret, hash)).toBe(true);
  });

  it('rejects wrong secret', () => {
    const hash = hashSecret('right-secret');
    expect(verifySecret('wrong-secret', hash)).toBe(false);
  });

  it('rejects malformed hash (no salt separator)', () => {
    expect(verifySecret('any', 'nocolonshere')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mintToken
// ---------------------------------------------------------------------------

describe('mintToken', () => {
  it('returns a secret and stores only secret_hash (no plaintext) in the DB', () => {
    const db = makeDb();
    const { tokenId, secret } = mintToken(db, 'implementer', 'agent-1');
    expect(typeof secret).toBe('string');
    expect(secret.length).toBeGreaterThan(0);

    // Verify DB row has secret_hash, not the plaintext secret
    const row = db.prepare('SELECT * FROM token WHERE id = ?').get(tokenId) as {
      secret_hash: string;
    };
    expect(row.secret_hash).not.toBe(secret);
    expect(row.secret_hash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
  });

  it('minted secret can be resolved via resolveBearer', () => {
    const db = makeDb();
    const { secret } = mintToken(db, 'judge', 'judge-bot');
    const resolved = resolveBearer(db, secret);
    expect(resolved).not.toBeUndefined();
    expect(resolved!.role).toBe('judge');
  });
});

// ---------------------------------------------------------------------------
// bootstrap — idempotency (AC3)
// ---------------------------------------------------------------------------

describe('bootstrapAdminToken — idempotency', () => {
  it('creates exactly one human token on first run', () => {
    const db = makeDb();
    const result = bootstrapAdminToken(db, 'super-secret-admin');
    expect(result.created).toBe(true);
    expect(result.tokenId).toBeDefined();
    expect(result.tokenId).toMatch(/^tk_/); // Token IDs start with 'tk_'

    const humans = findActiveTokensByRole(db, 'human');
    expect(humans).toHaveLength(1);
    expect(humans[0]!.label).toBe(BOOTSTRAP_LABEL);
  });

  it('is idempotent: re-run does not duplicate the human token', () => {
    const db = makeDb();
    bootstrapAdminToken(db, 'admin-token');
    // Run twice — must NOT create a duplicate
    const secondRun = bootstrapAdminToken(db, 'admin-token');
    expect(secondRun.created).toBe(false);

    const humans = findActiveTokensByRole(db, 'human');
    expect(humans).toHaveLength(1); // still just one
  });

  it('does nothing when ADMIN_TOKEN is undefined', () => {
    const db = makeDb();
    const result = bootstrapAdminToken(db, undefined);
    expect(result.created).toBe(false);
    expect(result.tokenId).toBeNull();
    expect(findActiveTokensByRole(db, 'human')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// parseBearerHeader (401 paths — missing / malformed)
// ---------------------------------------------------------------------------

describe('parseBearerHeader', () => {
  it('returns null when Authorization header is missing — triggers 401', () => {
    expect(parseBearerHeader(fakeReq())).toBeNull();
  });

  it('returns null for malformed header (not Bearer) — triggers 401', () => {
    expect(parseBearerHeader(fakeReq('Basic dXNlcjpwYXNz'))).toBeNull();
  });

  it('returns null for empty Bearer token — triggers 401', () => {
    expect(parseBearerHeader(fakeReq('Bearer '))).toBeNull();
  });

  it('extracts the secret from a valid Bearer header', () => {
    expect(parseBearerHeader(fakeReq('Bearer abc123'))).toBe('abc123');
  });
});

// ---------------------------------------------------------------------------
// resolveBearer — 401 for invalid/revoked token
// ---------------------------------------------------------------------------

describe('resolveBearer — 401/403 paths', () => {
  it('returns undefined for unknown secret — 401', () => {
    const db = makeDb();
    expect(resolveBearer(db, 'totally-unknown-secret')).toBeUndefined();
  });

  it('returns undefined for a revoked token — 401', () => {
    const db = makeDb();
    const { tokenId, secret } = mintToken(db, 'implementer', 'to-revoke');
    // Revoke it
    db.prepare(`UPDATE token SET revoked_at = datetime('now') WHERE id = ?`).run(tokenId);
    expect(resolveBearer(db, secret)).toBeUndefined();
  });

  it('returns resolved token for a valid, active secret', () => {
    const db = makeDb();
    const { secret } = mintToken(db, 'runner', 'runner-bot');
    const resolved = resolveBearer(db, secret);
    expect(resolved).not.toBeUndefined();
    expect(resolved!.role).toBe('runner');
  });
});

// ---------------------------------------------------------------------------
// authorize — role → permission table (AC5)
// ---------------------------------------------------------------------------

describe('authorize — role permission enforcement', () => {
  // runner: only evidence.submit and read
  it('runner CAN submit evidence', () => {
    expect(authorize('runner', 'evidence.submit')).toBe(true);
  });

  it('runner CANNOT transition (todo_to_in_progress)', () => {
    expect(authorize('runner', 'task.transition.todo_to_in_progress')).toBe(false);
  });

  it('runner CANNOT perform judge transition', () => {
    expect(authorize('runner', 'task.transition.judge')).toBe(false);
  });

  it('runner CANNOT approve (DONE)', () => {
    expect(authorize('runner', 'task.transition.approve')).toBe(false);
  });

  // implementer: cannot approve or JUDGE_*
  it('implementer CAN do TODO→IN_PROGRESS', () => {
    expect(authorize('implementer', 'task.transition.todo_to_in_progress')).toBe(true);
  });

  it('implementer CAN do IN_PROGRESS→IMPLEMENTED', () => {
    expect(authorize('implementer', 'task.transition.in_progress_to_implemented')).toBe(true);
  });

  it('implementer CANNOT approve (JUDGE_PASSED→DONE)', () => {
    expect(authorize('implementer', 'task.transition.approve')).toBe(false);
  });

  it('implementer CANNOT perform JUDGE transition', () => {
    expect(authorize('implementer', 'task.transition.judge')).toBe(false);
  });

  it('implementer CANNOT mint tokens', () => {
    expect(authorize('implementer', 'token.mint')).toBe(false);
  });

  // judge
  it('judge CAN perform JUDGE_* transitions', () => {
    expect(authorize('judge', 'task.transition.judge')).toBe(true);
  });

  it('judge CANNOT submit evidence', () => {
    expect(authorize('judge', 'evidence.submit')).toBe(false);
  });

  it('judge CANNOT approve (DONE)', () => {
    expect(authorize('judge', 'task.transition.approve')).toBe(false);
  });

  // human
  it('human CAN approve', () => {
    expect(authorize('human', 'task.transition.approve')).toBe(true);
  });

  it('human CAN mint tokens', () => {
    expect(authorize('human', 'token.mint')).toBe(true);
  });

  // self-check
  it('self-check CAN trigger IMPLEMENTED→SELF_CHECK_*', () => {
    expect(authorize('self-check', 'task.transition.self_check')).toBe(true);
  });

  it('self-check CANNOT approve', () => {
    expect(authorize('self-check', 'task.transition.approve')).toBe(false);
  });

  // assertAuthorized throws AuthorizationError on deny
  it('assertAuthorized throws AuthorizationError when denied', () => {
    expect(() => assertAuthorized('runner', 'task.transition.judge')).toThrow(AuthorizationError);
  });

  it('assertAuthorized does not throw when permitted', () => {
    expect(() => assertAuthorized('runner', 'evidence.submit')).not.toThrow();
  });
});
