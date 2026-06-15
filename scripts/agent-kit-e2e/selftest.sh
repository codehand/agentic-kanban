#!/usr/bin/env bash
# selftest.sh — deterministic, re-runnable Docker self-test for the TASK-047
# AGENT KIT (examples/agent-kit/.claude/agents/aka-*.md).
#
# Real Claude role subagents are non-deterministic and cannot run in a headless
# gate (that path is the human-observed RUNBOOK.md → AC4/AC5). This stands in for
# them deterministically: it spawns 5 SCRIPTED single-token MCP SDK clients —
# implementer, runner, self-check, judge, human — each bound to EXACTLY ONE role
# bearer token and performing ONLY the actions its kit agent def is scoped to:
#   implementer (taskhub-impl):      task.claim -> TODO->IN_PROGRESS -> IN_PROGRESS->IMPLEMENTED
#   runner      (taskhub-runner):    evidence.submit ONLY (never transitions)
#   self-check  (taskhub-selfcheck): poll until IMPLEMENTED+evidence, task.selfcheck -> SELF_CHECK_PASSED
#   judge       (taskhub-judge):     poll until SELF_CHECK_PASSED, verdict=PASS comment -> JUDGE_PASSED
#   human       (taskhub-human):     task.create first; poll until JUDGE_PASSED, task.approve -> DONE
#
# The hand-offs are coordinated PURELY through server state (self-check/judge/human
# poll task.get and wait their turn) — no shared token, no out-of-band signalling,
# exactly as the real kit subagents coordinate. The task is created with
# allow_no_code_change:true so the IMPLEMENTED guard passes; the implementer must
# task.claim before forward transitions (gate lease guard).
#
# After the run it invokes verify-role-flow.mjs, which reads REAL server data back
# and asserts per-edge actor_role/actor_token_id, judge verdict=PASS, runner-
# submitted evidence, >=5 distinct token_ids, and final DONE.
#
# Final line: AGENT-KIT-E2E: ALL CHECKS PASSED / FAILED (matching exit code).
# Re-runnable: unique port/container/image/scratch; cleanup trap tears it all down.
# Clean-skip: visible 'skip:' + exit 0 when docker is absent.
set -uo pipefail

# --- clean-skip: docker absent -> visible skip + exit 0 (must be FIRST) -------
if ! command -v docker >/dev/null 2>&1; then
  echo "skip: docker not on PATH — skipping agent-kit E2E self-test"
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # scripts/agent-kit-e2e -> repo root
cd "$ROOT"

DIR="scripts/agent-kit-e2e"
IMG="agentic-kanban:agent-kit-e2e"
C1="ak-c1-$$"
HOSTDIR="$ROOT/.agent-kit-e2e.$$"          # under repo root -> Docker Desktop file sharing works
ADMIN_TOKEN="ak-admin-$$-$RANDOM"          # the human bootstrap bearer
HPORT="${AK_PORT:-3962}"
BASE="http://127.0.0.1:$HPORT"
ROLECLIENT="$HOSTDIR/role-client.mjs"
PROJECT="ak-proj"
TKEY="AK-LIFE-1"
FAIL=0

fail() { echo "FAIL: $*" >&2; FAIL=1; }
ok()   { echo "ok:   $*"; }
step() { echo "== agent-kit-e2e: $* =="; }

cleanup() {
  docker rm -f "$C1" >/dev/null 2>&1 || true
  docker image rm -f "$IMG" >/dev/null 2>&1 || true
  rm -rf "$HOSTDIR"
}
trap cleanup EXIT

# Preflight.
command -v node >/dev/null 2>&1 || { echo "FAIL: node not on PATH (needed for the MCP SDK clients)"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "FAIL: curl not on PATH"; exit 1; }
[ -f Dockerfile ] || { echo "FAIL: Dockerfile missing"; exit 1; }
[ -d node_modules/@modelcontextprotocol/sdk ] || { echo "FAIL: @modelcontextprotocol/sdk not installed (run pnpm install)"; exit 1; }

cleanup
mkdir -p "$HOSTDIR/data" "$HOSTDIR/logs"

# --- the ROLE CLIENT: a single MCP SDK client bound to ONE role bearer --------
# Each scripted role-subagent is one invocation of this script with its own
# token. It performs ONLY its kit agent def's actions. self-check/judge/human
# first POLL task.get until the task reaches the state they own, mirroring the
# real subagents that wait their turn (coordination through the server only).
#
#   argv: <role>     (human-create | implementer | runner | self-check | judge | human-approve)
#   env:  MCP_URL, MCP_TOKEN (this role's bearer ONLY), AK_PROJECT, AK_KEY
cat >"$ROLECLIENT" <<'EOF'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const role = process.argv[2]
const project = process.env.AK_PROJECT
const key = process.env.AK_KEY

const transport = new StreamableHTTPClientTransport(new URL(process.env.MCP_URL), {
  requestInit: { headers: { Authorization: 'Bearer ' + process.env.MCP_TOKEN } },
})
const client = new Client({ name: 'aka-' + role, version: '0.0.1' })
await client.connect(transport)

const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args })
  const text = (r.content ?? []).filter((p) => p.type === 'text').map((p) => p.text).join('')
  if (r.isError) throw new Error(`${name} isError: ${text}`)
  return text
}
const getState = async () => {
  try { return JSON.parse(await call('task.get', { project, key })).state } catch { return null }
}
const waitForState = async (want, timeoutMs = 30000) => {
  const start = Date.now()
  for (;;) {
    const s = await getState()
    if (s === want) return
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for state ${want} (last=${s})`)
    await new Promise((r) => setTimeout(r, 200))
  }
}

try {
  switch (role) {
    case 'human-create':
      // aka-human creates a fresh TODO; allow_no_code_change lets IMPLEMENTED guard pass.
      await call('task.create', { project, key, title: 'agent-kit lifecycle', allow_no_code_change: true })
      console.log('human created ' + key)
      break
    case 'implementer':
      // aka-implementer: gate lease guard -> claim before forward transitions.
      await call('task.claim', { project, key })
      await call('task.transition', { project, key, from: 'TODO', to: 'IN_PROGRESS' })
      await call('task.transition', { project, key, from: 'IN_PROGRESS', to: 'IMPLEMENTED' })
      console.log('implementer claimed + TODO->IN_PROGRESS->IMPLEMENTED')
      break
    case 'runner':
      // aka-runner: evidence.submit ONLY; never transitions.
      await waitForState('IMPLEMENTED')
      await call('evidence.submit', {
        project, key, build_exit: 0, test_exit: 0, ac_exit: 0, manifest_json: '{"files":[]}',
      })
      console.log('runner submitted evidence (build/test/ac=0)')
      break
    case 'self-check': {
      // aka-self-check: wait for IMPLEMENTED + runner evidence present, then trigger the gate.
      await waitForState('IMPLEMENTED')
      const start = Date.now()
      for (;;) {
        let hasEvidence = false
        try { hasEvidence = !!JSON.parse(await call('evidence.get', { project, key })).id } catch {}
        if (hasEvidence) break
        if (Date.now() - start > 30000) throw new Error('timeout waiting for runner evidence')
        await new Promise((r) => setTimeout(r, 200))
      }
      await call('task.selfcheck', { project, key })
      console.log('self-check -> SELF_CHECK_PASSED')
      break
    }
    case 'judge':
      // aka-judge: verdict=PASS comment first (gate guard), then judge edge.
      await waitForState('SELF_CHECK_PASSED')
      await call('comment.add', {
        project, key, kind: 'verdict', verdict: 'PASS', body_md: 'VERDICT: PASS',
      })
      await call('task.transition', { project, key, from: 'SELF_CHECK_PASSED', to: 'JUDGE_PASSED' })
      console.log('judge added verdict=PASS + SELF_CHECK_PASSED->JUDGE_PASSED')
      break
    case 'human-approve':
      // aka-human: only the human reaches DONE.
      await waitForState('JUDGE_PASSED')
      await call('task.approve', { project, key })
      console.log('human approve JUDGE_PASSED->DONE')
      break
    default:
      throw new Error('unknown role ' + role)
  }
} finally {
  await client.close()
}
EOF

# --- mint helper: extract a top-level JSON string field from stdin ------------
json_field() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);process.stdout.write(String(o[process.argv[1]]??""))}catch{}})' "$1"
}

# mint ROLE -> echo "TOKEN_ID<TAB>SECRET" (POST /api/tokens as the human admin).
mint() {
  local role="$1" resp id secret
  resp="$(curl -fsS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
    -d "{\"role\":\"$role\",\"label\":\"ak-$role\"}" "$BASE/api/tokens")" || return 1
  id="$(printf '%s' "$resp" | json_field id)"
  secret="$(printf '%s' "$resp" | json_field secret)"
  [ -n "$id" ] && [ -n "$secret" ] || return 1
  printf '%s\t%s' "$id" "$secret"
}

# roleclient <role> <secret> — run one scripted role-subagent bound to ONE token.
roleclient() {
  local role="$1" secret="$2"
  MCP_URL="$BASE/mcp" MCP_TOKEN="$secret" AK_PROJECT="$PROJECT" AK_KEY="$TKEY" \
    node "$ROLECLIENT" "$role"
}

# run_container NAME — start a container with host mounts + ADMIN_TOKEN, wait /healthz.
run_container() {
  local name="$1"
  docker run -d --name "$name" -p "$HPORT:3000" \
    -e PORT=3000 -e ADMIN_TOKEN="$ADMIN_TOKEN" \
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

# ---------- build ----------
step "docker build from clean source"
if docker build -q -t "$IMG" . >/dev/null; then ok "image built"; else echo "FAIL: docker build failed"; exit 1; fi

# ---------- run container ----------
step "run container with host mounts + ADMIN_TOKEN"
if run_container "$C1"; then ok "container up, /healthz 200"; else echo "FAIL: container did not become healthy"; exit 1; fi

# ---------- project + per-role tokens (one bearer per role) ----------
step "seed project + mint one bearer token per role (implementer/runner/self-check/judge/human)"
STATUS="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"slug\":\"$PROJECT\",\"name\":\"agent-kit e2e project\"}" "$BASE/api/projects")"
[ "$STATUS" = "201" ] && ok "created project $PROJECT (201)" || fail "create project: status $STATUS"

# human bearer = the ADMIN_TOKEN itself; its token_id is read back from GET /api/tokens.
ID_human="$(curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/api/tokens" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const t=(JSON.parse(s).tokens||[]).find(x=>x.role==="human");process.stdout.write(t?t.id:"")}catch{}})')"
SEC_human="$ADMIN_TOKEN"

# bash 3.2 compatible: one var per role, NO associative arrays.
# `read` returns non-zero on the missing trailing newline; ignore that and
# validate the parsed values below instead.
IFS=$'\t' read -r ID_implementer SEC_implementer <<< "$(mint implementer)" || true
IFS=$'\t' read -r ID_runner      SEC_runner      <<< "$(mint runner)"      || true
IFS=$'\t' read -r ID_selfcheck   SEC_selfcheck   <<< "$(mint self-check)"  || true
IFS=$'\t' read -r ID_judge       SEC_judge       <<< "$(mint judge)"       || true

[ -n "$SEC_human" ] && [ -n "$ID_human" ]             && ok "minted human token (id=$ID_human)"             || fail "missing token for role human"
[ -n "$SEC_implementer" ] && [ -n "$ID_implementer" ] && ok "minted implementer token (id=$ID_implementer)" || fail "missing token for role implementer"
[ -n "$SEC_runner" ] && [ -n "$ID_runner" ]           && ok "minted runner token (id=$ID_runner)"           || fail "missing token for role runner"
[ -n "$SEC_selfcheck" ] && [ -n "$ID_selfcheck" ]     && ok "minted self-check token (id=$ID_selfcheck)"     || fail "missing token for role self-check"
[ -n "$SEC_judge" ] && [ -n "$ID_judge" ]             && ok "minted judge token (id=$ID_judge)"              || fail "missing token for role judge"

# Prove the five bearers are genuinely DISTINCT (no shared token).
DISTINCT_IDS="$(printf '%s\n' "$ID_human" "$ID_implementer" "$ID_runner" "$ID_selfcheck" "$ID_judge" | sort -u | wc -l | tr -d ' ')"
[ "$DISTINCT_IDS" = "5" ] && ok "5 distinct token_ids minted" || fail "expected 5 distinct token_ids, got $DISTINCT_IDS"

if [ "$FAIL" -ne 0 ]; then echo "AGENT-KIT-E2E: FAILED"; exit 1; fi

# ---------- spawn the 5 scripted role-subagents ----------
# Each is a SEPARATE MCP client bound to ONE role token. runner/self-check/judge
# and the human-approve step launch in the BACKGROUND first; they poll task.get
# and wait their turn. The only forced ordering is "human creates the task first".
step "spawn 5 scripted role-subagents (implementer/runner/self-check/judge/human; each one bearer; poll + wait turn)"

# human creates the task first (TODO).
if roleclient human-create "$SEC_human"; then ok "human-create done"; else fail "human-create failed"; fi

# Launch the waiting roles in the background (they poll for their turn).
roleclient runner        "$SEC_runner"    & PID_RUNNER=$!
roleclient self-check    "$SEC_selfcheck" & PID_SELFCHECK=$!
roleclient judge         "$SEC_judge"     & PID_JUDGE=$!
roleclient human-approve "$SEC_human"     & PID_APPROVE=$!

# implementer drives TODO->IN_PROGRESS->IMPLEMENTED (foreground), unblocking the
# runner + self-check that poll for IMPLEMENTED.
if roleclient implementer "$SEC_implementer"; then ok "implementer done"; else fail "implementer failed"; fi

wait $PID_RUNNER    && ok "runner subagent ok"     || fail "runner subagent failed"
wait $PID_SELFCHECK && ok "self-check subagent ok" || fail "self-check subagent failed"
wait $PID_JUDGE     && ok "judge subagent ok"      || fail "judge subagent failed"
wait $PID_APPROVE   && ok "human-approve ok"       || fail "human-approve subagent failed"

# ---------- verify: read REAL server data back + assert invariants ----------
step "verify-role-flow.mjs — read real timeline/comments/evidence back, assert invariants"
if BASE_URL="$BASE" TOKEN="$ADMIN_TOKEN" PROJECT="$PROJECT" KEY="$TKEY" \
   node "$DIR/verify-role-flow.mjs"; then
  ok "verify-role-flow.mjs PASSED"
else
  fail "verify-role-flow.mjs FAILED"
fi

# ---------- summary ----------
if [ "$FAIL" -eq 0 ]; then
  echo "AGENT-KIT-E2E: ALL CHECKS PASSED"
  exit 0
fi
echo "AGENT-KIT-E2E: FAILED"
exit 1
