# TASK-011: P9: Hardening, docs, deploy (v1)

Repos: .
Branch: fix/TASK-011-p9-hardening-deploy

## Purpose
Make the Task Hub server run reliably on a LAN for a single operator: consistent error responses,
basic input limits, structured logs for every transition, a README quickstart + runbook, SQLite
backup, graceful shutdown (close the DB without corrupting the file), a deploy unit (systemd /
container), basic metrics, and verified UI accessibility (AA). This is v1 polish — no features
beyond TASK_HUB_DESIGN.md §13 (LAN / single-user, no TLS/RBAC, no auto-merge).

## Scope
- In scope:
  - Consistent error responses separating domain rejects from system errors; basic input limits
    (size / rate) in `server/src/http/server.ts`.
  - Structured logs (pino) for each transition recording actor, from→to, evidence_ref
    (`server/src/logger.ts`), without logging secrets.
  - `README.md` quickstart + `docs/RUNBOOK.md` runbook (clean-machine end-to-end, backup, deploy).
  - SQLite backup + graceful shutdown that closes the DB cleanly.
  - `deploy/` systemd unit and/or Dockerfile; a small metrics endpoint.
  - Verify UI accessibility AA (inherited from prototype) via Lighthouse.
- Out of scope:
  - TLS, multi-human RBAC, public-internet auth, auto-merge MR
    (IMPLEMENTATION_PLAN.md §10, TASK_HUB_DESIGN.md §13).
  - New product features beyond the locked v1 design.

## Acceptance Criteria

### Machine-verifiable (chấm bởi TASK-011.ac.sh + gate; build/test/ac hard-required, 'na' nếu repo chưa có project)
- [ ] AC1: project builds (build.exit == 0) — lệnh từ .ai/config.yml (mặc định `pnpm build`).
- [ ] AC2: tests pass (test.exit == 0) — mặc định `pnpm test` (vitest).
- [ ] AC3: `README.md` exists and contains a quickstart section (install/build/run steps) plus a
      backup/deploy reference.
- [ ] AC4: `docs/RUNBOOK.md` exists (end-to-end operate / backup / deploy runbook).
- [ ] AC5: `server/src/logger.ts` exists and references pino; structured transition logging
      references actor, from→to and evidence_ref.
- [ ] AC6: `server/src/http/server.ts` references graceful shutdown closing the DB
      (e.g. SIGTERM/SIGINT handler + `db.close()`) and basic input limits.
- [ ] AC7: A `deploy/` directory exists with a systemd unit and/or Dockerfile.
- [ ] AC8: A test exists asserting graceful shutdown closes the DB without corrupting the file
      (test file name references shutdown).

### Human / semantic (Judge + Human)
- [ ] AC9: README quickstart genuinely runs end-to-end on a clean machine (steps complete, no
      hidden prerequisites) — no tautology, assertions not deleted/skipped to pass.
- [ ] AC10: Graceful shutdown closes the DB without corrupting the file (verified by test/manual);
      no secrets appear in structured logs.
- [ ] AC11: UI accessibility AA passes (inherited from prototype) per Lighthouse; v1 limits
      respected (no TLS/RBAC/auto-merge added).

## Definition of Done
Mọi machine-verifiable AC pass dưới evidence mới sinh, Judge `VERDICT: PASS`, và human `.ai/scripts/gate.sh approve TASK-011`.

## Dependencies
TASK-009, TASK-010

## References
- docs/phases/P9.md
- docs/IMPLEMENTATION_PLAN.md (§5 P9, §7 cross-cutting, §10 out of scope)
- TASK_HUB_DESIGN.md §13 (giới hạn v1), §2 (LAN/single-user), §3 (auth, no log secret)
