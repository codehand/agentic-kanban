# RUNBOOK — 5 real Claude subagents drive a task to DONE (one role + one token each)

This procedure spawns **five real Claude Code subagents**, each holding **only its
own bearer token**, to drive one task through the full no-self-certification
lifecycle against the Dockerized server — exactly what `selftest.sh` proves
deterministically with scripted MCP clients. It documents AC4/AC5 (graded by the
Judge and Human, not the headless gate).

The point being demonstrated: role-scoped agents coordinate **purely through the
server** (no shared token, no out-of-band signalling), the server's role +
state-gating enforce the hand-offs, and only the `human` subagent can reach
`DONE`. The invariants are confirmed afterwards by `verify-role-flow.mjs`, which
reads the **real recorded actors + token_ids** back — not the agents' claims.

---

## 0. Prerequisites

- `docker` on PATH and the daemon running.
- `node` on PATH and `pnpm install` already run in this checkout (the host-side
  MCP SDK clients need `node_modules/@modelcontextprotocol/sdk`).
- This `scripts/role-subagents-e2e/` directory.

## 1. Build + run the container

```bash
docker build -t agentic-kanban:role-e2e .
docker run -d --name role-e2e -p 3961:3000 \
  -e PORT=3000 -e ADMIN_TOKEN="$ADMIN_TOKEN" \
  -e DB_PATH=/data/tasks.db \
  -v "$PWD/.role-e2e/data:/data" \
  agentic-kanban:role-e2e
# wait for health
until curl -fsS http://127.0.0.1:3961/healthz >/dev/null; do sleep 0.3; done
```

Set a fresh secret first, e.g. `ADMIN_TOKEN="role-e2e-$(date +%s)"`. This is the
**human** bootstrap bearer. `BASE_URL=http://127.0.0.1:3961`.

## 2. Create the project + mint one token per role

```bash
curl -fsS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"slug":"role-e2e","name":"role subagents e2e"}' \
  http://127.0.0.1:3961/api/projects

BASE_URL=http://127.0.0.1:3961 ADMIN_TOKEN="$ADMIN_TOKEN" \
  bash scripts/role-subagents-e2e/mint-role-tokens.sh
```

`mint-role-tokens.sh` prints five TSV lines `ROLE<TAB>TOKEN_ID<TAB>SECRET`:
`human`, `implementer`, `runner`, `self-check`, `judge`. **Hand exactly ONE
secret to each subagent** — never share a token between subagents.

Use `PROJECT=role-e2e` and pick a task key, e.g. `KEY=RS-REAL-1`.

## 3. Spawn the 5 role-subagents

Spawn five subagents. Give each one (a) its role name, (b) its bearer SECRET,
(c) `BASE_URL`, `PROJECT`, `KEY`, and (d) the connection recipe:

> Connect an MCP Streamable HTTP client to `${BASE_URL}/mcp` with header
> `Authorization: Bearer <YOUR-SECRET>`. You may call ONLY the MCP tools listed
> for your role. Do not use any other token. Coordinate by polling `task.get`;
> never signal other agents out of band.

### human subagent (acts first AND last)
> You are the **human**. Token: `<HUMAN-SECRET>`.
> 1. Call `task.create` `{project, key, title, allow_no_code_change: true}` to
>    create the task in `TODO`. (`allow_no_code_change` lets the IMPLEMENTED
>    guard pass without git refs.)
> 2. Then POLL `task.get` until `state == "JUDGE_PASSED"`. Only then call
>    `task.approve` `{project, key}` to reach `DONE`. Do not approve earlier.
> Allowed tools: `task.create`, `task.get`, `task.approve`.

### implementer subagent
> You are the **implementer**. Token: `<IMPLEMENTER-SECRET>`.
> POLL `task.get` until `state == "TODO"`. Then:
> 1. `task.claim` `{project, key}` (the gate's lease guard requires you to hold
>    the lease before any forward transition).
> 2. `task.transition` `{from:"TODO", to:"IN_PROGRESS"}`.
> 3. `task.transition` `{from:"IN_PROGRESS", to:"IMPLEMENTED"}`.
> Do NOT submit evidence and do NOT approve — those are other roles.
> Allowed tools: `task.get`, `task.claim`, `task.transition`.

### runner subagent
> You are the **runner**. Token: `<RUNNER-SECRET>`.
> POLL `task.get` until `state == "IMPLEMENTED"`. Then call `evidence.submit`
> `{project, key, build_exit:0, test_exit:0, ac_exit:0, manifest_json:"{\"files\":[]}"}`.
> You ONLY submit evidence — you never transition the task and never approve.
> Allowed tools: `task.get`, `evidence.submit`.

### self-check subagent (waits its turn)
> You are the **self-check**. Token: `<SELFCHECK-SECRET>`.
> POLL `task.get` until `state == "IMPLEMENTED"` AND evidence exists
> (`evidence.get` returns a row). Only then call `task.selfcheck`
> `{project, key}`, which re-verifies evidence and advances to
> `SELF_CHECK_PASSED`. Do not act before it is your turn.
> Allowed tools: `task.get`, `evidence.get`, `task.selfcheck`.

### judge subagent (waits its turn)
> You are the **judge**. Token: `<JUDGE-SECRET>`.
> POLL `task.get` until `state == "SELF_CHECK_PASSED"`. Then:
> 1. `comment.add` `{project, key, kind:"verdict", verdict:"PASS", body_md:"VERDICT: PASS"}`
>    (the gate requires a verdict=PASS comment before `JUDGE_PASSED`).
> 2. `task.transition` `{from:"SELF_CHECK_PASSED", to:"JUDGE_PASSED"}`.
> You may NOT approve to DONE — that is the human's sole authority.
> Allowed tools: `task.get`, `comment.add`, `task.transition`.

## 4. Observe the coordination

The agents hand off purely through server state:
`human creates → implementer claims + drives to IMPLEMENTED → runner submits
evidence → self-check (waited) → SELF_CHECK_PASSED → judge (waited) verdict +
→ JUDGE_PASSED → human (waited) approve → DONE`.

Confirm along the way (AC5) that role boundaries hold: if the implementer or
runner attempts `task.approve`, or the judge attempts `task.approve`, the server
**rejects** it (MCP `isError`). Those negative attempts are also covered
deterministically by `verify-docker-features.sh`.

## 5. Verify the invariants on the real run

```bash
BASE_URL=http://127.0.0.1:3961 TOKEN="$ADMIN_TOKEN" \
  PROJECT=role-e2e KEY=RS-REAL-1 \
  node scripts/role-subagents-e2e/verify-role-flow.mjs
```

This reads the real `timeline` / `comments` / `evidence` back from
`GET /api/tasks/:key` and asserts: final state `DONE`; each edge's `actor_role`
matches (`TODO→IN_PROGRESS`=implementer, `IMPLEMENTED→SELF_CHECK_PASSED`=self-check,
`SELF_CHECK_PASSED→JUDGE_PASSED`=judge, `JUDGE_PASSED→DONE`=human); a
`verdict=PASS` comment from the judge; the evidence row submitted by the runner;
and **≥5 distinct `token_id`s** across the recorded actions (no shared bearer).
Exit 0 = AC4/AC5 satisfied for the real run.

## 6. Tear down

```bash
docker rm -f role-e2e && docker image rm -f agentic-kanban:role-e2e
rm -rf .role-e2e
```
