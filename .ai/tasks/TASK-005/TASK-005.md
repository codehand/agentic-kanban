# TASK-005: P3: State machine and Gate (core enforcement)

Repos: .
Branch: fix/TASK-005-p3-state-machine-gate

## Purpose
The gate is the **single** entity allowed to write `state` and append a `transition` (append-only). It
reproduces the local `gate.sh`: enforcing the transition table + role + guards + evidence checksum. This
is the central pillar against false-positive completion — no agent self-certifies. (From P3 Mục tiêu,
TASK_HUB_DESIGN.md §5, §1.1.)

## Scope

### In scope
- A pure `ALLOWED` transition table (`FROM->TO:role`) exactly per TASK_HUB_DESIGN.md §5:
  - `TODO->IN_PROGRESS:implementer`
  - `IN_PROGRESS->IMPLEMENTED:implementer`
  - `IMPLEMENTED->SELF_CHECK_PASSED|SELF_CHECK_FAILED:self-check`
  - `SELF_CHECK_FAILED->IN_PROGRESS:implementer`
  - `SELF_CHECK_PASSED->JUDGE_PASSED|JUDGE_REJECTED:judge`
  - `JUDGE_REJECTED->IN_PROGRESS:implementer`
  - `JUDGE_PASSED->DONE:human`
- `gate.propose`: validate actual current state == `from`, transition is in the table, role is correct,
  and reject any skip ("nhảy cóc").
- Guards:
  - `->IMPLEMENTED`: every `gitref` has `head_sha != base_sha`, or `allow_no_code_change` is set.
  - `->JUDGE_PASSED` / `->JUDGE_REJECTED`: require a `comment` with `kind=verdict` and the matching
    `verdict` value to exist.
  - `->JUDGE_PASSED` (and self-check): re-verify evidence checksum (`manifest_json`).
  - `->DONE`: role `human` only.
- Write `transition` append-only (actor_role / actor_token_id / at / note / evidence_id).

### Out of scope
- Reading evidence to score self-check itself (P4 calls the gate).
- Concurrency lease guard (P6).

## Acceptance Criteria

### Machine-verifiable
> build/test may be 'na' until P0 creates package.json; ac.sh asserts the concrete artifacts below.
- [ ] AC1: domain modules exist: `server/src/domain/statemachine.ts`, `gate.ts`, `guards.ts`.
- [ ] AC2: `statemachine.ts` encodes the full §5 `ALLOWED` table (all FROM->TO:role rows above).
- [ ] AC3: a skip transition (e.g. `IMPLEMENTED->JUDGE_PASSED`) is rejected — covered by a test.
- [ ] AC4: a wrong-role proposal is rejected — covered by a test.
- [ ] AC5: `->IMPLEMENTED` with no repo changed and no `allow_no_code_change` is rejected; with the
  flag it passes — covered by a test.
- [ ] AC6: `->JUDGE_PASSED` without a `verdict=PASS` comment is rejected — covered by a test.
- [ ] AC7: `->DONE` proposed by a non-human role is rejected — covered by a test.
- [ ] AC8: when a package.json exists, `pnpm build` (build.exit==0) and `pnpm test` (test.exit==0)
  pass; otherwise build/test are 'na'.

### Human / semantic (Judge + Human)
- [ ] AC9: tests are real (no skips, no deleted assertions, no tautologies) and cover every reject
  branch plus the happy path, not just one direction.
- [ ] AC10: the gate is the only writer of `state`/`transition`; transitions are append-only with
  actor_role/actor_token_id/at recorded (TASK_HUB_DESIGN.md §1.1).
- [ ] AC11: the `->IMPLEMENTED` guard correctly handles multi-repo — it must consider **every**
  `gitref` row of the task, not just one (TASK_HUB_DESIGN.md §10).

## Definition of Done
Every machine-verifiable AC passes under freshly generated evidence, Judge `VERDICT: PASS`, and human
`.ai/scripts/gate.sh approve TASK-005`.

## Dependencies
TASK-004 (P2: role authorize). Also depends on P1 data model (transition/comment/evidence/gitref).

## References
- docs/phases/P3.md
- docs/IMPLEMENTATION_PLAN.md (§5 P3, §4.3 gate as test pillar, §2 foundational invariants)
- TASK_HUB_DESIGN.md §5 (state machine + transition table + role), §8 (verdict comment),
  §6 note + §7.3 (checksum re-verify), §1.1 (only the gate writes state), §10 (multi-repo gitref)
