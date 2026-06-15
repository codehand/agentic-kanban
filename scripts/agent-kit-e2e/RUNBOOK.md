# RUNBOOK — drive a task to DONE with the TASK-047 kit's 5 REAL role agents

This procedure exercises the **TASK-047 agent kit** (`examples/agent-kit/.claude/agents/aka-*.md`)
the way it is meant to be used: spawn the kit's **five real Claude Code role agents**
(`aka-implementer`, `aka-runner`, `aka-self-check`, `aka-judge`, `aka-human`) — each bound to
**only its own role bearer token** — to drive one fresh task through the whole
no-self-certification lifecycle, then confirm the invariants by reading the **real recorded
actors + token_ids** back with `verify-role-flow.mjs`.

It documents **AC4/AC5** (graded by the Judge + Human, not the headless gate). `selftest.sh`
proves the same flow deterministically with scripted MCP clients; this RUNBOOK proves the
**real kit agents** behave identically.

> Spawn the agents **directly** (one bearer each) — NOT via the `/aka-run` orchestrator. The
> orchestrator path is out of scope for this task; here we want each role agent driven on its
> own token so the per-edge actor and ≥5-distinct-token invariants are unambiguous.

---

## 0. Prerequisites

- `docker` on PATH and the daemon running.
- `node` on PATH and `pnpm install` already run in this checkout (the host-side MCP SDK client
  used by `verify-role-flow.mjs` needs `node_modules/@modelcontextprotocol/sdk`).
- This `scripts/agent-kit-e2e/` directory and `examples/agent-kit/.claude/` (the kit under test).

## 1. Build + run the hub container

```bash
export ADMIN_TOKEN="ak-real-$(date +%s)"        # the human bootstrap bearer
docker build -t agentic-kanban:agent-kit-e2e .
docker run -d --name agent-kit-e2e -p 3962:3000 \
  -e PORT=3000 -e ADMIN_TOKEN="$ADMIN_TOKEN" \
  -e DB_PATH=/data/tasks.db \
  -v "$PWD/.agent-kit-e2e/data:/data" \
  agentic-kanban:agent-kit-e2e
until curl -fsS http://127.0.0.1:3962/healthz >/dev/null; do sleep 0.3; done
export BASE_URL=http://127.0.0.1:3962
```

## 2. Create the project + mint one token per role

```bash
curl -fsS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"slug":"agent-kit","name":"agent kit e2e"}' \
  "$BASE_URL/api/projects"

# Mint one bearer per role (human bearer is the ADMIN_TOKEN itself). Either reuse
# the TASK-046 helper or POST /api/tokens directly:
BASE_URL="$BASE_URL" ADMIN_TOKEN="$ADMIN_TOKEN" \
  bash scripts/role-subagents-e2e/mint-role-tokens.sh
```

`mint-role-tokens.sh` prints five TSV lines `ROLE<TAB>TOKEN_ID<TAB>SECRET`:
`human`, `implementer`, `runner`, `self-check`, `judge`. **Hand exactly ONE secret to each role
agent** — never share a token between agents. Use `PROJECT=agent-kit` and `KEY=AK-REAL-1`.

## 3. Register the 5 role-scoped MCP servers (one bearer each)

Per `examples/agent-kit/README.md`, register one MCP server per role in the orchestrator session
so each kit agent's `mcp__taskhub-<role>__*` allowlist resolves to its own bearer. Use the hub's
`/mcp` endpoint (`http://host.docker.internal:3962/mcp` from inside Docker, or
`http://127.0.0.1:3962/mcp` from the host):

```bash
claude mcp add taskhub-impl      --transport http "$BASE_URL/mcp" --header "Authorization: Bearer <IMPLEMENTER-SECRET>"
claude mcp add taskhub-runner    --transport http "$BASE_URL/mcp" --header "Authorization: Bearer <RUNNER-SECRET>"
claude mcp add taskhub-selfcheck --transport http "$BASE_URL/mcp" --header "Authorization: Bearer <SELFCHECK-SECRET>"
claude mcp add taskhub-judge     --transport http "$BASE_URL/mcp" --header "Authorization: Bearer <JUDGE-SECRET>"
claude mcp add taskhub-human     --transport http "$BASE_URL/mcp" --header "Authorization: Bearer <HUMAN-SECRET>"
```

(If your client cannot register five servers in one session, use the per-clone `/loop` model in
the README instead — one clone per role, each registering its own `taskhub` server — but still
spawn the role *agents* directly, not `/aka-run`.)

## 4. Spawn the kit's 5 real role agents DIRECTLY

In the orchestrator session, spawn each kit agent by its `subagent_type`. The human agent acts
first (creates the task) and last (approves); the rest poll `task.get` and wait their turn. Give
each agent `project=agent-kit`, `key=AK-REAL-1`, and the instruction below — the kit agent defs
already encode the role's allowed tools and stage boundary.

1. **`subagent_type: aka-human`** — "Create task `AK-REAL-1` in project `agent-kit` with
   `allow_no_code_change:true`. Then wait until it reaches `JUDGE_PASSED` and `task.approve` it
   to `DONE`. Use only your `taskhub-human` tools." (The kit's `aka-human` normally merges git
   first; for this no-code-change demo there is no branch to merge — it just approves.)
2. **`subagent_type: aka-implementer`** — "Take `AK-REAL-1`: `task.claim`, then
   `TODO→IN_PROGRESS→IMPLEMENTED`. Use only your `taskhub-impl` tools." (The lease guard requires
   the claim before the forward transitions.)
3. **`subagent_type: aka-runner`** — "When `AK-REAL-1` is `IMPLEMENTED`, `evidence.submit`
   `{build_exit:0, test_exit:0, ac_exit:0, manifest_json:'{\"files\":[]}'}`. Submit only — never
   transition. Use only your `taskhub-runner` tool."
4. **`subagent_type: aka-self-check`** — "When `AK-REAL-1` is `IMPLEMENTED` and runner evidence
   exists, `task.selfcheck` it. Use only your `taskhub-selfcheck` tools; never edit code."
5. **`subagent_type: aka-judge`** — "When `AK-REAL-1` is `SELF_CHECK_PASSED`, add a
   `kind:verdict, verdict:PASS` comment then transition `SELF_CHECK_PASSED→JUDGE_PASSED`. Use only
   your `taskhub-judge` tools; never approve."

The agents coordinate **purely through server state** — no shared token, no out-of-band
signalling. Hand-off chain:

```
aka-human (create) → aka-implementer (claim + →IMPLEMENTED) → aka-runner (evidence) →
aka-self-check (→SELF_CHECK_PASSED) → aka-judge (verdict + →JUDGE_PASSED) → aka-human (approve → DONE)
```

## 5. Observe the role boundaries (AC5)

While observing, confirm the server enforces the kit's tool scoping: if `aka-implementer` or
`aka-runner` attempted `task.approve`, or `aka-judge` attempted it, the server rejects it (MCP
`isError`). Each agent's `tools:` allowlist already prevents it from *calling* another role's
tool; the bearer-role check is the second line of defense. The static side of this is what
`verify-kit-consistency.mjs` proves; the negative MCP attempts are also covered by
`scripts/verify-docker-features.sh`.

## 6. Verify the invariants on the real run

```bash
BASE_URL="$BASE_URL" TOKEN="$ADMIN_TOKEN" \
  PROJECT=agent-kit KEY=AK-REAL-1 \
  node scripts/agent-kit-e2e/verify-role-flow.mjs
```

This reads the real `timeline` / `comments` / `evidence` back from `GET /api/tasks/:key` and
asserts: final state `DONE`; each edge's `actor_role` matches
(`TODO→IN_PROGRESS`=implementer, `IMPLEMENTED→SELF_CHECK_PASSED`=self-check,
`SELF_CHECK_PASSED→JUDGE_PASSED`=judge, `JUDGE_PASSED→DONE`=human); a `verdict=PASS` comment from
the judge; the evidence row submitted by the runner; and **≥5 distinct `token_id`s** across the
recorded actions (no shared bearer). Exit 0 = **AC4/AC5 satisfied for the real kit run**.

## 7. Tear down

```bash
docker rm -f agent-kit-e2e && docker image rm -f agentic-kanban:agent-kit-e2e
rm -rf .agent-kit-e2e
```
