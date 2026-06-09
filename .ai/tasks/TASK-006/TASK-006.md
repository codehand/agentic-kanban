# TASK-006: P4: Evidence subsystem

Repos: .
Branch: fix/TASK-006-p4-evidence-subsystem

## Purpose
Make evidence "machine-measured truth, immutable" so agents cannot fabricate results.
Only the `runner` role may write evidence; once written it is locked with a checksum.
`task.selfcheck` reads the latest evidence, verifies the manifest checksum, scores it
against config, and then lets the **gate** (P3) flip the state — handlers never write
state directly.

## Scope

### In scope
- `evidence.submit(...)` — **runner-only** — writes one immutable row per run:
  `build_exit` / `test_exit` / `lint_exit` / `ac_exit`, `coverage_pct`, `manifest_json`
  (file → sha256), `logs_json`. Each submit is a new run (append-only, no update path).
- `task.selfcheck(key)` — reads the **latest** evidence (by `created_at`, tie-broken by
  `id`), verifies the manifest checksum, scores: build/test/ac are **hard-required**;
  lint/coverage follow config (optional → warn, required → block) — then calls the
  **gate** to set `SELF_CHECK_PASSED` | `SELF_CHECK_FAILED`.
- Re-verify the manifest checksum at the judge transition (cooperating with the P3 guard).
- Modules: `server/src/domain/evidence.ts` (`submit()` + `selfcheck()`),
  `server/src/domain/checksum.ts` (verify `manifest_json` file → sha256). Reuse
  `server/src/domain/gate.ts` (P3) to set state from selfcheck.

### Out of scope
- Writing state directly (P4 calls the P3 gate).
- Running build/test/lint (the runner does that locally; the server never executes them).
- The MCP tool surface for evidence (P5); lease/claim semantics (P6).

## Acceptance Criteria

### Machine-verifiable (chấm bởi TASK-006.ac.sh + gate; build/test/ac hard-required, 'na' nếu repo chưa có project)
- [ ] AC1: project builds (build.exit == 0) — lệnh từ .ai/config.yml (`pnpm build`). NOTE: build/test
      report 'na' until P0 (TASK-002) creates `package.json`; gate accepts 'na' for a project-less repo.
- [ ] AC2: tests pass (test.exit == 0) — `pnpm test` (vitest).
- [ ] AC3: `server/src/domain/evidence.ts` exists and exports `submit` and `selfcheck`.
- [ ] AC4: `server/src/domain/checksum.ts` exists and exports a manifest-verify function.
- [ ] AC5: `evidence.submit` enforces role=runner (a non-runner role is rejected) — covered by a test.
- [ ] AC6: evidence is append-only / immutable — NO update/edit path on an evidence row; a test asserts
      a second submit creates a new row and leaves the prior row unchanged.
- [ ] AC7: selfcheck scoring is exercised by tests — build/test/ac == 0 → PASSED; any != 0 → FAILED.
- [ ] AC8: a tampered manifest checksum (simulated mismatch) makes selfcheck/judge reject — test present.
- [ ] AC9: lint/coverage config behaviour tested — optional → warn (does not block); required → blocks.
- [ ] AC10: a test asserts selfcheck does NOT write state itself but delegates to the P3 gate
      (`gate.ts`) to set `SELF_CHECK_PASSED` | `SELF_CHECK_FAILED`.

### Human / semantic (Judge + Human)
- [ ] AC11: tests are real — no tautologies, no skipped (`it.skip`) tests, no deleted assertions to pass.
- [ ] AC12: "latest evidence" is defined unambiguously (created_at, tie-broken by id) and used
      consistently by selfcheck and the judge re-verify, per TASK_HUB_DESIGN.md §7.
- [ ] AC13: error paths are covered — wrong role, checksum mismatch, missing evidence, required-check
      failure — and selfcheck genuinely delegates state changes to the gate, following TASK_HUB_DESIGN.md.

## Definition of Done
Mọi machine-verifiable AC pass dưới evidence mới sinh, Judge `VERDICT: PASS`, và human `.ai/scripts/gate.sh approve TASK-006`.

## Dependencies
TASK-005

## References
- docs/phases/P4.md
- docs/IMPLEMENTATION_PLAN.md (§5 P4, §7 defense-in-depth)
- TASK_HUB_DESIGN.md §7 (luồng evidence — runner-only, immutable, checksum, latest), §6 (`evidence.submit`, `task.selfcheck`), §1.2 (evidence immutable + checksum)
