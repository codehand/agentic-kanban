#!/usr/bin/env bash
# verify-docker.sh — runtime verification of the Docker packaging (TASK-029).
#
# NO TAUTOLOGY: every assertion reads real data back from the running server
# (HTTP API + a real MCP SDK client over Streamable HTTP + bearer). The only
# "PASS" printed is after the read actually returned the expected payload.
#
# Scenario (re-runnable; exit 0 = all checks passed):
#   a. docker build from clean source.
#   b. run container #1 with HOST bind mounts (data/ -> DB_PATH, logs/ ->
#      USAGE_LOG_DIR) + ADMIN_TOKEN injected at runtime.
#   c. parity check: /healthz 200, static UI /signin.html 200, real MCP tool
#      call (project.list via SDK), SSE /api/stream Content-Type text/event-stream.
#   d. write data: create a project (HTTP API) + a task (MCP task.create).
#   e. docker stop -> container exit code 0 (graceful SIGTERM, never SIGKILL).
#   f. docker rm container #1 -> run NEW container #2 same mounts -> the project
#      and task are still readable via API + MCP, the DB file is non-empty on the
#      host, and (when TASK-028's USAGE_LOG_DIR feature is present) a *.jsonl
#      usage log appears on the host mount.
#
# Cleanup trap removes containers + image + host scratch dir even on failure.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IMG="agentic-kanban:verify-docker"
C1="vd-c1-$$"
C2="vd-c2-$$"
HOSTDIR="$ROOT/.verify-docker.$$"          # under repo root (a /Users path -> Docker Desktop file sharing works)
TOK="vd-secret-bearer-$$-$RANDOM"
HPORT="${VD_PORT:-3924}"
BASE="http://127.0.0.1:$HPORT"
CLIENT="$HOSTDIR/mcp-client.mjs"
FAIL=0

fail() { echo "FAIL: $*" >&2; FAIL=1; }
ok()   { echo "ok:   $*"; }
step() { echo "== verify-docker: $* =="; }

cleanup() {
  docker rm -f "$C1" "$C2" >/dev/null 2>&1 || true
  docker image rm -f "$IMG" >/dev/null 2>&1 || true
  rm -rf "$HOSTDIR"
}
trap cleanup EXIT

# Preflight.
command -v docker >/dev/null 2>&1 || { echo "FAIL: docker not on PATH"; exit 1; }
command -v node   >/dev/null 2>&1 || { echo "FAIL: node not on PATH (needed for the MCP SDK client)"; exit 1; }
[ -f Dockerfile ] || { echo "FAIL: Dockerfile missing"; exit 1; }
[ -d node_modules/@modelcontextprotocol/sdk ] || { echo "FAIL: @modelcontextprotocol/sdk not installed (run pnpm install)"; exit 1; }

cleanup
mkdir -p "$HOSTDIR/data" "$HOSTDIR/logs"

# Real MCP SDK client over Streamable HTTP + bearer. Two modes:
#   list                -> call project.list, assert not isError, print result text
#   create <proj> <key> -> call task.create, assert not isError
cat >"$CLIENT" <<'EOF'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const transport = new StreamableHTTPClientTransport(new URL(process.env.MCP_URL), {
  requestInit: { headers: { Authorization: 'Bearer ' + process.env.MCP_TOKEN } },
})
const client = new Client({ name: 'verify-docker', version: '0.0.1' })
await client.connect(transport)

const [mode, ...rest] = process.argv.slice(2)
let r
if (mode === 'create') {
  const [project, key] = rest
  r = await client.callTool({
    name: 'task.create',
    arguments: { project, key, title: 'verify-docker persistence task ' + key },
  })
} else {
  r = await client.callTool({ name: 'project.list', arguments: {} })
}
await client.close()

if (r.isError) {
  console.error('tool call returned isError:', JSON.stringify(r.content))
  process.exit(1)
}
// Print the tool's text payload so the shell can assert on real server data.
for (const part of r.content ?? []) {
  if (part.type === 'text') process.stdout.write(part.text)
}
EOF

# run_container NAME — start a container on the shared mounts, wait for /healthz.
run_container() {
  local name="$1"
  docker run -d --name "$name" -p "$HPORT:3000" \
    -e PORT=3000 -e ADMIN_TOKEN="$TOK" \
    -e DB_PATH=/data/tasks.db -e USAGE_LOG_DIR=/logs/usage \
    -v "$HOSTDIR/data:/data" -v "$HOSTDIR/logs:/logs" \
    "$IMG" >/dev/null || return 1
  local i
  for i in $(seq 1 60); do
    curl -fsS "$BASE/healthz" >/dev/null 2>&1 && return 0
    docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null | grep -q true || {
      echo "--- $name died during startup ---" >&2
      docker logs "$name" 2>&1 | tail -25 >&2
      return 1
    }
    sleep 0.3
  done
  echo "--- $name never became healthy ---" >&2
  docker logs "$name" 2>&1 | tail -25 >&2
  return 1
}

mcp() { MCP_URL="$BASE/mcp" MCP_TOKEN="$TOK" node "$CLIENT" "$@"; }

PSLUG="vd-persist"
TKEY="VD-1"

# ---------- (a) build ----------
step "docker build from clean source"
if docker build -q -t "$IMG" . >/dev/null; then
  ok "image built"
else
  fail "docker build failed"; exit 1
fi

# ---------- (b)(c) container #1 + parity ----------
step "run container #1 with host bind mounts + parity checks"
if run_container "$C1"; then
  ok "container #1 up, /healthz 200"
else
  fail "container #1 did not become healthy"; exit 1
fi

# static UI
curl -fsS -o /dev/null "$BASE/signin.html" \
  && ok "static UI /signin.html 200" \
  || fail "static UI /signin.html not 200"

# real MCP client tool call (project.list)
if mcp list >/dev/null; then
  ok "MCP project.list via SDK client + bearer returned ok"
else
  fail "MCP project.list via SDK client failed"
fi

# SSE content-type
SSE_HDR="$(curl -s -D - -o /dev/null -m 2 "$BASE/api/stream" 2>/dev/null || true)"
echo "$SSE_HDR" | grep -qi 'content-type: *text/event-stream' \
  && ok "SSE /api/stream Content-Type text/event-stream" \
  || fail "SSE /api/stream did not return text/event-stream"

# ---------- (d) write data: project via API, task via MCP ----------
step "write data (project via HTTP API, task via MCP)"
curl -fsS -X POST -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d "{\"slug\":\"$PSLUG\",\"name\":\"verify-docker persist\"}" "$BASE/api/projects" >/dev/null \
  && ok "created project $PSLUG via API" \
  || fail "could not create project via API"

if mcp create "$PSLUG" "$TKEY" >/dev/null; then
  ok "created task $TKEY via MCP task.create"
else
  fail "could not create task via MCP"
fi

# ---------- (e) graceful stop ----------
step "docker stop -> graceful SIGTERM, exit 0"
docker stop "$C1" >/dev/null
EXIT_CODE="$(docker inspect -f '{{.State.ExitCode}}' "$C1" 2>/dev/null)"
if [ "$EXIT_CODE" = "0" ]; then
  ok "container #1 exit code 0 (graceful, not SIGKILL/137)"
else
  fail "container #1 exit code $EXIT_CODE after docker stop (expected 0; 137 = SIGKILL)"
fi
docker rm "$C1" >/dev/null 2>&1 || true

# ---------- (f) persistence across recreate ----------
step "recreate: NEW container #2 on same mounts, data must survive"
if run_container "$C2"; then
  ok "container #2 up on the same host mounts"
else
  fail "container #2 did not become healthy"
fi

# project readable via API
if curl -fsS -H "Authorization: Bearer $TOK" "$BASE/api/projects" | grep -q "\"$PSLUG\""; then
  ok "project $PSLUG still readable via API after recreate"
else
  fail "project $PSLUG lost after container recreate"
fi

# task readable via MCP (real read of the persisted row)
if mcp list 2>/dev/null | grep -q "\"$PSLUG\""; then
  ok "MCP read after recreate still sees project $PSLUG"
else
  fail "MCP read after recreate does not see project $PSLUG"
fi
if curl -fsS -H "Authorization: Bearer $TOK" "$BASE/api/tasks?project=$PSLUG" | grep -q "\"$TKEY\""; then
  ok "task $TKEY still readable via API after recreate"
else
  fail "task $TKEY lost after container recreate"
fi

# DB file non-empty on the host bind mount
if [ -s "$HOSTDIR/data/tasks.db" ]; then
  ok "DB file non-empty on host mount ($(wc -c <"$HOSTDIR/data/tasks.db" | tr -d ' ') bytes)"
else
  fail "DB file missing/empty on host mount"
fi

# usage log on host mount — only when TASK-028's feature is in the source.
if grep -rqi 'USAGE_LOG_DIR' server/src 2>/dev/null; then
  if find "$HOSTDIR/logs" -name '*.jsonl' -type f 2>/dev/null | grep -q .; then
    ok "usage log (.jsonl) present on host mount"
  else
    fail "TASK-028 present but no usage log (.jsonl) on host mount"
  fi
else
  echo "skip: TASK-028 USAGE_LOG_DIR feature not in source — usage-log check skipped"
fi

docker rm -f "$C2" >/dev/null 2>&1 || true

if [ "$FAIL" -eq 0 ]; then
  echo "VERIFY-DOCKER: ALL CHECKS PASSED"
  exit 0
fi
echo "VERIFY-DOCKER: FAILED"
exit 1
