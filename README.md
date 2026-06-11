# Agentic Kanban (aka-mcp)

A self-hosted **Task Hub** for AI agent workflows: a SQLite-backed server that
exposes an **MCP** endpoint (Streamable HTTP) plus a JSON API + live web UI, and
enforces a no-self-certification task state machine
(`TODO → IN_PROGRESS → IMPLEMENTED → SELF_CHECK_PASSED → JUDGE_PASSED → DONE`).

Single binary process, no external services — meant to run on a LAN for one
operator and a handful of agents.

---

## Quickstart (clean machine)

### Prerequisites
- **Node.js ≥ 20** and **pnpm ≥ 8** (`corepack enable` provides pnpm).
- A C toolchain for the native `better-sqlite3` binding (`python3`, `make`,
  `g++` / Xcode CLT). Not needed if you deploy via Docker (see below).

### Install, build, run
```bash
git clone <this-repo> && cd agentic-kanban
pnpm install
pnpm build                       # compiles TS -> dist/ and copies SQL migrations

# Start the server. ADMIN_TOKEN is bootstrapped into a single `human` token —
# use that exact value as your bearer everywhere.
ADMIN_TOKEN=change-me PORT=3000 DB_PATH=tasks.db pnpm start
```

`pnpm start` runs `node dist/index.js` — the production entry with graceful
shutdown (SIGTERM/SIGINT drain SSE clients, close the HTTP server, then the DB).

Verify it is up:
```bash
curl -s http://127.0.0.1:3000/healthz      # -> {"status":"ok"}
```

### Environment
| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | `3000` | HTTP port. |
| `DB_PATH` | `tasks.db` | SQLite database file (created on first run; use a path on a persistent volume in production). |
| `ADMIN_TOKEN` | _(unset)_ | Bootstrap secret → the one `human`/admin bearer token. Idempotent across restarts. If unset, bootstrap is skipped (only works once a human token already exists). |

### Sign in to the web UI
Open `http://127.0.0.1:3000/signin.html` and paste your `ADMIN_TOKEN` value as
the bearer. The board (`/index.html`) then shows projects/tasks live over SSE.

### Connect an MCP client
Register the running server with Claude Code (or any MCP client) over Streamable
HTTP at `/mcp`:
```bash
claude mcp add --transport http taskhub http://127.0.0.1:3000/mcp \
  --header "Authorization: Bearer change-me"
claude mcp list        # taskhub ✓ connected
```
See `docs/CONNECT_MCP.md` for the full tool surface.

### Mint a token per role
Permissions follow the **role** of the token (the server enforces them). The
`human` token (from `ADMIN_TOKEN`) can mint the others via the `token.mint` MCP
tool or `POST /api/tokens`:

| Role | Can do |
|------|--------|
| `human` | create/approve/reset/remove tasks, mint/revoke tokens, read all |
| `implementer` | claim, `TODO→IN_PROGRESS→IMPLEMENTED`, `gitref.set`, narrative comments |
| `self-check` | trigger `task.selfcheck`, `IMPLEMENTED→SELF_CHECK_*` |
| `judge` | `SELF_CHECK_PASSED→JUDGE_*`, verdict comments |
| `runner` | `evidence.submit` only |

```bash
# Mint a runner token via the JSON API (human bearer required):
curl -s -X POST http://127.0.0.1:3000/api/tokens \
  -H "Authorization: Bearer change-me" -H "Content-Type: application/json" \
  -d '{"role":"runner","label":"ci"}' | jq -r .secret
```
The `secret` is returned exactly once — store it.

---

## Docker setup

A multi-stage `Dockerfile` builds the TypeScript and the native `better-sqlite3`
binding **inside the image** (host `node_modules` are never copied). No secret
and no database are baked into any layer — both are provided at runtime.

```bash
# Build the image from clean source:
docker build -t agentic-kanban:latest .
```

Run with `docker compose` (recommended — wires the **required** host bind mounts
so data survives `docker restart` / recreate):
```bash
# data persists in ./data (DB) and ./logs (usage logs).
ADMIN_TOKEN=change-me PORT=3000 docker compose up -d
curl -s http://127.0.0.1:3000/healthz      # -> {"status":"ok"}
docker compose logs -f task-hub
```

Required bind mounts (see `docker-compose.yml`):
- `./data:/data` → `DB_PATH=/data/tasks.db`
- `./logs:/logs` → `USAGE_LOG_DIR=/logs`

`docker stop` sends SIGTERM → the container shuts down gracefully (SSE → HTTP →
DB). The image ships a `HEALTHCHECK` that hits `/healthz`.

Full runbook (native + Docker, volumes, backup, upgrade, safe restart):
**[`docs/DEPLOY.md`](docs/DEPLOY.md)**.

---

## Backup

Hot backup of the live SQLite database (safe while the server runs, via SQLite's
online backup API):
```bash
DB_PATH=tasks.db BACKUP_DIR=./backups scripts/backup-db.sh
# -> prints the backup file path; openable, point-in-time snapshot.
```

---

## The `.ai/` thin-client workflow

`.ai/` contains a portable, no-self-certification agent workflow (deterministic
gate + checksummed evidence). It runs locally by default and can **mirror every
step to this server** when `TASK_HUB_URL` + role tokens are set. Setup, env vars,
and the end-to-end proof (`scripts/e2e-thin-client.sh`) are documented in
**[`.ai/README.md`](.ai/README.md)**.

---

## Project layout
- `server/src/` — TypeScript source (`index.ts` entry, `http/`, `mcp/`, `api/`, `db/`, `auth/`, `domain/`).
- `design-system/` — static web UI assets served by the server.
- `scripts/` — `backup-db.sh`, `e2e-thin-client.sh`, dev/test helpers.
- `docs/` — `DEPLOY.md`, `CONNECT_MCP.md`, design + phase docs.
- `.ai/` — the agent workflow engine.
