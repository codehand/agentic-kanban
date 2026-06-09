/**
 * Bearer token parse middleware for node:http.
 * Extracts the raw secret from the Authorization header and resolves it to
 * {role, project_scope, token_id}. Returns 401 if missing/malformed/invalid.
 * SECURITY: never log the bearer secret value.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import Database from 'better-sqlite3';
import { resolveBearer, ResolvedToken } from './resolve.js';

export type AuthenticatedRequest = IncomingMessage & { auth: ResolvedToken };

/**
 * Parses Authorization: Bearer <secret> from the request.
 * Returns the raw secret string, or null if missing/malformed.
 */
export function parseBearerHeader(req: IncomingMessage): string | null {
  const header = req.headers['authorization'];
  if (!header) return null;
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return null;
  const secret = header.slice(prefix.length).trim();
  return secret.length > 0 ? secret : null;
}

/**
 * Middleware factory: resolves bearer token from request.
 * Calls next(resolvedToken) on success, or sends 401 JSON and stops on failure.
 * SECURITY: the secret is never passed to logger or included in error responses.
 */
export function requireAuth(
  db: Database.Database,
  req: IncomingMessage,
  res: ServerResponse,
  next: (auth: ResolvedToken) => void
): void {
  const secret = parseBearerHeader(req);
  if (!secret) {
    sendJson(res, 401, { error: 'Missing or malformed Authorization header' });
    return;
  }
  const resolved = resolveBearer(db, secret);
  if (!resolved) {
    sendJson(res, 401, { error: 'Invalid or revoked token' });
    return;
  }
  next(resolved);
}

function sendJson(res: ServerResponse, status: number, body: object): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(data);
}
