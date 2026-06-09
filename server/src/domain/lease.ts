/**
 * lease.ts — claim/lease/heartbeat/release semantics for concurrent task access.
 * §11 TASK_HUB_DESIGN.md.
 *
 * All I/O is injected (repository interfaces) so the domain logic is pure-testable.
 *
 * IMPORTANT: For production use, the LeaseRepository implementation MUST use
 * SQLite transactions (BEGIN IMMEDIATE or BEGIN EXCLUSIVE) to ensure atomic
 * check-and-set semantics. The domain logic here performs check-then-write,
 * which is only safe if the repository wraps it in a transaction.
 *
 * Example transaction usage in repository:
 *   db.transaction(() => {
 *     const task = getTaskById(id);
 *     if (task.lease_until && new Date(task.lease_until) > new Date()) {
 *       throw new Error('Already leased');
 *     }
 *     updateLease(id, token, leaseUntil);
 *   })();
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Task {
  id: string
  assignee_token_id: string | null
  lease_until: string | null
}

export interface LeaseConfig {
  ttlSeconds: number
}

export interface ClaimResult {
  ok: boolean
  error?: string
  task?: Task
}

export interface HeartbeatResult {
  ok: boolean
  error?: string
  task?: Task
}

export interface ReleaseResult {
  ok: boolean
  error?: string
  task?: Task
}

// ---------------------------------------------------------------------------
// Repository interface (injected; lease module never calls DB directly)
// ---------------------------------------------------------------------------

export interface LeaseRepository {
  getTaskById(id: string): Task | undefined
  updateLease(id: string, assigneeTokenId: string | null, leaseUntil: string | null): Task | undefined
}

// ---------------------------------------------------------------------------
// claim()
// ---------------------------------------------------------------------------

/**
 * Claim a task: set assignee_token_id + lease_until.
 * Only succeeds if task has no lease or lease has expired.
 * Uses transaction semantics via repository (atomic check-and-set).
 */
export function claim(
  taskId: string,
  token: string,
  repo: LeaseRepository,
  config: LeaseConfig,
  now: () => string = () => new Date().toISOString(),
): ClaimResult {
  const task = repo.getTaskById(taskId)
  if (!task) {
    return { ok: false, error: `Task '${taskId}' not found` }
  }

  // Check if task is already leased to another token and lease hasn't expired
  if (task.assignee_token_id !== null && task.lease_until !== null) {
    const leaseUntil = new Date(task.lease_until)
    const currentTime = new Date(now())

    if (currentTime < leaseUntil) {
      // Lease is still active and owned by someone else
      if (task.assignee_token_id !== token) {
        return {
          ok: false,
          error: `Task '${taskId}' is already leased to token '${task.assignee_token_id}' until ${task.lease_until}`,
        }
      }
      // Already leased to this token — just extend
    }
  }

  // Set lease: current time + TTL
  const currentTime = new Date(now())
  const leaseUntil = new Date(currentTime.getTime() + config.ttlSeconds * 1000)
  const leaseUntilISO = leaseUntil.toISOString()

  const updated = repo.updateLease(taskId, token, leaseUntilISO)
  if (!updated) {
    return { ok: false, error: `Failed to update lease for task '${taskId}'` }
  }

  return { ok: true, task: updated }
}

// ---------------------------------------------------------------------------
// heartbeat()
// ---------------------------------------------------------------------------

/**
 * Heartbeat: extend lease_until for the current assignee.
 * Only succeeds if caller is the current assignee.
 */
export function heartbeat(
  taskId: string,
  token: string,
  repo: LeaseRepository,
  config: LeaseConfig,
  now: () => string = () => new Date().toISOString(),
): HeartbeatResult {
  const task = repo.getTaskById(taskId)
  if (!task) {
    return { ok: false, error: `Task '${taskId}' not found` }
  }

  // Must be current assignee
  if (task.assignee_token_id !== token) {
    return {
      ok: false,
      error: `Token '${token}' is not the current assignee of task '${taskId}'`,
    }
  }

  // Check if lease has expired
  if (task.lease_until !== null) {
    const leaseUntil = new Date(task.lease_until)
    const currentTime = new Date(now())

    if (currentTime >= leaseUntil) {
      return {
        ok: false,
        error: `Lease for task '${taskId}' has expired at ${task.lease_until}`,
      }
    }
  }

  // Extend lease: current time + TTL
  const currentTime = new Date(now())
  const leaseUntil = new Date(currentTime.getTime() + config.ttlSeconds * 1000)
  const leaseUntilISO = leaseUntil.toISOString()

  const updated = repo.updateLease(taskId, token, leaseUntilISO)
  if (!updated) {
    return { ok: false, error: `Failed to update lease for task '${taskId}'` }
  }

  return { ok: true, task: updated }
}

// ---------------------------------------------------------------------------
// release()
// ---------------------------------------------------------------------------

/**
 * Release a lease early. Clears assignee_token_id and lease_until.
 */
export function release(
  taskId: string,
  token: string,
  repo: LeaseRepository,
): ReleaseResult {
  const task = repo.getTaskById(taskId)
  if (!task) {
    return { ok: false, error: `Task '${taskId}' not found` }
  }

  // Must be current assignee (if leased)
  if (task.assignee_token_id !== null && task.assignee_token_id !== token) {
    return {
      ok: false,
      error: `Token '${token}' is not the current assignee of task '${taskId}'`,
    }
  }

  // Clear lease
  const updated = repo.updateLease(taskId, null, null)
  if (!updated) {
    return { ok: false, error: `Failed to release lease for task '${taskId}'` }
  }

  return { ok: true, task: updated }
}

// ---------------------------------------------------------------------------
// checkLease() — helper for gate guard
// ---------------------------------------------------------------------------

/**
 * Check if a token currently holds the lease on a task.
 * Returns true if token is the assignee and lease hasn't expired.
 */
export function checkLease(
  taskId: string,
  token: string,
  repo: LeaseRepository,
  now: () => string = () => new Date().toISOString(),
): { hasLease: boolean; error?: string } {
  const task = repo.getTaskById(taskId)
  if (!task) {
    return { hasLease: false, error: `Task '${taskId}' not found` }
  }

  // No lease at all
  if (task.assignee_token_id === null || task.lease_until === null) {
    return { hasLease: false }
  }

  // Check expiry
  const leaseUntil = new Date(task.lease_until)
  const currentTime = new Date(now())

  if (currentTime >= leaseUntil) {
    return { hasLease: false }
  }

  // Check token match
  if (task.assignee_token_id !== token) {
    return {
      hasLease: false,
      error: `Token '${token}' does not hold the lease on task '${taskId}' (leased to '${task.assignee_token_id}')`,
    }
  }

  return { hasLease: true }
}
