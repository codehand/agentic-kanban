# Deployment runbook — Agentic Kanban (aka-mcp)

Operator-focused runbook for running aka-mcp on a LAN for one operator + a few
agents. Two supported deployments: **native** (Node directly) and **Docker**.
Both run the same production entry (`dist/index.js`) with graceful shutdown.

---

## 0. Concepts

- **State lives in one SQLite file** (`DB_PATH`). Back it up and persist it; lose
  it and you lose all projects/tasks/evidence.
- **`ADMIN_TOKEN`** is bootstrapped into the single `human`/admin bearer token
  (idempotent across restarts). Treat it as a secret; never bake it into an
  image or commit it.
- **Graceful shutdown**: on SIGTERM/SIGINT the server closes SSE clients, stops
  the HTTP server (draining in-flight requests), then closes the DB, and exits 0.

### Environment variables
| Var | Default | Notes |
|-----|---------|-------|
| `PORT` | `3000` | HTTP port. |
| `DB_PATH` | `tasks.db` | SQLite file. **Put on a persistent path/volume.** |
| `ADMIN_TOKEN` | _(unset)_ | Bootstrap secret for the human token. |
| `USAGE_LOG_DIR` | _(unset)_ | Directory for usage logs (TASK-028). Mount it in Docker. |

---

## 1. Native deployment

```bash
# Prereqs: Node >= 20, pnpm >= 8, and a C toolchain (python3/make/g++) for
# the native better-sqlite3 binding.
git clone <repo> /opt/agentic-kanban && cd /opt/agentic-kanban
pnpm install
pnpm build

# Run (foreground). Choose a persistent DB_PATH.
ADMIN_TOKEN=change-me PORT=3000 DB_PATH=/var/lib/aka/tasks.db pnpm start
```

Health check: `curl -s http://127.0.0.1:3000/healthz` → `{"status":"ok"}`.

### Optional: run under systemd
`/etc/systemd/system/aka-mcp.service`:
```ini
[Unit]
Description=Agentic Kanban (aka-mcp) Task Hub
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/agentic-kanban
Environment=PORT=3000
Environment=DB_PATH=/var/lib/aka/tasks.db
# Keep the secret out of the unit file; use an env file with 0600 perms:
EnvironmentFile=/etc/aka-mcp.env          # contains ADMIN_TOKEN=...
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
# systemd sends SIGTERM on stop -> graceful shutdown.
KillSignal=SIGTERM
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now aka-mcp
sudo systemctl status aka-mcp
```

---

## 2. Docker deployment

The image builds TS + the native binding inside itself; host artifacts are never
copied (see `.dockerignore`). No secret/DB is baked into any layer.

```bash
docker build -t agentic-kanban:latest .
```

### Run with docker compose (recommended)
`docker-compose.yml` declares the **required** host bind mounts so a restart or
recreate never loses data:

| Host path | Container path | Holds |
|-----------|----------------|-------|
| `./data` | `/data` | SQLite DB (`DB_PATH=/data/tasks.db`) |
| `./logs` | `/logs` | usage logs (`USAGE_LOG_DIR=/logs`) |

```bash
mkdir -p data logs
ADMIN_TOKEN=change-me PORT=3000 docker compose up -d
docker compose ps
curl -s http://127.0.0.1:3000/healthz       # -> {"status":"ok"}
docker compose logs -f task-hub
```

### Plain docker run (equivalent)
```bash
docker run -d --name aka-mcp \
  -p 3000:3000 \
  -e ADMIN_TOKEN=change-me -e PORT=3000 \
  -e DB_PATH=/data/tasks.db -e USAGE_LOG_DIR=/logs \
  -v "$PWD/data:/data" -v "$PWD/logs:/logs" \
  --stop-signal=SIGTERM --stop-timeout=10 \
  agentic-kanban:latest
```

`docker stop aka-mcp` → SIGTERM → graceful shutdown → exit 0.

---

## 3. Backup

The database can be backed up safely **while the server is running** (SQLite
online backup API):
```bash
# Native:
DB_PATH=/var/lib/aka/tasks.db BACKUP_DIR=/var/backups/aka scripts/backup-db.sh

# Docker (DB lives in ./data on the host — back it up from the host):
DB_PATH=./data/tasks.db BACKUP_DIR=./backups scripts/backup-db.sh
```
The script prints the path of a timestamped, openable, non-empty snapshot.
Schedule it from cron/systemd-timer as desired (out of scope here). To restore,
stop the server and copy a snapshot over `DB_PATH`.

---

## 4. Upgrade

```bash
# Native:
sudo systemctl stop aka-mcp            # graceful SIGTERM
git pull && pnpm install && pnpm build # migrations run automatically on next start
sudo systemctl start aka-mcp

# Docker:
docker compose down                    # graceful SIGTERM
git pull
docker compose build
docker compose up -d
```
Migrations are idempotent and applied on startup. **Take a backup (section 3)
before upgrading.**

---

## 5. Safe restart

Always stop via SIGTERM (systemd `stop`, `docker stop`, or `docker compose
down`) so the server drains SSE clients and closes the DB cleanly. Avoid `kill
-9` / `docker kill`, which skip the graceful path. After restart, confirm
`/healthz` returns `{"status":"ok"}` and the web UI lists your tasks.
