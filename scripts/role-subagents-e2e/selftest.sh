#!/usr/bin/env bash
# selftest.sh — deterministic, re-runnable self-test for the role-subagent
# lifecycle E2E (TASK-046).
#
# It stands in for the real 5-LLM-subagent run (which is non-deterministic and
# graded via RUNBOOK.md at the Judge/Human step) by spawning 5 SCRIPTED MCP
# role-clients — each a SEPARATE @modelcontextprotocol/sdk Streamable HTTP
# client bound to exactly ONE role bearer token, each performing ONLY that
# role's calls. The self-check and judge clients POLL task.get and wait until it
# is their turn before acting, mirroring how the real subagents coordinate
# purely through the server (no shared token, no out-of-band signalling).
#
# Lifecycle driven against the DOCKERIZED server:
#   human:       task.create (allow_no_code_change:true so the IMPLEMENTED guard passes)
#   implementer: task.claim (gate lease guard) -> TODO->IN_PROGRESS -> IN_PROGRESS->IMPLEMENTED
#   runner:      evidence.submit (does NOT transition)
#   self-check:  (poll until IMPLEMENTED) task.selfcheck -> SELF_CHECK_PASSED
#   judge:       (poll until SELF_CHECK_PASSED) verdict=PASS comment -> SELF_CHECK_PASSED->JUDGE_PASSED
#   human:       (poll until JUDGE_PASSED) task.approve -> DONE
#
# After the run it invokes verify-role-flow.mjs, which reads REAL server data
# back and asserts the per-role-actor + >=5 distinct-token invariants and final
# DONE. Final line: ROLE-SUBAGENTS-E2E: ALL CHECKS PASSED / FAILED.
#
# Re-runnable: unique high port + unique container/image names; cleanup trap
# tears down container + image + scratch dir even on failure.
set -uo pipefail

# --- clean-skip: docker absent -> visible skip + exit 0 (must be FIRST) -------
if ! command -v docker >/dev/null 2>&1; then
  echo "skip: docker not on PATH — skipping role-subagent E2E self-test"
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # scripts/role-subagents-e2e -> repo root
cd "$ROOT"

DIR="scripts/role-subagents-e2e"
IMG="agentic-kanban:role-subagents-e2e"
C1="rs-c1-$$"
HOSTDIR="$ROOT/.role-subagents-e2e.$$"     # under repo root -> Docker Desktop file sharing works
ADMIN_TOKEN="rs-admin-$$-$RANDOM"
HPORT="${RS_PORT:-3961}"
BASE="http://127.0.0.1:$HPORT"
ROLECLIENT="$HOSTDIR/role-client.mjs"
PROJECT="rs-proj"
TKEY="RS-LIFE-1"
FAIL=0

fail() { echo "FAIL: $*" >&2; FAIL=1; }
ok()   { echo "ok:   $*"; }
step() { echo "== role-subagents-e2e: $* =="; }

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
# token. It performs ONLY its role's calls. self-check/judge/human first POLL
# task.get until the task reaches the state they are responsible for, mirroring
# the real subagents that wait their turn instead of acting early.
#
#   argv: <role>
#   env:  MCP_URL, MCP_TOKEN (this role's bearer ONLY), RS_PROJECT, RS_KEY
cat >"$ROLECLIENT" <<'EOF'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const role = process.argv[2]
const project = process.env.RS_PROJECT
const key = process.env.RS_KEY

const transport = new StreamableHTTPClientTransport(new URL(process.env.MCP_URL), {
  requestInit: { headers: { Authorization: 'Bearer ' + process.env.MCP_TOKEN } },
})
const client = new Client({ name: 'role-subagent-' + role, version: '0.0.1' })
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
// Poll task.get until the task reaches `want` (the role waits its turn).
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
      await call('task.create', { project, key, title: 'role-subagent lifecycle', allow_no_code_change: true })
      console.log('human created ' + key)
      break
    case 'implementer':
      // gate lease guard: claim before forward transitions.
      await call('task.claim', { project, key })
      await call('task.transition', { project, key, from: 'TODO', to: 'IN_PROGRESS' })
      await call('task.transition', { project, key, from: 'IN_PROGRESS', to: 'IMPLEMENTED' })
      console.log('implementer claimed + TODO->IN_PROGRESS->IMPLEMENTED')
      break
    case 'runner':
      // runner only submits evidence; it never transitions.
      await waitForState('IMPLEMENTED')
      await call('evidence.submit', {
        project, key, build_exit: 0, test_exit: 0, ac_exit: 0, manifest_json: '{"files":[]}',
      })
      console.log('runner submitted evidence (build/test/ac=0)')
      break
    case 'self-check': {
      // wait our turn: IMPLEMENTED *and* the runner's evidence is present
      // (selfcheck re-verifies the latest evidence row), then advance.
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
      // wait our turn, then leave a verdict=PASS comment + advance.
      await waitForState('SELF_CHECK_PASSED')
      await call('comment.add', {
        project, key, kind: 'verdict', verdict: 'PASS', body_md: 'VERDICT: PASS',
      })
      await call('task.transition', { project, key, from: 'SELF_CHECK_PASSED', to: 'JUDGE_PASSED' })
      console.log('judge added verdict=PASS + SELF_CHECK_PASSED->JUDGE_PASSED')
      break
    case 'human-approve':
      // only the human reaches DONE.
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

# roleclient <role> <secret> — run one scripted role-subagent bound to ONE token.
roleclient() {
  local role="$1" secret="$2"
  MCP_URL="$BASE/mcp" MCP_TOKEN="$secret" RS_PROJECT="$PROJECT" RS_KEY="$TKEY" \
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
if docker build -q -t "$IMG" . >/dev/null; then
  ok "image built"
else
  echo "FAIL: docker build failed"; exit 1
fi

# ---------- run container ----------
step "run container with host mounts + ADMIN_TOKEN"
if run_container "$C1"; then
  ok "container up, /healthz 200"
else
  echo "FAIL: container did not become healthy"; exit 1
fi

# ---------- project + per-role tokens (one bearer per role) ----------
step "seed project + mint one bearer token per role (no shared token)"
STATUS="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"slug\":\"$PROJECT\",\"name\":\"role-subagents project\"}" "$BASE/api/projects")"
[ "$STATUS" = "201" ] && ok "created project $PROJECT (201)" || fail "create project: status $STATUS"

# mint-role-tokens.sh prints: ROLE<TAB>TOKEN_ID<TAB>SECRET, one line per role.
# (bash 3.2 compatible — no associative arrays; one var per role.)
MINTED="$(BASE_URL="$BASE" ADMIN_TOKEN="$ADMIN_TOKEN" bash "$DIR/mint-role-tokens.sh")"
SEC_human=""; SEC_implementer=""; SEC_runner=""; SEC_selfcheck=""; SEC_judge=""
ID_human=""; ID_implementer=""; ID_runner=""; ID_selfcheck=""; ID_judge=""
while IFS=$'\t' read -r role id secret; do
  case "$role" in
    human)       ID_human="$id";       SEC_human="$secret" ;;
    implementer) ID_implementer="$id"; SEC_implementer="$secret" ;;
    runner)      ID_runner="$id";      SEC_runner="$secret" ;;
    self-check)  ID_selfcheck="$id";   SEC_selfcheck="$secret" ;;
    judge)       ID_judge="$id";       SEC_judge="$secret" ;;
  esac
done <<EOM
$MINTED
EOM

[ -n "$SEC_human" ] && [ -n "$ID_human" ]             && ok "minted human token (id=$ID_human)"             || fail "missing token for role human"
[ -n "$SEC_implementer" ] && [ -n "$ID_implementer" ] && ok "minted implementer token (id=$ID_implementer)" || fail "missing token for role implementer"
[ -n "$SEC_runner" ] && [ -n "$ID_runner" ]           && ok "minted runner token (id=$ID_runner)"           || fail "missing token for role runner"
[ -n "$SEC_selfcheck" ] && [ -n "$ID_selfcheck" ]     && ok "minted self-check token (id=$ID_selfcheck)"     || fail "missing token for role self-check"
[ -n "$SEC_judge" ] && [ -n "$ID_judge" ]             && ok "minted judge token (id=$ID_judge)"              || fail "missing token for role judge"

# Prove the five bearers are genuinely DISTINCT (no shared token).
DISTINCT_IDS="$(printf '%s\n' "$ID_human" "$ID_implementer" "$ID_runner" "$ID_selfcheck" "$ID_judge" | sort -u | wc -l | tr -d ' ')"
[ "$DISTINCT_IDS" = "5" ] && ok "5 distinct token_ids minted" || fail "expected 5 distinct token_ids, got $DISTINCT_IDS"

if [ "$FAIL" -ne 0 ]; then echo "ROLE-SUBAGENTS-E2E: FAILED"; exit 1; fi

# ---------- spawn the 5 scripted role-subagents ----------
# Each is a SEPARATE MCP client bound to ONE role token. self-check, judge,
# runner and the human-approve step are launched in the BACKGROUND first; they
# poll task.get and wait their turn — so the only ordering we force is "human
# creates the task first". The hand-offs are coordinated purely through server
# state, exactly as the real subagents will do.
step "spawn 5 scripted role-subagents (one bearer each; self-check/judge poll + wait their turn)"

# human creates the task first (TODO).
if roleclient human-create "$SEC_human"; then ok "human-create done"; else fail "human-create failed"; fi

# Launch the waiting roles in the background (they poll for their turn).
roleclient runner        "$SEC_runner"    & PID_RUNNER=$!
roleclient self-check    "$SEC_selfcheck" & PID_SELFCHECK=$!
roleclient judge         "$SEC_judge"     & PID_JUDGE=$!
roleclient human-approve "$SEC_human"     & PID_APPROVE=$!

# implementer drives TODO->IN_PROGRESS->IMPLEMENTED (foreground), which unblocks
# the runner + self-check that are polling for IMPLEMENTED.
if roleclient implementer "$SEC_implementer"; then ok "implementer done"; else fail "implementer failed"; fi

# Wait for the background role-subagents and capture their exit codes.
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
  echo "ROLE-SUBAGENTS-E2E: ALL CHECKS PASSED"
  exit 0
fi
echo "ROLE-SUBAGENTS-E2E: FAILED"
exit 1
