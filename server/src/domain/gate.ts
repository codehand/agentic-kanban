/**
 * gate.ts — the ONLY writer of state + transition records.
 * Enforces: ALLOWED table + role + guards + evidence checksum.
 * §1.1, §5, §8 TASK_HUB_DESIGN.md.
 *
 * All I/O is injected (repository interfaces) so the domain logic is pure-testable.
 */

import { isAllowed, allowedRole } from './statemachine.js'
import type { TaskState, ActorRole } from './statemachine.js'
import { guardImplemented, guardVerdict, guardChecksum } from './guards.js'
import type { GitRef, Comment, Evidence } from './guards.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransitionRecord {
  task_id: string
  from_state: TaskState
  to_state: TaskState
  actor_role: ActorRole
  actor_token_id: string
  at: string           // ISO timestamp
  note?: string
  evidence_id?: string
}

export interface ProposeInput {
  task_id: string
  current_state: TaskState
  from: TaskState
  to: TaskState
  actor_role: ActorRole
  actor_token_id: string
  note?: string
  evidence_id?: string
  // Context for guards
  gitrefs?: GitRef[]
  allow_no_code_change?: boolean
  comments?: Comment[]
  evidence?: Evidence | null
  computeChecksum?: (data: string) => string
}

export interface ProposeResult {
  ok: boolean
  error?: string
  transition?: TransitionRecord
}

// ---------------------------------------------------------------------------
// Repository interface (injected; gate never calls DB directly)
// ---------------------------------------------------------------------------

export interface TransitionRepository {
  append(record: TransitionRecord): void
  setTaskState(task_id: string, state: TaskState): void
}

// ---------------------------------------------------------------------------
// propose()
// ---------------------------------------------------------------------------

export function propose(
  input: ProposeInput,
  repo: TransitionRepository,
  now: () => string = () => new Date().toISOString(),
): ProposeResult {
  const { task_id, current_state, from, to, actor_role, actor_token_id } = input

  // 1. Validate: actual current state must match the declared `from`
  if (current_state !== from) {
    return {
      ok: false,
      error: `State mismatch: task is in '${current_state}', proposal declares from='${from}'`,
    }
  }

  // 2. Check transition is in the ALLOWED table (rejects skips / nhảy cóc)
  const required_role = allowedRole(from, to)
  if (required_role === null) {
    return {
      ok: false,
      error: `Transition '${from}'->'${to}' is not in the ALLOWED table`,
    }
  }

  // 3. Role check
  if (!isAllowed(from, to, actor_role)) {
    return {
      ok: false,
      error: `Role '${actor_role}' is not allowed for '${from}'->'${to}' (required: '${required_role}')`,
    }
  }

  // 4. Guards per target state

  // Guard →IMPLEMENTED
  if (to === 'IMPLEMENTED') {
    const err = guardImplemented(
      input.gitrefs ?? [],
      input.allow_no_code_change ?? false,
    )
    if (err) return { ok: false, error: err }
  }

  // Guard →JUDGE_PASSED / →JUDGE_REJECTED
  if (to === 'JUDGE_PASSED' || to === 'JUDGE_REJECTED') {
    const err = guardVerdict(to, input.comments ?? [])
    if (err) return { ok: false, error: err }
  }

  // Guard checksum: required for →JUDGE_PASSED and →SELF_CHECK_PASSED/FAILED
  if (to === 'JUDGE_PASSED' || to === 'SELF_CHECK_PASSED' || to === 'SELF_CHECK_FAILED') {
    if (input.computeChecksum) {
      const err = guardChecksum(input.evidence ?? null, input.computeChecksum)
      if (err) return { ok: false, error: err }
    }
  }

  // 5. Write transition (append-only) + update task state
  const transition: TransitionRecord = {
    task_id,
    from_state: from,
    to_state: to,
    actor_role,
    actor_token_id,
    at: now(),
    ...(input.note !== undefined ? { note: input.note } : {}),
    ...(input.evidence_id !== undefined ? { evidence_id: input.evidence_id } : {}),
  }

  repo.append(transition)
  repo.setTaskState(task_id, to)

  return { ok: true, transition }
}
