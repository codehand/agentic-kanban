---
name: agentic-kanban
description: Use when connecting Claude Code (or any MCP client) to a running Agentic Kanban (aka-mcp) server and operating it — registering the /mcp Streamable HTTP endpoint with a bearer token, then creating projects/tasks and driving the no-self-certification lifecycle (claim → implement → evidence → self-check → judge → human approve) through MCP tools. Triggers: "connect to the kanban server", "connect aka-mcp", "create a task on the hub", "run the kanban lifecycle".
---

# Agentic Kanban — connect & operate via MCP

Agentic Kanban (**aka-mcp** for short) is a single Node process exposing three faces: MCP (`/mcp`, Streamable HTTP), a JSON
read/write API + SSE (`/api/*`), and the static web UI (`/`). Authority is enforced **server-side by the
role of the bearer token** — agents only *propose*; only the Gate writes state, only the Evidence service
writes evidence. This skill covers connecting an MCP client and running the lifecycle.

> Task creation is **MCP-only** in v1 — the web UI "New Task" button is not wired. Create tasks via the
> `task.create` tool below.

## 1. Make sure the server is running

Default port 3000. Entry point is `server/src/main.ts`.

```bash
pnpm install
pnpm build
# build does not copy SQL migrations into dist/ yet — copy them once:
mkdir -p dist/db/migrations && cp server/src/db/migrations/*.sql dist/db/migrations/
ADMIN_TOKEN=my-secret-token PORT=3000 DB_PATH=tasks.db node dist/main.js
```

Health check: `curl -s http://127.0.0.1:3000/healthz` → `{"status":"ok"}`.

`ADMIN_TOKEN` is bootstrapped into a single **`human`** token — use that value as the bearer below. It
also logs in the web UI at `http://127.0.0.1:3000/signin.html`.

## 2. Register the MCP server with Claude Code

```bash
claude mcp add --transport http taskhub http://127.0.0.1:3000/mcp \
  --header "Authorization: Bearer my-secret-token"
claude mcp list          # expect: taskhub ✓ connected
```

- `--transport http` = Streamable HTTP. Add `-s user` or `-s project` to change scope (default `local`).
- Inside a session, `/mcp` shows status + the tool list. Remove with `claude mcp remove taskhub`.
- **401** on calls → missing/invalid `Authorization: Bearer` header, or the token was revoked.

## 3. Roles — authority is the token's role

A token can only do what its role allows (server-enforced). Driving the full lifecycle needs several
tokens; mint extra ones with `token.mint` (human-only), then register each as its own MCP server (or swap
the bearer header) for that role.

| Role | Permitted |
|------|-----------|
| `human` | `task.create`, `task.approve` → DONE, reset/remove, mint/revoke tokens, read-all |
| `implementer` | `task.claim`, `TODO→IN_PROGRESS→IMPLEMENTED`, narrative comments, `gitref.set` |
| `self-check` | `task.selfcheck`, `IMPLEMENTED→SELF_CHECK_*` |
| `judge` | `SELF_CHECK_PASSED→JUDGE_*`, verdict comments |
| `runner` | `evidence.submit` only |

## 4. Tools (shown in Claude Code as `mcp__taskhub__<name>`)

- **Read:** `project.list` · `project.create` · `task.list` · `task.get` · `task.next` · `comment.list` ·
  `evidence.get` · `gitref.list`
- **Write:** `task.create` · `task.claim` · `task.heartbeat` · `task.release` · `task.transition` ·
  `gitref.set` · `comment.add` · `evidence.submit` · `task.selfcheck` · `task.approve`

## 5. Common flows

**Create a project + task** (human token):
```
project.create { slug: "demo", name: "Demo Project" }
task.create    { project: "demo", key: "TASK-001", title: "First task", body_md: "## Spec\n..." }
task.list      { project: "demo" }
```

**No-self-certification lifecycle** (each step needs the matching role's token):
```
implementer:  task.claim → task.transition TODO→IN_PROGRESS → gitref.set → task.transition →IMPLEMENTED
runner:       evidence.submit
self-check:   task.selfcheck            (Gate sets SELF_CHECK_PASSED/FAILED)
judge:        comment.add(kind=verdict) → task.transition →JUDGE_PASSED/JUDGE_REJECTED
human:        task.approve              (JUDGE_PASSED → DONE; does NOT merge MRs)
```

Watch progress live on the web UI board (`/`) — it updates via SSE.

## Reference

Full guide with troubleshooting: [`docs/CONNECT_MCP.md`](../../../docs/CONNECT_MCP.md).
Design source of truth: `TASK_HUB_DESIGN.md` (§2 architecture, §3 roles, §5 state machine, §6 tools).
