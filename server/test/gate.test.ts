/**
 * gate.test.ts — Tests for statemachine.ts, guards.ts, and gate.ts.
 * Covers every reject branch + happy path per AC3–AC7.
 */

import { describe, it, expect } from 'vitest'
import { ALLOWED, isAllowed, allowedRole } from '../src/domain/statemachine.js'
import type { TaskState } from '../src/domain/statemachine.js'
import { guardImplemented, guardVerdict, guardChecksum } from '../src/domain/guards.js'
import { propose } from '../src/domain/gate.js'
import type { TransitionRepository, TransitionRecord } from '../src/domain/gate.js'

// ---------------------------------------------------------------------------
// Test repository
// ---------------------------------------------------------------------------

function makeRepo(): TransitionRepository & {
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

const sha256Identity = (s: string) => s  // deterministic fake hash

// ---------------------------------------------------------------------------
// statemachine.ts — ALLOWED table (AC2)
// ---------------------------------------------------------------------------

describe('statemachine ALLOWED table', () => {
  it('contains all required states', () => {
    const states = new Set(ALLOWED.flatMap(t => [t.from, t.to]))
    expect(states.has('TODO')).toBe(true)
    expect(states.has('IN_PROGRESS')).toBe(true)
    expect(states.has('IMPLEMENTED')).toBe(true)
    expect(states.has('SELF_CHECK_PASSED')).toBe(true)
    expect(states.has('SELF_CHECK_FAILED')).toBe(true)
    expect(states.has('JUDGE_PASSED')).toBe(true)
    expect(states.has('JUDGE_REJECTED')).toBe(true)
    expect(states.has('DONE')).toBe(true)
  })

  it('contains all required roles', () => {
    const roles = new Set(ALLOWED.map(t => t.role))
    expect(roles.has('implementer')).toBe(true)
    expect(roles.has('self-check')).toBe(true)
    expect(roles.has('judge')).toBe(true)
    expect(roles.has('human')).toBe(true)
  })

  it('isAllowed returns true for valid transitions', () => {
    expect(isAllowed('TODO', 'IN_PROGRESS', 'implementer')).toBe(true)
    expect(isAllowed('IN_PROGRESS', 'IMPLEMENTED', 'implementer')).toBe(true)
    expect(isAllowed('IMPLEMENTED', 'SELF_CHECK_PASSED', 'self-check')).toBe(true)
    expect(isAllowed('IMPLEMENTED', 'SELF_CHECK_FAILED', 'self-check')).toBe(true)
    expect(isAllowed('SELF_CHECK_FAILED', 'IN_PROGRESS', 'implementer')).toBe(true)
    expect(isAllowed('SELF_CHECK_PASSED', 'JUDGE_PASSED', 'judge')).toBe(true)
    expect(isAllowed('SELF_CHECK_PASSED', 'JUDGE_REJECTED', 'judge')).toBe(true)
    expect(isAllowed('JUDGE_REJECTED', 'IN_PROGRESS', 'implementer')).toBe(true)
    expect(isAllowed('JUDGE_PASSED', 'DONE', 'human')).toBe(true)
    // Human reset (TASK-025): design §3 grants human reset of failed/rejected tasks.
    expect(isAllowed('SELF_CHECK_FAILED', 'IN_PROGRESS', 'human')).toBe(true)
    expect(isAllowed('JUDGE_REJECTED', 'IN_PROGRESS', 'human')).toBe(true)
  })

  it('isAllowed returns false for invalid role on valid transition', () => {
    expect(isAllowed('TODO', 'IN_PROGRESS', 'judge')).toBe(false)
    expect(isAllowed('JUDGE_PASSED', 'DONE', 'implementer')).toBe(false)
  })

  it('allowedRole returns correct role for valid transitions', () => {
    expect(allowedRole('TODO', 'IN_PROGRESS')).toBe('implementer')
    expect(allowedRole('JUDGE_PASSED', 'DONE')).toBe('human')
  })

  it('allowedRole returns null for unknown transition', () => {
    expect(allowedRole('IMPLEMENTED', 'JUDGE_PASSED')).toBeNull()
    expect(allowedRole('TODO', 'DONE')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// AC3: skip transition is rejected (nhảy cóc)
// ---------------------------------------------------------------------------

describe('AC3: skip/jump transitions are rejected', () => {
  it('rejects IMPLEMENTED -> JUDGE_PASSED (skip self-check)', () => {
    const repo = makeRepo()
    const result = propose({
      task_id: 't1',
      current_state: 'IMPLEMENTED',
      from: 'IMPLEMENTED',
      to: 'JUDGE_PASSED',
      actor_role: 'judge',
      actor_token_id: 'tok1',
    }, repo)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/ALLOWED/)
  })

  it('rejects TODO -> DONE (big jump)', () => {
    const repo = makeRepo()
    const result = propose({
      task_id: 't1',
      current_state: 'TODO',
      from: 'TODO',
      to: 'DONE',
      actor_role: 'human',
      actor_token_id: 'tok1',
    }, repo)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/ALLOWED/)
  })

  it('rejects TODO -> IMPLEMENTED (skip IN_PROGRESS)', () => {
    const repo = makeRepo()
    const result = propose({
      task_id: 't1',
      current_state: 'TODO',
      from: 'TODO',
      to: 'IMPLEMENTED',
      actor_role: 'implementer',
      actor_token_id: 'tok1',
    }, repo)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/ALLOWED/)
  })
})

// ---------------------------------------------------------------------------
// AC4: wrong-role proposal is rejected
// ---------------------------------------------------------------------------

describe('AC4: wrong role is rejected', () => {
  it('rejects implementer trying JUDGE_PASSED -> DONE', () => {
    const repo = makeRepo()
    const result = propose({
      task_id: 't1',
      current_state: 'JUDGE_PASSED',
      from: 'JUDGE_PASSED',
      to: 'DONE',
      actor_role: 'implementer',
      actor_token_id: 'tok1',
    }, repo)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/[Rr]ole/)
  })

  it('rejects judge trying TODO -> IN_PROGRESS', () => {
    const repo = makeRepo()
    const result = propose({
      task_id: 't1',
      current_state: 'TODO',
      from: 'TODO',
      to: 'IN_PROGRESS',
      actor_role: 'judge',
      actor_token_id: 'tok1',
    }, repo)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/[Rr]ole/)
  })

  it('rejects self-check trying IMPLEMENTED -> SELF_CHECK_PASSED with wrong role', () => {
    // self-check is correct for this transition — verify implementer is rejected
    const repo = makeRepo()
    const result = propose({
      task_id: 't1',
      current_state: 'IMPLEMENTED',
      from: 'IMPLEMENTED',
      to: 'SELF_CHECK_PASSED',
      actor_role: 'implementer',
      actor_token_id: 'tok1',
      evidence: { manifest_json: 'data', checksum: 'data' },
      computeChecksum: sha256Identity,
    }, repo)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/[Rr]ole/)
  })
})

// ---------------------------------------------------------------------------
// AC5: ->IMPLEMENTED guard
// ---------------------------------------------------------------------------

describe('AC5: ->IMPLEMENTED gitref guard', () => {
  it('rejects when no gitrefs are provided and no allow_no_code_change', () => {
    const err = guardImplemented([], false)
    expect(err).toBeTruthy()
    expect(err).toMatch(/gitref|head_sha|allow_no_code_change/i)
  })

  it('rejects when head_sha === base_sha (no commit)', () => {
    const err = guardImplemented(
      [{ repo: 'main', base_sha: 'abc', head_sha: 'abc' }],
      false,
    )
    expect(err).toBeTruthy()
    expect(err).toMatch(/head_sha == base_sha/i)
  })

  it('rejects multi-repo when ANY repo has head_sha == base_sha', () => {
    const err = guardImplemented(
      [
        { repo: 'repo-a', base_sha: 'aaa', head_sha: 'bbb' },
        { repo: 'repo-b', base_sha: 'ccc', head_sha: 'ccc' },
      ],
      false,
    )
    expect(err).toBeTruthy()
    expect(err).toContain('repo-b')
  })

  it('passes when allow_no_code_change is true (no gitrefs)', () => {
    const err = guardImplemented([], true)
    expect(err).toBeNull()
  })

  it('passes when head_sha != base_sha for all repos', () => {
    const err = guardImplemented(
      [{ repo: 'main', base_sha: 'abc', head_sha: 'def' }],
      false,
    )
    expect(err).toBeNull()
  })

  it('rejects via propose() when no code change and no flag', () => {
    const repo = makeRepo()
    const result = propose({
      task_id: 't1',
      current_state: 'IN_PROGRESS',
      from: 'IN_PROGRESS',
      to: 'IMPLEMENTED',
      actor_role: 'implementer',
      actor_token_id: 'tok1',
      gitrefs: [],
      allow_no_code_change: false,
    }, repo)
    expect(result.ok).toBe(false)
  })

  it('passes via propose() with allow_no_code_change', () => {
    const repo = makeRepo()
    const result = propose({
      task_id: 't1',
      current_state: 'IN_PROGRESS',
      from: 'IN_PROGRESS',
      to: 'IMPLEMENTED',
      actor_role: 'implementer',
      actor_token_id: 'tok1',
      gitrefs: [],
      allow_no_code_change: true,
    }, repo)
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// AC6: ->JUDGE_PASSED without verdict=PASS comment is rejected
// ---------------------------------------------------------------------------

describe('AC6: verdict guard', () => {
  it('rejects ->JUDGE_PASSED with no verdict comment', () => {
    const err = guardVerdict('JUDGE_PASSED', [])
    expect(err).toBeTruthy()
    expect(err).toMatch(/verdict/i)
  })

  it('rejects ->JUDGE_PASSED with wrong verdict value', () => {
    const err = guardVerdict('JUDGE_PASSED', [{ kind: 'verdict', verdict: 'REJECT' }])
    expect(err).toBeTruthy()
  })

  it('rejects ->JUDGE_REJECTED with no verdict comment', () => {
    const err = guardVerdict('JUDGE_REJECTED', [])
    expect(err).toBeTruthy()
  })

  it('passes ->JUDGE_PASSED with verdict=PASS comment', () => {
    const err = guardVerdict('JUDGE_PASSED', [{ kind: 'verdict', verdict: 'PASS' }])
    expect(err).toBeNull()
  })

  it('passes ->JUDGE_REJECTED with verdict=REJECT comment', () => {
    const err = guardVerdict('JUDGE_REJECTED', [{ kind: 'verdict', verdict: 'REJECT' }])
    expect(err).toBeNull()
  })

  it('ignores non-verdict kind comments', () => {
    const err = guardVerdict('JUDGE_PASSED', [{ kind: 'narrative', verdict: 'PASS' }])
    expect(err).toBeTruthy()
  })

  it('rejects ->JUDGE_PASSED via propose() without verdict comment', () => {
    const repo = makeRepo()
    const result = propose({
      task_id: 't1',
      current_state: 'SELF_CHECK_PASSED',
      from: 'SELF_CHECK_PASSED',
      to: 'JUDGE_PASSED',
      actor_role: 'judge',
      actor_token_id: 'tok1',
      comments: [],
      evidence: { manifest_json: 'data', checksum: 'data' },
      computeChecksum: sha256Identity,
    }, repo)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/verdict/i)
  })
})

// ---------------------------------------------------------------------------
// AC7: ->DONE by non-human role is rejected
// ---------------------------------------------------------------------------

describe('AC7: ->DONE non-human is rejected', () => {
  it('rejects implementer -> DONE', () => {
    const repo = makeRepo()
    const result = propose({
      task_id: 't1',
      current_state: 'JUDGE_PASSED',
      from: 'JUDGE_PASSED',
      to: 'DONE',
      actor_role: 'implementer',
      actor_token_id: 'tok1',
    }, repo)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/[Rr]ole/)
  })

  it('rejects judge -> DONE', () => {
    const repo = makeRepo()
    const result = propose({
      task_id: 't1',
      current_state: 'JUDGE_PASSED',
      from: 'JUDGE_PASSED',
      to: 'DONE',
      actor_role: 'judge',
      actor_token_id: 'tok1',
    }, repo)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/[Rr]ole/)
  })

  it('rejects self-check -> DONE', () => {
    const repo = makeRepo()
    const result = propose({
      task_id: 't1',
      current_state: 'JUDGE_PASSED',
      from: 'JUDGE_PASSED',
      to: 'DONE',
      actor_role: 'self-check',
      actor_token_id: 'tok1',
    }, repo)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/[Rr]ole/)
  })

  it('passes human -> DONE', () => {
    const repo = makeRepo()
    const result = propose({
      task_id: 't1',
      current_state: 'JUDGE_PASSED',
      from: 'JUDGE_PASSED',
      to: 'DONE',
      actor_role: 'human',
      actor_token_id: 'tok1',
    }, repo)
    expect(result.ok).toBe(true)
    expect(repo.states['t1']).toBe('DONE')
  })
})

// ---------------------------------------------------------------------------
// Checksum guard (re-verify evidence)
// ---------------------------------------------------------------------------

describe('guardChecksum', () => {
  it('rejects when evidence is null', () => {
    const err = guardChecksum(null, sha256Identity)
    expect(err).toBeTruthy()
  })

  it('rejects when checksum does not match', () => {
    const err = guardChecksum(
      { manifest_json: 'data', checksum: 'wrong' },
      sha256Identity,
    )
    expect(err).toBeTruthy()
    expect(err).toMatch(/checksum/i)
  })

  it('passes when checksum matches', () => {
    const err = guardChecksum(
      { manifest_json: 'data', checksum: 'data' },
      sha256Identity,
    )
    expect(err).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Checksum guard on SELF_CHECK transitions (via propose)
// ---------------------------------------------------------------------------

describe('SELF_CHECK: checksum guard via propose()', () => {
  it('rejects IMPLEMENTED -> SELF_CHECK_PASSED when evidence is missing', () => {
    const repo = makeRepo()
    const result = propose({
      task_id: 't1',
      current_state: 'IMPLEMENTED',
      from: 'IMPLEMENTED',
      to: 'SELF_CHECK_PASSED',
      actor_role: 'self-check',
      actor_token_id: 'tok1',
      evidence: null,
      computeChecksum: sha256Identity,
    }, repo)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/[Ee]vidence|checksum/i)
  })

  it('rejects IMPLEMENTED -> SELF_CHECK_FAILED when evidence is missing', () => {
    const repo = makeRepo()
    const result = propose({
      task_id: 't1',
      current_state: 'IMPLEMENTED',
      from: 'IMPLEMENTED',
      to: 'SELF_CHECK_FAILED',
      actor_role: 'self-check',
      actor_token_id: 'tok1',
      evidence: null,
      computeChecksum: sha256Identity,
    }, repo)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/[Ee]vidence|checksum/i)
  })

  it('rejects IMPLEMENTED -> SELF_CHECK_PASSED when checksum does not match', () => {
    const repo = makeRepo()
    const result = propose({
      task_id: 't1',
      current_state: 'IMPLEMENTED',
      from: 'IMPLEMENTED',
      to: 'SELF_CHECK_PASSED',
      actor_role: 'self-check',
      actor_token_id: 'tok1',
      evidence: { manifest_json: 'real-data', checksum: 'wrong-checksum' },
      computeChecksum: sha256Identity,
    }, repo)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/checksum/i)
  })

  it('rejects IMPLEMENTED -> SELF_CHECK_FAILED when checksum does not match', () => {
    const repo = makeRepo()
    const result = propose({
      task_id: 't1',
      current_state: 'IMPLEMENTED',
      from: 'IMPLEMENTED',
      to: 'SELF_CHECK_FAILED',
      actor_role: 'self-check',
      actor_token_id: 'tok1',
      evidence: { manifest_json: 'real-data', checksum: 'wrong-checksum' },
      computeChecksum: sha256Identity,
    }, repo)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/checksum/i)
  })
})

// ---------------------------------------------------------------------------
// State mismatch
// ---------------------------------------------------------------------------

describe('propose: current_state mismatch', () => {
  it('rejects when current_state != from', () => {
    const repo = makeRepo()
    const result = propose({
      task_id: 't1',
      current_state: 'IN_PROGRESS',
      from: 'TODO',
      to: 'IN_PROGRESS',
      actor_role: 'implementer',
      actor_token_id: 'tok1',
    }, repo)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/State mismatch/)
  })
})

// ---------------------------------------------------------------------------
// Happy path: gate writes transition record append-only
// ---------------------------------------------------------------------------

describe('propose: happy path', () => {
  it('TODO -> IN_PROGRESS writes transition with actor metadata', () => {
    const repo = makeRepo()
    const result = propose({
      task_id: 'task-1',
      current_state: 'TODO',
      from: 'TODO',
      to: 'IN_PROGRESS',
      actor_role: 'implementer',
      actor_token_id: 'token-abc',
      note: 'starting work',
    }, repo)
    expect(result.ok).toBe(true)
    expect(result.transition).toBeDefined()
    expect(result.transition!.actor_role).toBe('implementer')
    expect(result.transition!.actor_token_id).toBe('token-abc')
    expect(result.transition!.at).toBeTruthy()
    expect(result.transition!.note).toBe('starting work')
    expect(repo.transitions).toHaveLength(1)
    expect(repo.states['task-1']).toBe('IN_PROGRESS')
  })

  it('IN_PROGRESS -> IMPLEMENTED with valid gitref', () => {
    const repo = makeRepo()
    const result = propose({
      task_id: 'task-1',
      current_state: 'IN_PROGRESS',
      from: 'IN_PROGRESS',
      to: 'IMPLEMENTED',
      actor_role: 'implementer',
      actor_token_id: 'token-abc',
      gitrefs: [{ repo: 'main', base_sha: 'aaa', head_sha: 'bbb' }],
    }, repo)
    expect(result.ok).toBe(true)
    expect(repo.states['task-1']).toBe('IMPLEMENTED')
  })

  it('IMPLEMENTED -> SELF_CHECK_PASSED (self-check happy path with valid checksum)', () => {
    const repo = makeRepo()
    const result = propose({
      task_id: 'task-1',
      current_state: 'IMPLEMENTED',
      from: 'IMPLEMENTED',
      to: 'SELF_CHECK_PASSED',
      actor_role: 'self-check',
      actor_token_id: 'token-selfcheck',
      evidence: { manifest_json: 'my-evidence', checksum: 'my-evidence' },
      computeChecksum: sha256Identity,
    }, repo)
    expect(result.ok).toBe(true)
    expect(result.transition).toBeDefined()
    expect(result.transition!.from_state).toBe('IMPLEMENTED')
    expect(result.transition!.to_state).toBe('SELF_CHECK_PASSED')
    expect(result.transition!.actor_role).toBe('self-check')
    expect(repo.states['task-1']).toBe('SELF_CHECK_PASSED')
  })

  it('IMPLEMENTED -> SELF_CHECK_FAILED (self-check happy path with valid checksum)', () => {
    const repo = makeRepo()
    const result = propose({
      task_id: 'task-1',
      current_state: 'IMPLEMENTED',
      from: 'IMPLEMENTED',
      to: 'SELF_CHECK_FAILED',
      actor_role: 'self-check',
      actor_token_id: 'token-selfcheck',
      evidence: { manifest_json: 'failed-evidence', checksum: 'failed-evidence' },
      computeChecksum: sha256Identity,
    }, repo)
    expect(result.ok).toBe(true)
    expect(result.transition).toBeDefined()
    expect(result.transition!.from_state).toBe('IMPLEMENTED')
    expect(result.transition!.to_state).toBe('SELF_CHECK_FAILED')
    expect(result.transition!.actor_role).toBe('self-check')
    expect(repo.states['task-1']).toBe('SELF_CHECK_FAILED')
  })

  it('SELF_CHECK_PASSED -> JUDGE_PASSED with verdict + checksum', () => {
    const repo = makeRepo()
    const result = propose({
      task_id: 'task-1',
      current_state: 'SELF_CHECK_PASSED',
      from: 'SELF_CHECK_PASSED',
      to: 'JUDGE_PASSED',
      actor_role: 'judge',
      actor_token_id: 'token-judge',
      comments: [{ kind: 'verdict', verdict: 'PASS' }],
      evidence: { manifest_json: 'manifest', checksum: 'manifest' },
      computeChecksum: sha256Identity,
    }, repo)
    expect(result.ok).toBe(true)
    expect(repo.states['task-1']).toBe('JUDGE_PASSED')
  })

  it('SELF_CHECK_FAILED -> IN_PROGRESS (rework)', () => {
    const repo = makeRepo()
    const result = propose({
      task_id: 'task-1',
      current_state: 'SELF_CHECK_FAILED',
      from: 'SELF_CHECK_FAILED',
      to: 'IN_PROGRESS',
      actor_role: 'implementer',
      actor_token_id: 'token-abc',
    }, repo)
    expect(result.ok).toBe(true)
    expect(repo.states['task-1']).toBe('IN_PROGRESS')
  })

  it('JUDGE_REJECTED -> IN_PROGRESS (rework)', () => {
    const repo = makeRepo()
    const result = propose({
      task_id: 'task-1',
      current_state: 'JUDGE_REJECTED',
      from: 'JUDGE_REJECTED',
      to: 'IN_PROGRESS',
      actor_role: 'implementer',
      actor_token_id: 'token-abc',
    }, repo)
    expect(result.ok).toBe(true)
    expect(repo.states['task-1']).toBe('IN_PROGRESS')
  })

  it('multiple transitions accumulate (append-only)', () => {
    const repo = makeRepo()
    propose({
      task_id: 'task-1',
      current_state: 'TODO',
      from: 'TODO',
      to: 'IN_PROGRESS',
      actor_role: 'implementer',
      actor_token_id: 'tok',
    }, repo)
    propose({
      task_id: 'task-1',
      current_state: 'IN_PROGRESS',
      from: 'IN_PROGRESS',
      to: 'IMPLEMENTED',
      actor_role: 'implementer',
      actor_token_id: 'tok',
      gitrefs: [{ repo: 'main', base_sha: '111', head_sha: '222' }],
    }, repo)
    expect(repo.transitions).toHaveLength(2)
    expect(repo.transitions[0].to_state).toBe('IN_PROGRESS')
    expect(repo.transitions[1].to_state).toBe('IMPLEMENTED')
  })
})
