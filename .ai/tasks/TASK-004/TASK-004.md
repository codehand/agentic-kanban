# TASK-004: P2: Auth and roles (token per role)

Repos: .
Branch: fix/TASK-004-p2-auth-roles

## Purpose
Build the central anti-self-certify layer: a permission == the token's role, enforced server-side. Every
tool-call whose role lacks the permission is rejected. Tokens are stored as hash only; the secret is
returned exactly once at mint time. This is the trust foundation that later phases (gate transitions,
MCP tools, API) rely on. (From P2 Mục tiêu, TASK_HUB_DESIGN.md §3.)

## Scope

### In scope
- Bearer parse middleware on `node:http` that resolves `{role, project_scope, token_id}` from the
  secret hash.
- Bootstrap from `ADMIN_TOKEN` (env/config) creating exactly one `human` token, idempotent across runs.
- `token.mint(role, project?)` returning the secret once, persisting only `SHA-256 + salt`;
  `token.revoke`.
- `authorize(role, action)` helper mapping role -> permission per the table in TASK_HUB_DESIGN.md §3
  (5 roles: `human`, `implementer`, `self-check`, `judge`, `runner`).
- Constant-time hash comparison; never log secrets (incl. error paths) per IMPLEMENTATION_PLAN.md §7.

### Out of scope
- Using `authorize` inside gate transitions (P3), inside MCP tools (P5), inside HTTP API (P7).
- TLS / multi-human RBAC (out of v1).

## Acceptance Criteria

### Machine-verifiable
> build/test may be 'na' until P0 creates package.json; ac.sh asserts the concrete artifacts below.
- [ ] AC1: auth modules exist: `server/src/auth/parse.ts`, `resolve.ts`, `authorize.ts`,
  `bootstrap.ts`, `mint.ts`.
- [ ] AC2: secrets stored as hash only — `mint.ts` references SHA-256 + salt; the token row uses a
  `secret_hash` column (no plaintext secret persisted).
- [ ] AC3: bootstrap reads `ADMIN_TOKEN` and creates a `human` token idempotently (re-run does not
  duplicate) — covered by a test.
- [ ] AC4: missing / invalid / revoked token is rejected with 401/403 — covered by a test.
- [ ] AC5: `authorize` enforces the §3 table — `runner` cannot transition; `implementer` cannot
  approve or perform JUDGE_* — covered by a test.
- [ ] AC6: when a package.json exists, `pnpm build` (build.exit==0) and `pnpm test` (test.exit==0)
  pass; otherwise build/test are 'na'.

### Human / semantic (Judge + Human)
- [ ] AC7: tests are real (no skips, no deleted assertions, no tautological checks) and exercise the
  reject paths (401/403, role-denied) not just happy paths.
- [ ] AC8: constant-time comparison is genuinely used for hash compare and no code path logs the
  secret (including error handlers), per IMPLEMENTATION_PLAN.md §7.
- [ ] AC9: role->permission mapping matches TASK_HUB_DESIGN.md §3 exactly; no invented permissions
  beyond the design table.

## Definition of Done
Every machine-verifiable AC passes under freshly generated evidence, Judge `VERDICT: PASS`, and human
`.ai/scripts/gate.sh approve TASK-004`.

## Dependencies
TASK-003 (P1: data model / `token` table).

## References
- docs/phases/P2.md
- docs/IMPLEMENTATION_PLAN.md (§5 P2, §7 security, §3 token hashing)
- TASK_HUB_DESIGN.md §3 (auth & roles, role->permission table, ADMIN_TOKEN bootstrap), §1.3 (role =
  separated permission), §4 (`token` row)
