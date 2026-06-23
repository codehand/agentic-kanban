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
  | 'READY_TO_REVIEW'
  | 'DONE'

export type ActorRole = 'implementer' | 'self-check' | 'judge' | 'human' | 'runner' | 'pr-bot'

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
  // TASK-051: optional PR-bot step between judge-pass and human-approve. The
  // pr-bot opens a PR + records its link, then moves the task to READY_TO_REVIEW;
  // the human approves from there. The direct JUDGE_PASSED→DONE edge above stays
  // so the human is never blocked when the pr-bot is offline.
  { from: 'JUDGE_PASSED',       to: 'READY_TO_REVIEW',    role: 'pr-bot'      },
  { from: 'READY_TO_REVIEW',    to: 'DONE',               role: 'human'       },
  // §3 role table (TASK_HUB_DESIGN.md): human may also reset a failed/rejected
  // task back to IN_PROGRESS (UI "Reset" / POST /api/tasks/:key/reset).
  // Same edges as the implementer rework rows above — only the actor differs.
  { from: 'SELF_CHECK_FAILED',  to: 'IN_PROGRESS',        role: 'human'       },
  { from: 'JUDGE_REJECTED',     to: 'IN_PROGRESS',        role: 'human'       },
  // TASK-063: at the human-review gate the reviewer may REJECT instead of
  // approve, sending the task back to JUDGE_REJECTED (implementer then resets
  // it to IN_PROGRESS via the rows above). Unlike the judge's reject edge,
  // these carry no judge verdict comment — guardVerdict is scoped accordingly.
  { from: 'JUDGE_PASSED',       to: 'JUDGE_REJECTED',     role: 'human'       },
  { from: 'READY_TO_REVIEW',    to: 'JUDGE_REJECTED',     role: 'human'       },
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
