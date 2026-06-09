# TASK-002: P0: Scaffold and toolchain

Repos: .
Branch: fix/TASK-002-p0-scaffold-toolchain

## Purpose
Make the project build / test / boot on the locked stack and able to run its own tasks through the
repo's workflow gate. Lay the foundation (tooling + directory structure + config loader + health
endpoint) so the core phases P1–P4 can stand on it without touching the toolchain. No business rule
lives in P0.

## Scope

### In scope
- Init **pnpm** workspace + `tsconfig` (ESM, Node ≥ 20) + eslint/prettier + **vitest**.
- Directory structure `server/src` per `IMPLEMENTATION_PLAN.md` §3:
  `config/ db/ auth/ domain/ mcp/ api/ http/` + `server/test/`.
- Config loader: env `PORT`, `ADMIN_TOKEN`, `DB_PATH`; file `config.yml` (check modes/thresholds, lease TTL).
- Logger **pino** (structured); never logs secrets.
- `GET /healthz` on **`node:http`** (no web framework) → `200 {"status":"ok"}`.
- Adapt engine `.ai/`: `config.yml` (`commands.build`→`pnpm build`, `commands.test`→`pnpm test`);
  `run-evidence.sh` runs Node build/test + coverage via `vitest --coverage`, writes `*.exit` +
  `manifest.json`, keeps the `AI_WT_<REPO>` export contract.

### Out of scope
- Data layer (P1), auth (P2), gate/state machine (P3), MCP/API (P5+).

## Acceptance Criteria

### Machine-verifiable (chấm bởi TASK-002.ac.sh + gate)
> This task creates the root `package.json`, so after it `run-evidence.sh` runs real `pnpm build`/
> `pnpm test`; before that build/test report `na`. The `.ac.sh` checks the scaffold artifacts directly.
- [ ] AC1: `package.json` at repo root has `build` and `test` scripts; `tsconfig.json` exists with an
  ESM `module` setting; a `vitest.config.{ts,mts,js}` exists.
- [ ] AC2: directory tree `server/src/{config,db,auth,domain,mcp,api,http}` and `server/test` all exist.
- [ ] AC3: config loader `server/src/config/index.ts` exists and references env `PORT`, `ADMIN_TOKEN`,
  `DB_PATH` and `config.yml`.
- [ ] AC4: `server/src/logger.ts` references `pino`; `server/src/http/server.ts` uses `node:http`,
  references `/healthz`, and emits `status: ok`.
- [ ] AC5: `.ai/config.yml` maps build→`pnpm build` and test→`pnpm test`.
- [ ] AC6: a `/healthz` smoke test exists under `server/test` (vitest).

### Human / semantic (Judge + Human)
- [ ] AC7: server boots on `node:http` with no web framework (no express/fastify/koa dependency);
  `/healthz` actually returns `200 {"status":"ok"}` (not a stubbed string), no tautological test.
- [ ] AC8: logger never emits secrets (`ADMIN_TOKEN`/token values); config loader handles missing env
  / missing `config.yml` sanely (error path covered).
- [ ] AC9: stack & structure follow `TASK_HUB_DESIGN.md` §2 and `IMPLEMENTATION_PLAN.md` §3
  (ESM, Node ≥ 20, pnpm, vitest, pino, single process); no extra unrequested abstractions.

## Definition of Done
All machine-verifiable AC pass under freshly generated evidence, Judge `VERDICT: PASS`, and human
`.ai/scripts/gate.sh approve TASK-002`.

## Dependencies
none — foundation phase, depends on no other phase.

## References
- docs/phases/P0.md (content source of truth)
- docs/IMPLEMENTATION_PLAN.md §3 (tech stack & directory structure), §4.5 (use the repo's own workflow to build the server)
- TASK_HUB_DESIGN.md §2 (scope, stack, single-process)
