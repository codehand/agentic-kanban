/**
 * dependencies.ts — task dependency enforcement (TASK-044).
 *
 * Two responsibilities, both used as a single source of truth by API + MCP:
 *   1. validateDependsOn — when (re)writing a task's depends_on set: resolve
 *      keys → task ids in the same project, reject self-dependency, reject
 *      cross-project deps, and reject any edge that would create a cycle.
 *   2. unmetDependencies — at every state-transition chokepoint: list the
 *      dependencies of a task that are not yet DONE (with their current state).
 *
 * The cycle check runs DFS on the dependency graph *as it would be after* the
 * new edges are added, so A→B→A and longer chains are both caught at write time.
 */
import type { Db } from '../db/connection.js'
import { listDependencyIds } from '../db/repositories/dependency.js'
import { getTaskByKey, getTaskById } from '../db/repositories/task.js'

export class DependencyError extends Error {}

export interface UnmetDependency {
  id: string
  key: string
  state: string
}

/**
 * Resolve the `depends_on` input (task keys, e.g. "TASK-001") to task ids in
 * the given project. Throws DependencyError (→ 400 / tool error) on any of:
 *   - unknown key (not in this project)
 *   - self-dependency
 *   - an edge that would create a cycle
 *
 * `selfId` is the dependent task's id (may be undefined when creating a brand
 * new task that has no id yet — a new task can't be in any existing cycle, but
 * we still guard self-reference by key against `selfKey`).
 */
export function validateDependsOn(
  db: Db,
  projectId: string,
  selfKey: string,
  dependsOnKeys: string[],
  selfId?: string,
): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const rawKey of dependsOnKeys) {
    const key = rawKey.trim()
    if (!key) continue
    if (key === selfKey) {
      throw new DependencyError(`Task ${selfKey} cannot depend on itself`)
    }
    const dep = getTaskByKey(db, projectId, key)
    if (!dep) {
      // Could be a task in another project, or simply nonexistent. Either way
      // we only allow same-project dependencies and never reveal other
      // projects' tasks.
      throw new DependencyError(`Dependency not found in project: ${key}`)
    }
    if (selfId && dep.id === selfId) {
      throw new DependencyError(`Task ${selfKey} cannot depend on itself`)
    }
    if (!seen.has(dep.id)) {
      seen.add(dep.id)
      ids.push(dep.id)
    }
  }

  if (selfId) {
    const cyclePath = findCycle(db, selfId, ids)
    if (cyclePath) {
      const keys = cyclePath.map((id) => getTaskById(db, id)?.key ?? id)
      throw new DependencyError(`Dependency cycle detected: ${keys.join(' -> ')}`)
    }
  }
  return ids
}

/**
 * Does adding edges selfId→newDeps create a cycle? Returns the offending path
 * (as task ids, starting and ending with selfId) or null when acyclic.
 *
 * A cycle exists iff selfId is reachable from any of its (proposed) deps by
 * following existing dependency edges. We DFS the existing graph from each new
 * dep looking for selfId.
 */
function findCycle(db: Db, selfId: string, newDeps: string[]): string[] | null {
  for (const start of newDeps) {
    const path = dfs(db, start, selfId, new Set<string>())
    if (path) return [selfId, ...path]
  }
  return null
}

function dfs(db: Db, node: string, target: string, visiting: Set<string>): string[] | null {
  if (node === target) return [node]
  if (visiting.has(node)) return null
  visiting.add(node)
  for (const next of listDependencyIds(db, node)) {
    const sub = dfs(db, next, target, visiting)
    if (sub) return [node, ...sub]
  }
  return null
}

/**
 * Dependencies of `taskId` that are not yet DONE, with their current state.
 * Empty array = task is unblocked. Single source of truth for every transition
 * chokepoint (transition/claim/approve) on both transports.
 */
export function unmetDependencies(db: Db, taskId: string): UnmetDependency[] {
  const out: UnmetDependency[] = []
  for (const depId of listDependencyIds(db, taskId)) {
    const dep = getTaskById(db, depId)
    if (!dep) continue
    if (dep.state !== 'DONE') {
      out.push({ id: dep.id, key: dep.key, state: dep.state })
    }
  }
  return out
}

/** Human-readable "X (STATE), Y (STATE)" listing of unmet deps. */
export function formatUnmet(unmet: UnmetDependency[]): string {
  return unmet.map((d) => `${d.key} (${d.state})`).join(', ')
}
