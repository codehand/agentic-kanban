/**
 * statemachine.ts — ALLOWED transition table (§5 TASK_HUB_DESIGN.md).
 * Pure data: no side effects, no I/O.
 */

export type TaskState =
  | 'TODO'
  | 'IN_PROGRESS'
  | 'IMPLEMENTED'
  | 'SELF_CHECK_PASSED'
  | 'SELF_CHECK_FAILED'
  | 'JUDGE_PASSED'
  | 'JUDGE_REJECTED'
  | 'DONE'

export type ActorRole = 'implementer' | 'self-check' | 'judge' | 'human' | 'runner'

export interface TransitionKey {
  from: TaskState
  to: TaskState
}

export interface AllowedTransition extends TransitionKey {
  role: ActorRole
}

/**
 * ALLOWED: full §5 transition table.
 * Every legitimate state change must appear here; anything else is rejected.
 */
export const ALLOWED: AllowedTransition[] = [
  { from: 'TODO',               to: 'IN_PROGRESS',        role: 'implementer' },
  { from: 'IN_PROGRESS',        to: 'IMPLEMENTED',        role: 'implementer' },
  { from: 'IMPLEMENTED',        to: 'SELF_CHECK_PASSED',  role: 'self-check'  },
  { from: 'IMPLEMENTED',        to: 'SELF_CHECK_FAILED',  role: 'self-check'  },
  { from: 'SELF_CHECK_FAILED',  to: 'IN_PROGRESS',        role: 'implementer' },
  { from: 'SELF_CHECK_PASSED',  to: 'JUDGE_PASSED',       role: 'judge'       },
  { from: 'SELF_CHECK_PASSED',  to: 'JUDGE_REJECTED',     role: 'judge'       },
  { from: 'JUDGE_REJECTED',     to: 'IN_PROGRESS',        role: 'implementer' },
  { from: 'JUDGE_PASSED',       to: 'DONE',               role: 'human'       },
]

/** Lookup: returns the required role for a given from→to pair, or null if not allowed. */
export function allowedRole(from: TaskState, to: TaskState): ActorRole | null {
  const entry = ALLOWED.find(t => t.from === from && t.to === to)
  return entry ? entry.role : null
}

/** Returns true if the transition exists in the ALLOWED table with the given role. */
export function isAllowed(from: TaskState, to: TaskState, role: ActorRole): boolean {
  return ALLOWED.some(t => t.from === from && t.to === to && t.role === role)
}
