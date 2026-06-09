# TASK-010: P8: Integrate .ai engine as thin client

Repos: .
Branch: fix/TASK-010-p8-ai-thin-client

## Purpose
Make the familiar `.ai/` CLI (`gate.sh` / `run-evidence.sh` / `new-task.sh`) run against
the Task Hub server instead of writing local files: turn each script into a thin client that
calls the corresponding MCP tool, per TASK_HUB_DESIGN.md §12. This is done only after the
standalone server (P0–P7) is complete, so humans keep their existing CLI while state, evidence
and task creation flow through the authoritative server.

## Scope
- In scope:
  - `gate.sh propose` → calls MCP `task.transition` on the server.
  - `gate.sh selfcheck` → calls MCP `task.selfcheck`; `gate.sh approve` → calls MCP `task.approve`.
  - `run-evidence.sh` still builds/tests **locally inside the worktree** but `evidence.submit`s
    the result to the server using a **runner** token (instead of writing `.ai/evidence/*` locally).
  - `new-task.sh` / `/newtask` → calls MCP `task.create` on the server.
  - Map local worktree/gitref → `gitref.set` on the server (branch / base / head / MR URL), for
    single-repo and multi-repo flows.
  - Keep an optional file fallback for offline use.
  - A small MCP/HTTP client helper invoked by the scripts, sending the bearer token for the role.
- Out of scope:
  - Changing the state machine or transition table (server-side, unchanged here).
  - Calling git host APIs / auto-merging MRs (TASK_HUB_DESIGN.md §10, IMPLEMENTATION_PLAN.md §10).
  - Implementing the server tools themselves (delivered by P5/P6).

## Acceptance Criteria

### Machine-verifiable (chấm bởi TASK-010.ac.sh + gate; build/test/ac hard-required, 'na' nếu repo chưa có project)
- [ ] AC1: project builds (build.exit == 0) — lệnh từ .ai/config.yml (mặc định `pnpm build`).
- [ ] AC2: tests pass (test.exit == 0) — mặc định `pnpm test` (vitest).
- [ ] AC3: A reusable MCP/HTTP client helper exists under `.ai/scripts/` (e.g. `mcp-client.sh`
      or equivalent), referencing a server base URL and a bearer token from the environment.
- [ ] AC4: `gate.sh` references the server client for `propose`/`selfcheck`/`approve` and maps
      them to MCP tools `task.transition`, `task.selfcheck`, `task.approve` (grep finds all three
      tool names plus the three subcommands).
- [ ] AC5: `run-evidence.sh` references `evidence.submit` and a runner token (grep finds the
      `evidence.submit` tool name and a runner-token env var) and still runs build/test locally.
- [ ] AC6: `new-task.sh` references the `task.create` tool.
- [ ] AC7: `gitref.set` is referenced from the engine scripts/client for mapping local gitref.
- [ ] AC8: An integration test exists (e.g. under `server/test/`) exercising the thin-client →
      server path (test file name references the engine/thin-client integration).

### Human / semantic (Judge + Human)
- [ ] AC9: `gate.sh propose` actually drives exactly one transition on the server (no local-only
      state write that bypasses the gate); behaviour matches TASK_HUB_DESIGN.md §12 — no tautology,
      assertions not deleted/skipped to pass.
- [ ] AC10: `run-evidence.sh` submits evidence under the runner role and the server records it;
      the runner token is distinct from implementer credentials (evidence/agent separation per §7).
- [ ] AC11: Single-repo and multi-repo worktree flows still work end-to-end against the server,
      including gitref mapping (branch push remote, head>base per §13 risk note).

## Definition of Done
Mọi machine-verifiable AC pass dưới evidence mới sinh, Judge `VERDICT: PASS`, và human `.ai/scripts/gate.sh approve TASK-010`.

## Dependencies
TASK-007, TASK-008

## References
- docs/phases/P8.md
- docs/IMPLEMENTATION_PLAN.md (§5 P8, §1, §4.1)
- TASK_HUB_DESIGN.md §12 (tích hợp `.ai/` thin client)
- TASK_HUB_DESIGN.md §7 (evidence runner-only), §10 (git/MR multi-repo), §4 (`gitref`), §1.5 & §13 (giới hạn)
