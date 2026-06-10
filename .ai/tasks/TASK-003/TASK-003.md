# TASK-003: P1: Data layer (SQLite schema and repositories)

Repos: .
Branch: fix/TASK-003-p1-data-layer

## Purpose
Provide persistence faithful to the data model in `TASK_HUB_DESIGN.md` §4: 7 tables, append-only for
`evidence`/`transition`, and typed repository functions. This is the data foundation for the gate (P3)
and evidence (P4).

## Scope

### In scope
- Numbered SQL migration + a small idempotent runner that creates the **7 tables**:
  `project, task, transition, comment, evidence, gitref, token` with the exact columns from
  `TASK_HUB_DESIGN.md` §4.
- Typed repository functions per table (insert/select; `gitref` also updates `head_sha`/`mr_url`).
- **Append-only** for `evidence` and `transition`: block UPDATE/DELETE via **SQLite triggers** plus a
  guard at the repository layer (defense-in-depth, `IMPLEMENTATION_PLAN.md` §7).
- Indexes on `task.project_id` and `task.state`.

### Out of scope
- Transition business rules (P3), auth resolve (P2), checksum verify (P4).

## Acceptance Criteria

### Machine-verifiable (chấm bởi TASK-003.ac.sh + gate)
> build/test run via `.ai/config.yml` (`pnpm build`/`pnpm test`) once P0 has created `package.json`;
> they report `na` only if no project exists yet. The `.ac.sh` also checks the artifacts directly.
- [ ] AC1: `server/src/db/migrations/0001_init.sql` exists and defines all 7 tables
  (`project, task, transition, comment, evidence, gitref, token`).
- [ ] AC2: the migration declares triggers blocking UPDATE/DELETE on `evidence` and on `transition`,
  and indexes on `task(project_id)` and `task(state)`.
- [ ] AC3: `server/src/db/connection.ts` (better-sqlite3 + pragma) and `server/src/db/migrate.ts`
  (idempotent runner) exist.
- [ ] AC4: a repository module exists for each of the 7 tables under `server/src/db/repositories/`.
- [ ] AC5: tests exist under `server/test` covering migration idempotency, basic CRUD, and rejection of
  UPDATE/DELETE on `evidence`/`transition`.

### Human / semantic (Judge + Human)
- [ ] AC6: columns/types/nullability of all 7 tables match `TASK_HUB_DESIGN.md` §4 exactly (e.g.
  `task.key` unique-per-project, `evidence.submitted_by_token_id` runner role, `gitref` multi-row per
  task); no invented columns.
- [ ] AC7: append-only is real — a test actually attempts an UPDATE and a DELETE on `evidence` and
  `transition` and asserts they are rejected; the repo-layer guard is not a no-op; no tautological test.
- [ ] AC8: migration runner is genuinely idempotent (re-run does not error or duplicate); `manifest_json`
  / `logs_json` are TEXT JSON sized for P4 checksum verify without embedding full logs (§4 comment).

## Definition of Done
All machine-verifiable AC pass under freshly generated evidence, Judge `VERDICT: PASS`, and human
`.ai/scripts/gate.sh approve TASK-003`.

## Dependencies
TASK-002 (P0: toolchain + db connection foundation).

## References
- docs/phases/P1.md (content source of truth)
- docs/IMPLEMENTATION_PLAN.md §5 (P1), §7 (defense-in-depth: triggers + checksum)
- TASK_HUB_DESIGN.md §4 (data model: project/task/transition/comment/evidence/gitref/token; append-only evidence/transition; gitref updatable), §7.3
