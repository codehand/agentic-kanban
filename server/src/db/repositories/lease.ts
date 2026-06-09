import type { Db } from '../connection.js'
import type { LeaseRepository, Task as DomainTask, TryClaimResult } from '../../domain/lease.js'
import { getTaskById as getTaskByIdDb, updateTaskLease, type Task as DbTask } from './task.js'

/**
 * Map a DB task row to the domain Task type (only the fields lease module needs).
 */
function toDomainTask(dbTask: DbTask): DomainTask {
  return {
    id: dbTask.id,
    assignee_token_id: dbTask.assignee_token_id,
    lease_until: dbTask.lease_until,
  }
}

/**
 * Create a concrete SQLite-backed LeaseRepository.
 *
 * The try_claim() method performs an ATOMIC conditional UPDATE to prevent
 * TOCTOU races. The SQL condition ensures only one concurrent caller wins:
 *   WHERE id=? AND (assignee_token_id IS NULL OR lease_until < ? OR assignee_token_id = ?)
 */
export function createLeaseRepository(db: Db): LeaseRepository {
  // Prepared statement for atomic claim — single UPDATE, no separate read
  const atomicClaimStmt = db.prepare(`
    UPDATE task
    SET assignee_token_id = ?,
        lease_until = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE id = ?
      AND (assignee_token_id IS NULL OR lease_until < ? OR assignee_token_id = ?)
  `)

  return {
    getTaskById(id: string): DomainTask | undefined {
      const dbTask = getTaskByIdDb(db, id)
      return dbTask ? toDomainTask(dbTask) : undefined
    },

    updateLease(id: string, assigneeTokenId: string | null, leaseUntil: string | null): DomainTask | undefined {
      const dbTask = updateTaskLease(db, id, assigneeTokenId, leaseUntil)
      return dbTask ? toDomainTask(dbTask) : undefined
    },

    try_claim(id: string, token: string, leaseUntil: string): TryClaimResult {
      // Atomic conditional UPDATE: only succeeds if task is unclaimed,
      // lease expired, or already claimed by the same token.
      // This is a single SQL statement — no TOCTOU race possible.
      const result = atomicClaimStmt.run(token, leaseUntil, id, leaseUntil, token)

      // Read the task after the attempt to return its current state
      const dbTask = getTaskByIdDb(db, id)
      if (!dbTask) {
        return { claimed: false, task: undefined }
      }

      // If changes > 0, the UPDATE matched and the claim succeeded
      return {
        claimed: result.changes > 0,
        task: toDomainTask(dbTask),
      }
    },
  }
}
