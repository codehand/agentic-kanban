/**
 * auth/scope.ts — project-scope enforcement chokepoint (TASK-042).
 *
 * resolveBearer returns `project_scope` (token.project_id). A scoped token may
 * only touch resources of that single project. Every JSON-API and MCP handler
 * that turns a caller-supplied project reference into a project row goes
 * through `resolveProjectInScope`, so enforcement lives in ONE shared place:
 *
 *   - unscoped token (project_scope === null): behavior unchanged.
 *   - scoped token: the project is returned only when it IS the scoped
 *     project; anything else — out-of-scope OR nonexistent — throws
 *     ScopeError, so responses never reveal whether out-of-scope projects
 *     exist (no name/existence leak).
 *
 * ScopeError maps to HTTP 403 in the JSON API router and surfaces as a clean
 * `isError` tool result on MCP (never a 500/crash).
 *
 * Policy (locked in TASK-042): token CRUD (/api/tokens) is a GLOBAL,
 * role-gated resource — project scope deliberately does NOT apply there.
 * List endpoints (GET /api/projects, GET /api/tasks) FILTER by scope instead
 * of returning 403.
 */
import type { Db } from '../db/connection.js'
import { getProjectBySlug, getProjectById, type Project } from '../db/repositories/project.js'
import type { ResolvedToken } from './resolve.js'

/** Generic by design: must not leak names/existence of out-of-scope resources. */
const SCOPE_FORBIDDEN = 'Forbidden: token project scope does not allow this operation'

export class ScopeError extends Error {
  constructor(message: string = SCOPE_FORBIDDEN) {
    super(message)
    this.name = 'ScopeError'
  }
}

/** True when the token may touch resources of the given project. */
export function isProjectInScope(auth: ResolvedToken, projectId: string): boolean {
  return auth.project_scope === null || auth.project_scope === projectId
}

/** Resolve a project reference (slug or id). Null when not found. */
export function resolveProjectRef(db: Db, ref: string): Project | null {
  return getProjectBySlug(db, ref) ?? getProjectById(db, ref) ?? null
}

/**
 * Chokepoint: resolve a project reference AND enforce the token's scope.
 * Returns the project (or null = not found, caller's 404) for unscoped
 * tokens; throws ScopeError for scoped tokens unless the reference resolves
 * to exactly the scoped project.
 */
export function resolveProjectInScope(db: Db, auth: ResolvedToken, ref: string): Project | null {
  const proj = resolveProjectRef(db, ref)
  if (auth.project_scope === null) return proj
  if (proj && proj.id === auth.project_scope) return proj
  throw new ScopeError()
}

/** Guard for global operations (e.g. project creation): scoped tokens may not perform them. */
export function assertUnscoped(auth: ResolvedToken): void {
  if (auth.project_scope !== null) throw new ScopeError()
}

/** Filter a project list down to what the token's scope may see. */
export function filterProjectsByScope<T extends { id: string }>(auth: ResolvedToken, projects: T[]): T[] {
  if (auth.project_scope === null) return projects
  return projects.filter((p) => p.id === auth.project_scope)
}
