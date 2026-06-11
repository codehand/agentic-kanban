#!/usr/bin/env bash
# e2e-thin-client.sh — end-to-end proof that the `.ai/` thin client drives a real
# Task Hub server through a full task lifecycle (P8 / TASK_HUB_DESIGN.md §12).
#
# NO MOCKS. This script:
#   1. boots the REAL server (dist/index.js) on an ephemeral port with a temp DB,
#   2. mints a human + a runner token via the real /api/tokens endpoint,
#   3. drives a throwaway task through the lifecycle using the REAL .ai/ scripts
#      (gate.sh propose / gitref.set / run-evidence.sh) with TASK_HUB_URL set so
#      every step is pushed to the server via MCP — in an isolated sandbox .ai/
#      tree so the real .ai/state is never touched,
#   4. ASSERTS against the server (via MCP read tools task.get / gitref.list /
#      evidence.get) that the transitions, gitref and evidence actually landed.
#
# Exit 0 = the server observed the full real flow. No self-echoed PASS.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Ephemeral free port (collision-proof — the OS hands us an unused one).
PORT="${E2E_PORT:-$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>console.log(p))})')}"
BASE="http://127.0.0.1:$PORT"
ADMIN_TOKEN="e2e-admin-$$"
PROJECT="e2e"
KEY="E2E-001"
WORK="$(mktemp -d)"
DB="$WORK/hub.db"
SANDBOX="$WORK/sandbox"
SRV_PID=""

cleanup() {
  [ -n "$SRV_PID" ] && kill -TERM "$SRV_PID" 2>/dev/null || true
  [ -n "$SRV_PID" ] && { for _ in $(seq 1 15); do kill -0 "$SRV_PID" 2>/dev/null || break; sleep 0.2; done; }
  [ -n "$SRV_PID" ] && kill -9 "$SRV_PID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() { echo "E2E FAIL: $*" >&2; exit 1; }
step() { echo "== e2e: $* =="; }

# ---------------------------------------------------------------------------
# 0. Preflight: need a build to run the server + .ai scripts present.
# ---------------------------------------------------------------------------
[ -f "$ROOT/dist/index.js" ] || fail "dist/index.js missing — run 'pnpm build' first"
source "$ROOT/.ai/scripts/mcp-client.sh"

# ---------------------------------------------------------------------------
# 1. Boot the REAL server (temp DB, ephemeral port).
# ---------------------------------------------------------------------------
step "boot real server on $BASE (db=$DB)"
# exec so SRV_PID is the node process itself (cleanup SIGTERM reaches it directly).
( cd "$ROOT" && exec env PORT="$PORT" DB_PATH="$DB" ADMIN_TOKEN="$ADMIN_TOKEN" node dist/index.js ) \
  >"$WORK/server.log" 2>&1 &
SRV_PID=$!
HEALTHY=0
for _ in $(seq 1 30); do
  if curl -fsS "$BASE/healthz" >/dev/null 2>&1; then HEALTHY=1; break; fi
  kill -0 "$SRV_PID" 2>/dev/null || break
  sleep 0.2
done
[ "$HEALTHY" -eq 1 ] || { cat "$WORK/server.log" >&2; fail "server did not become healthy"; }

# ---------------------------------------------------------------------------
# 2. Mint a runner token via the real /api/tokens (human ADMIN_TOKEN mints it).
# ---------------------------------------------------------------------------
step "mint runner token via /api/tokens"
RUNNER_TOKEN="$(curl -fsS -X POST "$BASE/api/tokens" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"role":"runner","label":"e2e-runner"}' | jq -r '.secret')"
[ -n "$RUNNER_TOKEN" ] && [ "$RUNNER_TOKEN" != "null" ] || fail "could not mint runner token"

# Implementer token (drives claim/transition as a non-human actor).
IMPL_TOKEN="$(curl -fsS -X POST "$BASE/api/tokens" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"role":"implementer","label":"e2e-impl"}' | jq -r '.secret')"
[ -n "$IMPL_TOKEN" ] && [ "$IMPL_TOKEN" != "null" ] || fail "could not mint implementer token"

# Self-check token (task.selfcheck requires the self-check role on the server).
SELFCHECK_TOKEN="$(curl -fsS -X POST "$BASE/api/tokens" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"role":"self-check","label":"e2e-selfcheck"}' | jq -r '.secret')"
[ -n "$SELFCHECK_TOKEN" ] && [ "$SELFCHECK_TOKEN" != "null" ] || fail "could not mint self-check token"

# ---------------------------------------------------------------------------
# 3. Create the project + task on the server via the REAL thin client (MCP).
# ---------------------------------------------------------------------------
step "create project '$PROJECT' + task '$KEY' on server (MCP, real client)"
export TASK_HUB_URL="$BASE" TASK_HUB_PROJECT="$PROJECT"
# project.create + task.create as human (ADMIN_TOKEN).
TASK_HUB_TOKEN="$ADMIN_TOKEN" mcp_call "project.create" \
  "$(jq -nc --arg s "$PROJECT" '{slug:$s, name:"E2E"}')" >/dev/null \
  || fail "project.create failed"
# allow_no_code_change so the server-side ->IMPLEMENTED guard passes; the real
# gitref.set push is still made + asserted independently below.
TASK_HUB_TOKEN="$ADMIN_TOKEN" mcp_call "task.create" \
  "$(jq -nc --arg p "$PROJECT" --arg k "$KEY" '{project:$p, key:$k, title:"E2E thin-client lifecycle", repos:["."], allow_no_code_change:true}')" >/dev/null \
  || fail "task.create failed"

# Assert the task exists on the server in TODO.
state_on_server() {
  TASK_HUB_TOKEN="$ADMIN_TOKEN" mcp_call "task.get" \
    "$(jq -nc --arg p "$PROJECT" --arg k "$KEY" '{project:$p, key:$k}')" 2>/dev/null \
    | jq -r '.state // .task.state // empty'
}
[ "$(state_on_server)" = "TODO" ] || fail "server task not in TODO after create (got '$(state_on_server)')"

# Implementer claims the task on the server (the gate transitions below are
# pushed with the implementer token, and the server's lease guard requires the
# caller to hold the lease for non-human transitions).
step "implementer claims task on server (lease for transitions)"
TASK_HUB_TOKEN="$IMPL_TOKEN" mcp_call "task.claim" \
  "$(jq -nc --arg p "$PROJECT" --arg k "$KEY" '{project:$p, key:$k}')" >/dev/null \
  || fail "task.claim failed"

# ---------------------------------------------------------------------------
# 4. Isolated sandbox .ai/ so gate.sh writes state HERE (not the real .ai/state).
#    The sandbox is a real git repo so gate.sh can create the task worktree.
# ---------------------------------------------------------------------------
step "build sandbox .ai/ + git repo for gate.sh"
mkdir -p "$SANDBOX/.ai/scripts" "$SANDBOX/.ai/tasks/$KEY"
cp "$ROOT/.ai/scripts/"*.sh "$SANDBOX/.ai/scripts/" 2>/dev/null || true
cp "$ROOT/.ai/config.yml" "$SANDBOX/.ai/config.yml"
chmod +x "$SANDBOX/.ai/scripts/"*.sh
# Minimal task spec: single repo '.', shared branch. allow no-code-change so the
# IMPLEMENTED guard passes without us faking source edits in the sandbox repo.
cat > "$SANDBOX/.ai/tasks/$KEY/$KEY.md" <<EOF
# $KEY: E2E thin-client lifecycle

Repos: .
Branch: fix/$KEY-e2e
Allow-No-Code-Change: true

## Acceptance Criteria
- [ ] AC1: lifecycle drives the real server.
EOF
( cd "$SANDBOX" && git init -q && git config user.email e2e@local && git config user.name e2e \
    && git add -A && git commit -qm "e2e sandbox base" ) || fail "sandbox git init failed"

GATE="$SANDBOX/.ai/scripts/gate.sh"
export TASK_HUB_TOKEN="$IMPL_TOKEN" TASK_HUB_RUNNER_TOKEN="$RUNNER_TOKEN" TASK_HUB_SELFCHECK_TOKEN="$SELFCHECK_TOKEN"

# Local lifecycle (gate.sh) -> each step also pushes to the server via MCP.
step "gate init + TODO->IN_PROGRESS (creates worktree, pushes to server)"
"$GATE" init "$KEY" >/dev/null || fail "gate init failed"
"$GATE" propose "$KEY" TODO IN_PROGRESS implementer >/dev/null 2>&1 || fail "gate propose IN_PROGRESS failed"
[ "$(state_on_server)" = "IN_PROGRESS" ] || fail "server did not move to IN_PROGRESS (got '$(state_on_server)')"

# Implementer report (gate guard for IMPLEMENTED requires it).
mkdir -p "$SANDBOX/.ai/reports/$KEY"
echo "e2e implementer report" > "$SANDBOX/.ai/reports/$KEY/implementer.md"

step "gate IN_PROGRESS->IMPLEMENTED (pushes transition + gitref.set to server)"
"$GATE" propose "$KEY" IN_PROGRESS IMPLEMENTED implementer >/dev/null 2>&1 || fail "gate propose IMPLEMENTED failed"
[ "$(state_on_server)" = "IMPLEMENTED" ] || fail "server did not move to IMPLEMENTED (got '$(state_on_server)')"

# Assert the gitref landed on the server (mapped from the sandbox worktree).
step "assert gitref.set landed on server"
GITREF_COUNT="$(TASK_HUB_TOKEN="$ADMIN_TOKEN" mcp_call "gitref.list" \
  "$(jq -nc --arg p "$PROJECT" --arg k "$KEY" '{project:$p, key:$k}')" 2>/dev/null \
  | jq -r 'if type=="array" then length elif (.gitrefs|type)=="array" then (.gitrefs|length) else 0 end' 2>/dev/null)"
[ "${GITREF_COUNT:-0}" -ge 1 ] || fail "no gitref on server after IMPLEMENTED (count=$GITREF_COUNT)"

# ---------------------------------------------------------------------------
# 5. run-evidence.sh submits evidence to the server using the RUNNER token.
# ---------------------------------------------------------------------------
step "run-evidence.sh -> evidence.submit (runner token) on server"
# Sandbox repo has no package.json -> build/test = 'na', ac = 'na'; the runner
# still produces a manifest and submits it. We only need the server to record
# evidence for the task to prove the runner->server path is wired.
"$SANDBOX/.ai/scripts/run-evidence.sh" "$KEY" >"$WORK/evidence.log" 2>&1 \
  || { cat "$WORK/evidence.log" >&2; fail "run-evidence.sh failed"; }

step "assert evidence landed on server"
EV_HAS="$(TASK_HUB_TOKEN="$ADMIN_TOKEN" mcp_call "evidence.get" \
  "$(jq -nc --arg p "$PROJECT" --arg k "$KEY" '{project:$p, key:$k}')" 2>/dev/null \
  | jq -r 'if (.evidence // .) == null then "none" else "have" end' 2>/dev/null)"
[ "$EV_HAS" = "have" ] || fail "no evidence recorded on server (got '$EV_HAS')"

# ---------------------------------------------------------------------------
# 6. selfcheck -> server task.selfcheck pushes the SELF_CHECK_* transition.
# ---------------------------------------------------------------------------
step "gate selfcheck (pushes task.selfcheck to server)"
"$GATE" selfcheck "$KEY" >"$WORK/selfcheck.log" 2>&1 || true   # local verdict may FAIL (na); server push still fires
FINAL_STATE="$(state_on_server)"
case "$FINAL_STATE" in
  SELF_CHECK_PASSED|SELF_CHECK_FAILED) : ;;
  *) fail "server did not record a self-check verdict (state='$FINAL_STATE')" ;;
esac

echo
echo "E2E PASS: server observed full real thin-client lifecycle for $PROJECT/$KEY"
echo "  TODO -> IN_PROGRESS -> IMPLEMENTED (+gitref) -> evidence -> $FINAL_STATE"
exit 0
