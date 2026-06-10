# TASK-007: P5: MCP server (tool surface over Streamable HTTP)

Repos: .
Branch: fix/TASK-007-p5-mcp-server

## Purpose
Let an agent connect over **MCP (Streamable HTTP)** and drive the full task lifecycle.
Every write tool routes through auth(role) + the gate/service layer — handlers never
write state themselves. This exposes the tool surface from TASK_HUB_DESIGN.md §6 on top
of the P2 auth, P3 gate, and P4 evidence/selfcheck logic.

## Scope

### In scope
- Mount a `@modelcontextprotocol/sdk` server with the **Streamable HTTP** transport into
  the process on `node:http` (NO web framework), at route `/mcp`, with bearer auth.
- Register tools (TASK_HUB_DESIGN.md §6) with **zod** input schemas:
  - *Read:* `project.list` / `project.create`, `task.list` / `task.get` / `task.next`,
    `comment.list`, `evidence.get`, `gitref.list`.
  - *Write:* `task.create` / `task.claim` / `task.heartbeat` / `task.release` /
    `task.transition`, `gitref.set`, `comment.add`, `evidence.submit`,
    `task.selfcheck`, `task.approve`.
- Each tool: validate input (zod) → auth(role) → call service (gate P3 / evidence P4 /
  repo P1) → map domain errors → MCP error.
- Modules: `server/src/mcp/server.ts` (SDK server + mount `/mcp`),
  `server/src/mcp/tools/*.ts` (per-tool registration + zod schema),
  `server/src/mcp/errors.ts` (domain error → MCP error mapping).

### Out of scope
- Full lease semantics (P6 details claim/heartbeat/expiry).
- The JSON read API + web UI (P7).
- Build/test execution and evidence scoring internals (owned by P4).

## Acceptance Criteria

### Machine-verifiable (chấm bởi TASK-007.ac.sh + gate; build/test/ac hard-required, 'na' nếu repo chưa có project)
- [ ] AC1: project builds (build.exit == 0) — lệnh từ .ai/config.yml (`pnpm build`). NOTE: build/test
      report 'na' until P0 (TASK-002) creates `package.json`; gate accepts 'na' for a project-less repo.
- [ ] AC2: tests pass (test.exit == 0) — `pnpm test` (vitest).
- [ ] AC3: `server/src/mcp/server.ts`, `server/src/mcp/errors.ts`, and a `server/src/mcp/tools/`
      directory exist.
- [ ] AC4: server code uses `@modelcontextprotocol/sdk` and a Streamable HTTP transport, mounts route
      `/mcp`, and references bearer auth — verified by grepping the mcp sources.
- [ ] AC5: server is built on `node:http` and pulls in NO web framework (no `express` / `fastify` /
      `koa` / `hapi` import in the mcp sources, and none added to `package.json` dependencies).
- [ ] AC6: tools use `zod` schemas — `zod` is imported in the tools directory.
- [ ] AC7: every read + write tool named in §6 is registered (each tool name string appears in the
      mcp sources): project.list, project.create, task.list, task.get, task.next, comment.list,
      evidence.get, gitref.list, task.create, task.claim, task.heartbeat, task.release,
      task.transition, gitref.set, comment.add, evidence.submit, task.selfcheck, task.approve.
- [ ] AC8: an integration test exists that connects an MCP SDK client over Streamable HTTP with a
      bearer token.
- [ ] AC9: an integration test drives the happy-path lifecycle
      `TODO → IN_PROGRESS → IMPLEMENTED → SELF_CHECK_PASSED → JUDGE_PASSED` through tools, with each
      role using its own token.
- [ ] AC10: an integration test asserts an `implementer` token calling `evidence.submit` returns a
      role error (runner-only enforced through the tool surface).

### Human / semantic (Judge + Human)
- [ ] AC11: tests are real — no tautologies, no skipped (`it.skip`) tests, no deleted assertions to pass.
- [ ] AC12: write handlers do NOT mutate state directly; they delegate to the gate (P3), evidence (P4),
      and repo (P1) services, with domain errors mapped to MCP errors per TASK_HUB_DESIGN.md §6.
- [ ] AC13: error/role paths are covered — wrong-role rejection and invalid input are surfaced as MCP
      errors, and `task.approve` is human-only / `evidence.submit` is runner-only, per §6/§3.

## Definition of Done
Mọi machine-verifiable AC pass dưới evidence mới sinh, Judge `VERDICT: PASS`, và human `.ai/scripts/gate.sh approve TASK-007`.

## Dependencies
TASK-006

## References
- docs/phases/P5.md
- docs/IMPLEMENTATION_PLAN.md (§5 P5, §2–§3 SDK + Streamable HTTP one-process, §9 no-framework decision)
- TASK_HUB_DESIGN.md §6 (MCP tool surface; evidence.submit runner-only, task.approve human-only), §2 (transport Streamable HTTP), §3 (auth & roles, token-per-role)
