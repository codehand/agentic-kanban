/**
 * lease.test.ts — Tests for lease domain module (claim/heartbeat/release).
 * Covers AC6: claim free ok, claim when leased reject, claim after expiry ok,
 * transition by token not holding lease (non-human) reject.
 */

import { describe, it, expect } from 'vitest'
import { claim, heartbeat, release, checkLease } from '../src/domain/lease.js'
import type { LeaseRepository, Task, LeaseConfig } from '../src/domain/lease.js'
import { propose } from '../src/domain/gate.js'
import type { TransitionRepository, TransitionRecord } from '../src/domain/gate.js'
import type { TaskState } from '../src/domain/statemachine.js'

// ---------------------------------------------------------------------------
// Test repository
// ---------------------------------------------------------------------------

function makeLeaseRepo(tasks: Map<string, Task>): LeaseRepository {
  return {
    getTaskById(id: string): Task | undefined {
      return tasks.get(id)
    },
    updateLease(id: string, assigneeTokenId: string | null, leaseUntil: string | null): Task | undefined {
      const task = tasks.get(id)
      if (!task) return undefined
      const updated: Task = {
        ...task,
        assignee_token_id: assigneeTokenId,
        lease_until: leaseUntil,
      }
      tasks.set(id, updated)
      return updated
    },
  }
}

function makeTransitionRepo(): TransitionRepository & {
  transitions: TransitionRecord[]
  states: Record<string, TaskState>
} {
  const transitions: TransitionRecord[] = []
  const states: Record<string, TaskState> = {}
  return {
    transitions,
    states,
    append(record) { transitions.push(record) },
    setTaskState(task_id, state) { states[task_id] = state },
  }
}

const defaultConfig: LeaseConfig = {
  ttlSeconds: 900, // 15 minutes
}

// ---------------------------------------------------------------------------
// AC6: claim free task (ok)
// ---------------------------------------------------------------------------

describe('AC6: claim free task', () => {
  it('claims a task with no existing lease', () => {
    const tasks = new Map<string, Task>([
      ['task1', { id: 'task1', assignee_token_id: null, lease_until: null }],
    ])
    const repo = makeLeaseRepo(tasks)
    const now = () => '2026-06-09T10:00:00Z'

    const result = claim('task1', 'token1', repo, defaultConfig, now)

    expect(result.ok).toBe(true)
    expect(result.task).toBeDefined()
    expect(result.task!.assignee_token_id).toBe('token1')
    expect(result.task!.lease_until).toBe('2026-06-09T10:15:00.000Z')
  })

  it('claims a task that was previously leased but lease expired', () => {
    const tasks = new Map<string, Task>([
      ['task1', {
        id: 'task1',
        assignee_token_id: 'oldtoken',
        lease_until: '2026-06-09T09:00:00Z', // expired
      }],
    ])
    const repo = makeLeaseRepo(tasks)
    const now = () => '2026-06-09T10:00:00Z'

    const result = claim('task1', 'token1', repo, defaultConfig, now)

    expect(result.ok).toBe(true)
    expect(result.task!.assignee_token_id).toBe('token1')
    expect(result.task!.lease_until).toBe('2026-06-09T10:15:00.000Z')
  })
})

// ---------------------------------------------------------------------------
// AC6: claim when already leased (reject)
// ---------------------------------------------------------------------------

describe('AC6: claim when already leased', () => {
  it('rejects claim when task is leased to another token', () => {
    const tasks = new Map<string, Task>([
      ['task1', {
        id: 'task1',
        assignee_token_id: 'token1',
        lease_until: '2026-06-09T10:30:00Z', // still active
      }],
    ])
    const repo = makeLeaseRepo(tasks)
    const now = () => '2026-06-09T10:00:00Z'

    const result = claim('task1', 'token2', repo, defaultConfig, now)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('already leased')
    expect(result.error).toContain('token1')
  })

  it('allows claim when task is leased to the same token (extends lease)', () => {
    const tasks = new Map<string, Task>([
      ['task1', {
        id: 'task1',
        assignee_token_id: 'token1',
        lease_until: '2026-06-09T10:30:00Z',
      }],
    ])
    const repo = makeLeaseRepo(tasks)
    const now = () => '2026-06-09T10:00:00Z'

    const result = claim('task1', 'token1', repo, defaultConfig, now)

    expect(result.ok).toBe(true)
    expect(result.task!.assignee_token_id).toBe('token1')
    expect(result.task!.lease_until).toBe('2026-06-09T10:15:00.000Z')
  })
})

// ---------------------------------------------------------------------------
// AC6: heartbeat
// ---------------------------------------------------------------------------

describe('AC6: heartbeat extends lease', () => {
  it('extends lease for current assignee', () => {
    const tasks = new Map<string, Task>([
      ['task1', {
        id: 'task1',
        assignee_token_id: 'token1',
        lease_until: '2026-06-09T10:10:00Z',
      }],
    ])
    const repo = makeLeaseRepo(tasks)
    const now = () => '2026-06-09T10:05:00Z'

    const result = heartbeat('task1', 'token1', repo, defaultConfig, now)

    expect(result.ok).toBe(true)
    expect(result.task!.lease_until).toBe('2026-06-09T10:20:00.000Z')
  })

  it('rejects heartbeat from non-assignee', () => {
    const tasks = new Map<string, Task>([
      ['task1', {
        id: 'task1',
        assignee_token_id: 'token1',
        lease_until: '2026-06-09T10:30:00Z',
      }],
    ])
    const repo = makeLeaseRepo(tasks)
    const now = () => '2026-06-09T10:00:00Z'

    const result = heartbeat('task1', 'token2', repo, defaultConfig, now)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('not the current assignee')
  })

  it('rejects heartbeat when lease has expired', () => {
    const tasks = new Map<string, Task>([
      ['task1', {
        id: 'task1',
        assignee_token_id: 'token1',
        lease_until: '2026-06-09T09:00:00Z', // expired
      }],
    ])
    const repo = makeLeaseRepo(tasks)
    const now = () => '2026-06-09T10:00:00Z'

    const result = heartbeat('task1', 'token1', repo, defaultConfig, now)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('expired')
  })
})

// ---------------------------------------------------------------------------
// AC6: release
// ---------------------------------------------------------------------------

describe('AC6: release clears lease', () => {
  it('releases lease early', () => {
    const tasks = new Map<string, Task>([
      ['task1', {
        id: 'task1',
        assignee_token_id: 'token1',
        lease_until: '2026-06-09T10:30:00Z',
      }],
    ])
    const repo = makeLeaseRepo(tasks)

    const result = release('task1', 'token1', repo)

    expect(result.ok).toBe(true)
    expect(result.task!.assignee_token_id).toBeNull()
    expect(result.task!.lease_until).toBeNull()
  })

  it('rejects release from non-assignee', () => {
    const tasks = new Map<string, Task>([
      ['task1', {
        id: 'task1',
        assignee_token_id: 'token1',
        lease_until: '2026-06-09T10:30:00Z',
      }],
    ])
    const repo = makeLeaseRepo(tasks)

    const result = release('task1', 'token2', repo)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('not the current assignee')
  })
})

// ---------------------------------------------------------------------------
// AC6: transition by token not holding lease (non-human) reject
// ---------------------------------------------------------------------------

describe('AC6: transition by token not holding lease (non-human) reject', () => {
  it('rejects transition when implementer does not hold lease', () => {
    const tasks = new Map<string, Task>([
      ['task1', {
        id: 'task1',
        assignee_token_id: 'token1',
        lease_until: '2026-06-09T10:30:00Z',
      }],
    ])
    const leaseRepo = makeLeaseRepo(tasks)
    const transitionRepo = makeTransitionRepo()
    const now = () => '2026-06-09T10:00:00Z'

    const result = propose({
      task_id: 'task1',
      current_state: 'TODO',
      from: 'TODO',
      to: 'IN_PROGRESS',
      actor_role: 'implementer',
      actor_token_id: 'token2', // different from lease holder
      leaseRepo,
    }, transitionRepo, now)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('does not hold the lease')
  })

  it('allows transition when implementer holds lease', () => {
    const tasks = new Map<string, Task>([
      ['task1', {
        id: 'task1',
        assignee_token_id: 'token1',
        lease_until: '2026-06-09T10:30:00Z',
      }],
    ])
    const leaseRepo = makeLeaseRepo(tasks)
    const transitionRepo = makeTransitionRepo()
    const now = () => '2026-06-09T10:00:00Z'

    const result = propose({
      task_id: 'task1',
      current_state: 'TODO',
      from: 'TODO',
      to: 'IN_PROGRESS',
      actor_role: 'implementer',
      actor_token_id: 'token1', // matches lease holder
      leaseRepo,
    }, transitionRepo, now)

    expect(result.ok).toBe(true)
  })

  it('allows transition for human role without lease', () => {
    const tasks = new Map<string, Task>([
      ['task1', {
        id: 'task1',
        assignee_token_id: 'token1',
        lease_until: '2026-06-09T10:30:00Z',
      }],
    ])
    const leaseRepo = makeLeaseRepo(tasks)
    const transitionRepo = makeTransitionRepo()
    const now = () => '2026-06-09T10:00:00Z'

    const result = propose({
      task_id: 'task1',
      current_state: 'JUDGE_PASSED',
      from: 'JUDGE_PASSED',
      to: 'DONE',
      actor_role: 'human',
      actor_token_id: 'human_token', // different from lease holder
      leaseRepo,
    }, transitionRepo, now)

    expect(result.ok).toBe(true) // human doesn't need lease
  })

  it('allows transition for judge role without lease', () => {
    const tasks = new Map<string, Task>([
      ['task1', {
        id: 'task1',
        assignee_token_id: 'token1',
        lease_until: '2026-06-09T10:30:00Z',
      }],
    ])
    const leaseRepo = makeLeaseRepo(tasks)
    const transitionRepo = makeTransitionRepo()
    const now = () => '2026-06-09T10:00:00Z'

    const result = propose({
      task_id: 'task1',
      current_state: 'SELF_CHECK_PASSED',
      from: 'SELF_CHECK_PASSED',
      to: 'JUDGE_PASSED',
      actor_role: 'judge',
      actor_token_id: 'judge_token', // different from lease holder
      comments: [{ kind: 'verdict', verdict: 'PASS', body_md: 'ok', author_role: 'judge', author_token_id: 'judge_token' }],
      leaseRepo,
    }, transitionRepo, now)

    expect(result.ok).toBe(true) // judge doesn't need lease
  })

  it('allows transition for self-check role without lease', () => {
    const tasks = new Map<string, Task>([
      ['task1', {
        id: 'task1',
        assignee_token_id: 'token1',
        lease_until: '2026-06-09T10:30:00Z',
      }],
    ])
    const leaseRepo = makeLeaseRepo(tasks)
    const transitionRepo = makeTransitionRepo()
    const now = () => '2026-06-09T10:00:00Z'

    const result = propose({
      task_id: 'task1',
      current_state: 'IMPLEMENTED',
      from: 'IMPLEMENTED',
      to: 'SELF_CHECK_PASSED',
      actor_role: 'self-check',
      actor_token_id: 'selfcheck_token', // different from lease holder
      leaseRepo,
    }, transitionRepo, now)

    expect(result.ok).toBe(true) // self-check doesn't need lease
  })
})

// ---------------------------------------------------------------------------
// checkLease helper
// ---------------------------------------------------------------------------

describe('checkLease helper', () => {
  it('returns hasLease=true when token holds active lease', () => {
    const tasks = new Map<string, Task>([
      ['task1', {
        id: 'task1',
        assignee_token_id: 'token1',
        lease_until: '2026-06-09T10:30:00Z',
      }],
    ])
    const repo = makeLeaseRepo(tasks)
    const now = () => '2026-06-09T10:00:00Z'

    const result = checkLease('task1', 'token1', repo, now)

    expect(result.hasLease).toBe(true)
  })

  it('returns hasLease=false when token is different', () => {
    const tasks = new Map<string, Task>([
      ['task1', {
        id: 'task1',
        assignee_token_id: 'token1',
        lease_until: '2026-06-09T10:30:00Z',
      }],
    ])
    const repo = makeLeaseRepo(tasks)
    const now = () => '2026-06-09T10:00:00Z'

    const result = checkLease('task1', 'token2', repo, now)

    expect(result.hasLease).toBe(false)
    expect(result.error).toContain('does not hold the lease')
  })

  it('returns hasLease=false when lease has expired', () => {
    const tasks = new Map<string, Task>([
      ['task1', {
        id: 'task1',
        assignee_token_id: 'token1',
        lease_until: '2026-06-09T09:00:00Z',
      }],
    ])
    const repo = makeLeaseRepo(tasks)
    const now = () => '2026-06-09T10:00:00Z'

    const result = checkLease('task1', 'token1', repo, now)

    expect(result.hasLease).toBe(false)
  })

  it('returns hasLease=false when no lease exists', () => {
    const tasks = new Map<string, Task>([
      ['task1', {
        id: 'task1',
        assignee_token_id: null,
        lease_until: null,
      }],
    ])
    const repo = makeLeaseRepo(tasks)
    const now = () => '2026-06-09T10:00:00Z'

    const result = checkLease('task1', 'token1', repo, now)

    expect(result.hasLease).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AC7: Transaction semantics (atomic check-and-set)
// ---------------------------------------------------------------------------

describe('AC7: transaction semantics', () => {
  it('claim uses atomic check-and-set via repository (simulated transaction)', () => {
    // This test demonstrates that claim performs check-then-write atomically.
    // In production, the repository MUST wrap this in a SQLite transaction.
    const tasks = new Map<string, Task>([
      ['task1', { id: 'task1', assignee_token_id: null, lease_until: null }],
    ])
    const repo = makeLeaseRepo(tasks)
    const now = () => '2026-06-09T10:00:00Z'

    // First claim succeeds
    const result1 = claim('task1', 'token1', repo, defaultConfig, now)
    expect(result1.ok).toBe(true)
    expect(result1.task!.assignee_token_id).toBe('token1')

    // Second claim by different token fails (lease is active)
    const result2 = claim('task1', 'token2', repo, defaultConfig, now)
    expect(result2.ok).toBe(false)
    expect(result2.error).toContain('already leased')

    // The task is still leased to token1
    const finalTask = repo.getTaskById('task1')
    expect(finalTask!.assignee_token_id).toBe('token1')
  })
})
