#!/usr/bin/env bash
# verify-docker-features.sh — full PRODUCT FEATURE E2E against the Dockerized
# server (TASK-045).
#
# Where verify-docker.sh (TASK-029) proves PACKAGING (build, bind-mounts,
# graceful stop, persistence), this harness proves BEHAVIOR: the
# no-self-certification lifecycle with per-role enforcement, token mint/revoke
# + project scope, live SSE transition events, the task dependency gate
# (TASK-044), and the UI/a11y — all read back from a freshly built + run
# container.
#
# NO TAUTOLOGY: every assertion reads real data back from the running server
# (HTTP API + a real @modelcontextprotocol/sdk Streamable HTTP client + bearer).
# A "PASS" is only printed after the read returned the expected payload; every
# negative case asserts the call was actually REJECTED (MCP isError / HTTP
# non-2xx), not merely invoked.
#
# Coverage (each step reads real data back):
#   1. Full MCP lifecycle TODO->...->DONE with separate per-role bearer tokens
#      (human/implementer/self-check/judge/runner). Final state read back as DONE.
#   2. Role + gate enforcement (negative): implementer evidence.submit rejected;
#      skip transition IMPLEMENTED->JUDGE_PASSED rejected; non-human approve
#      rejected; ->JUDGE_PASSED with no verdict=PASS comment rejected.
#   3. Token lifecycle: mint via POST /api/tokens; DELETE -> 200; repeat -> 409;
#      revoked secret -> 401; project-scoped token blocked on another project.
#   4. SSE live: open /api/stream, drive a transition, assert the transition
#      event arrives for that task.
#   5. Dependency gate (TASK-044): B depends_on A; B's claim is blocked while A
#      is not DONE, and allowed once A reaches DONE.
#   6. UI / a11y: signin.html + board served 200; axe (WCAG A/AA) zero
#      violations on board, workflow, tokens (skips if no browser).
#
# Re-runnable: unique high port + unique container/image names; a cleanup trap
# removes containers + image + scratch dir even on failure.
#
# Clean-skip: if docker is not on PATH, print a visible skip line and exit 0 so
# the gate is never blocked in docker-less environments.
set -uo pipefail

# --- clean-skip: docker absent -> visible skip + exit 0 (must be FIRST) -------
if ! command -v docker >/dev/null 2>&1; then
  echo "skip: docker not on PATH — skipping Docker feature E2E"
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IMG="agentic-kanban:verify-docker-features"
C1="vdf-c1-$$"
HOSTDIR="$ROOT/.verify-docker-features.$$"   # under repo root -> Docker Desktop file sharing works
ADMIN_TOKEN="vdf-admin-$$-$RANDOM"
HPORT="${VDF_PORT:-3947}"
BASE="http://127.0.0.1:$HPORT"
CLIENT="$HOSTDIR/mcp-client.mjs"
AXE="$HOSTDIR/axe-scan.mjs"
FAIL=0

fail() { echo "FAIL: $*" >&2; FAIL=1; }
ok()   { echo "ok:   $*"; }
step() { echo "== verify-docker-features: $* =="; }

cleanup() {
  docker rm -f "$C1" >/dev/null 2>&1 || true
  docker image rm -f "$IMG" >/dev/null 2>&1 || true
  rm -rf "$HOSTDIR"
}
trap cleanup EXIT

# Preflight.
command -v node >/dev/null 2>&1 || { echo "FAIL: node not on PATH (needed for the MCP SDK client)"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "FAIL: curl not on PATH"; exit 1; }
[ -f Dockerfile ] || { echo "FAIL: Dockerfile missing"; exit 1; }
[ -d node_modules/@modelcontextprotocol/sdk ] || { echo "FAIL: @modelcontextprotocol/sdk not installed (run pnpm install)"; exit 1; }

cleanup
mkdir -p "$HOSTDIR/data" "$HOSTDIR/logs"

# --- real MCP SDK client over Streamable HTTP + bearer ------------------------
# argv: <token> <toolName> <jsonArgs>
# Prints the tool's text payload on success. On an MCP tool error (isError) it
# prints "ISERROR <text>" to stdout and exits 2 so the shell can assert the
# call was actually rejected (negative cases) vs. genuinely failed.
cat >"$CLIENT" <<'EOF'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const [secret, toolName, jsonArgs] = process.argv.slice(2)
const args = jsonArgs ? JSON.parse(jsonArgs) : {}

const transport = new StreamableHTTPClientTransport(new URL(process.env.MCP_URL), {
  requestInit: { headers: { Authorization: 'Bearer ' + secret } },
})
const client = new Client({ name: 'verify-docker-features', version: '0.0.1' })
await client.connect(transport)

let r
try {
  r = await client.callTool({ name: toolName, arguments: args })
} finally {
  await client.close()
}

const text = (r.content ?? []).filter((p) => p.type === 'text').map((p) => p.text).join('')
if (r.isError) {
  process.stdout.write('ISERROR ' + text)
  process.exit(2)
}
process.stdout.write(text)
EOF

# --- axe (WCAG A/AA) scan against live container pages ------------------------
# argv: <baseUrl> <project>. Visits board, workflow, tokens. Prints
# "AXE-VIOLATIONS <n>" per page; exits 0 with zero total violations, 3 with
# any, 4 if a browser is unavailable (caller treats 4 as a skip).
cat >"$AXE" <<'EOF'
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'

const base = process.argv[2]
const project = process.argv[3]
const token = process.argv[4] || 'axe-scan-token'
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const pages = [
  ['board', `${base}/${project}/index.html`],
  ['workflow', `${base}/workflow.html`],
  ['tokens', `${base}/tokens.html`],
]

let browser
try {
  browser = await chromium.launch()
} catch (e) {
  console.log('AXE-NO-BROWSER ' + (e?.message ?? e))
  process.exit(4)
}

let total = 0
const ctx = await browser.newContext()
const page = await ctx.newPage()
// Seed a REAL token so the app shell does not bounce to signin (a redirect mid
// scan destroys the execution context).
await page.addInitScript((t) => localStorage.setItem('kanban_token', t), token)

// analyze with a tiny retry: a late client-side redirect can destroy the
// execution context the first time; let the page settle and try once more.
async function scan(name, url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
      // Board keeps a long-lived SSE connection open so 'load'/'networkidle'
      // never settle — wait for the body to be attached, then let scripts run.
      await page.waitForSelector('body', { timeout: 10000 })
      await page.waitForTimeout(1500)
      const res = await new AxeBuilder({ page }).options({ runOnly: { type: 'tag', values: WCAG } }).analyze()
      return res
    } catch (e) {
      if (attempt === 1) throw e
      await page.waitForTimeout(1000)
    }
  }
}

for (const [name, url] of pages) {
  const res = await scan(name, url)
  const v = res.violations.length
  total += v
  console.log(`AXE-VIOLATIONS ${name} ${v}` + (v ? ' ' + res.violations.map((x) => x.id).join(',') : ''))
}
await browser.close()
process.exit(total === 0 ? 0 : 3)
EOF

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

# mcp <secret> <tool> <jsonArgs> — run the SDK client; returns its exit code.
mcp() { MCP_URL="$BASE/mcp" node "$CLIENT" "$@"; }

# task_state <secret> <key> — read a task's current state back via task.get.
task_state() {
  mcp "$1" task.get "{\"project\":\"$PROJECT\",\"key\":\"$2\"}" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).state||"")}catch{}})'
}

# api METHOD PATH SECRET [BODY] — print "<status>\n<body>" (status on the last line tail).
# Use api_status / api_body helpers to consume.
api() {
  local method="$1" path="$2" secret="$3" body="${4:-}"
  if [ -n "$body" ]; then
    curl -s -o "$HOSTDIR/.resp" -w '%{http_code}' -X "$method" \
      -H "Authorization: Bearer $secret" -H 'Content-Type: application/json' \
      -d "$body" "$BASE$path"
  else
    curl -s -o "$HOSTDIR/.resp" -w '%{http_code}' -X "$method" \
      -H "Authorization: Bearer $secret" "$BASE$path"
  fi
}
api_body() { cat "$HOSTDIR/.resp"; }

# mint_token ROLE LABEL [PROJECT] — mint via API as human, echo the new secret.
mint_token() {
  local role="$1" label="$2" project="${3:-}"
  local payload
  if [ -n "$project" ]; then
    payload="{\"role\":\"$role\",\"label\":\"$label\",\"project\":\"$project\"}"
  else
    payload="{\"role\":\"$role\",\"label\":\"$label\"}"
  fi
  api POST /api/tokens "$ADMIN_TOKEN" "$payload" >/dev/null
  node -e 'const fs=require("fs");try{process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).secret||"")}catch{process.exit(0)}' "$HOSTDIR/.resp"
}

PROJECT="vdf-proj"
P2="vdf-proj2"

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

# ---------- seed project + per-role tokens ----------
step "seed project + mint per-role bearer tokens (human ADMIN_TOKEN mints the rest)"
STATUS="$(api POST /api/projects "$ADMIN_TOKEN" "{\"slug\":\"$PROJECT\",\"name\":\"vdf project\"}")"
[ "$STATUS" = "201" ] && ok "created project $PROJECT (201)" || fail "create project: status $STATUS"
STATUS="$(api POST /api/projects "$ADMIN_TOKEN" "{\"slug\":\"$P2\",\"name\":\"vdf project 2\"}")"
[ "$STATUS" = "201" ] && ok "created project $P2 (201)" || fail "create project2: status $STATUS"

HUMAN_TOK="$ADMIN_TOKEN"
IMPL_TOK="$(mint_token implementer vdf-impl)"
SELFCHECK_TOK="$(mint_token self-check vdf-selfcheck)"
JUDGE_TOK="$(mint_token judge vdf-judge)"
RUNNER_TOK="$(mint_token runner vdf-runner)"
for t in IMPL_TOK SELFCHECK_TOK JUDGE_TOK RUNNER_TOK; do
  [ -n "${!t}" ] && ok "minted $t" || fail "could not mint $t"
done

# ---------- (1) full per-role MCP lifecycle TODO -> DONE ----------
step "(1) full MCP lifecycle with per-role bearers: TODO -> ... -> DONE"
TKEY="VDF-LIFE-1"

# human creates the task with allow_no_code_change so the IMPLEMENTED guard passes.
mcp "$HUMAN_TOK" task.create \
  "{\"project\":\"$PROJECT\",\"key\":\"$TKEY\",\"title\":\"lifecycle\",\"allow_no_code_change\":true}" >/dev/null \
  && ok "human created $TKEY" || fail "human task.create failed"

# implementer claims a lease first (the gate's lease guard requires the actor to
# hold the lease for non-human/non-gate forward transitions).
mcp "$IMPL_TOK" task.claim "{\"project\":\"$PROJECT\",\"key\":\"$TKEY\"}" >/dev/null \
  && ok "implementer claimed $TKEY (lease)" || fail "implementer task.claim failed"

# implementer: TODO -> IN_PROGRESS
mcp "$IMPL_TOK" task.transition \
  "{\"project\":\"$PROJECT\",\"key\":\"$TKEY\",\"from\":\"TODO\",\"to\":\"IN_PROGRESS\"}" >/dev/null \
  && ok "implementer TODO->IN_PROGRESS" || fail "TODO->IN_PROGRESS failed"

# implementer: IN_PROGRESS -> IMPLEMENTED
mcp "$IMPL_TOK" task.transition \
  "{\"project\":\"$PROJECT\",\"key\":\"$TKEY\",\"from\":\"IN_PROGRESS\",\"to\":\"IMPLEMENTED\"}" >/dev/null \
  && ok "implementer IN_PROGRESS->IMPLEMENTED" || fail "IN_PROGRESS->IMPLEMENTED failed"

# runner: submit evidence (build/test/ac all 0 + manifest)
mcp "$RUNNER_TOK" evidence.submit \
  "{\"project\":\"$PROJECT\",\"key\":\"$TKEY\",\"build_exit\":0,\"test_exit\":0,\"ac_exit\":0,\"manifest_json\":\"{\\\"files\\\":[]}\"}" >/dev/null \
  && ok "runner evidence.submit (build/test/ac=0)" || fail "runner evidence.submit failed"

# self-check: IMPLEMENTED -> SELF_CHECK_PASSED (re-verifies evidence). The tool
# returns {success,reason}; assert the actual state read back is SELF_CHECK_PASSED.
mcp "$SELFCHECK_TOK" task.selfcheck "{\"project\":\"$PROJECT\",\"key\":\"$TKEY\"}" >/dev/null || fail "self-check call failed"
SC_STATE="$(task_state "$HUMAN_TOK" "$TKEY")"
[ "$SC_STATE" = "SELF_CHECK_PASSED" ] \
  && ok "self-check -> SELF_CHECK_PASSED (read back)" || fail "self-check did not reach SELF_CHECK_PASSED (got '$SC_STATE')"

# judge: must leave a verdict=PASS comment, then SELF_CHECK_PASSED -> JUDGE_PASSED
mcp "$JUDGE_TOK" comment.add \
  "{\"project\":\"$PROJECT\",\"key\":\"$TKEY\",\"kind\":\"verdict\",\"verdict\":\"PASS\",\"body_md\":\"VERDICT: PASS\"}" >/dev/null \
  && ok "judge added verdict=PASS comment" || fail "judge comment.add failed"
mcp "$JUDGE_TOK" task.transition \
  "{\"project\":\"$PROJECT\",\"key\":\"$TKEY\",\"from\":\"SELF_CHECK_PASSED\",\"to\":\"JUDGE_PASSED\"}" >/dev/null \
  && ok "judge SELF_CHECK_PASSED->JUDGE_PASSED" || fail "SELF_CHECK_PASSED->JUDGE_PASSED failed"

# human: approve JUDGE_PASSED -> DONE
mcp "$HUMAN_TOK" task.approve "{\"project\":\"$PROJECT\",\"key\":\"$TKEY\"}" >/dev/null \
  && ok "human approve JUDGE_PASSED->DONE" || fail "human approve failed"

# read final state back via task.get -> assert DONE
LIFE_STATE="$(mcp "$HUMAN_TOK" task.get "{\"project\":\"$PROJECT\",\"key\":\"$TKEY\"}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).state||"")}catch{}})')"
[ "$LIFE_STATE" = "DONE" ] && ok "task.get read back state=DONE" || fail "final state not DONE (got '$LIFE_STATE')"

# ---------- (2) role + gate enforcement (negative; assert isError) ----------
step "(2) role + gate enforcement — each must be REJECTED (isError / non-2xx)"
NKEY="VDF-NEG-1"
mcp "$HUMAN_TOK" task.create \
  "{\"project\":\"$PROJECT\",\"key\":\"$NKEY\",\"title\":\"neg\",\"allow_no_code_change\":true}" >/dev/null \
  && ok "created $NKEY for negative cases" || fail "could not create $NKEY"
mcp "$IMPL_TOK" task.claim "{\"project\":\"$PROJECT\",\"key\":\"$NKEY\"}" >/dev/null || fail "neg setup claim"
mcp "$IMPL_TOK" task.transition \
  "{\"project\":\"$PROJECT\",\"key\":\"$NKEY\",\"from\":\"TODO\",\"to\":\"IN_PROGRESS\"}" >/dev/null || fail "neg setup TODO->IN_PROGRESS"
mcp "$IMPL_TOK" task.transition \
  "{\"project\":\"$PROJECT\",\"key\":\"$NKEY\",\"from\":\"IN_PROGRESS\",\"to\":\"IMPLEMENTED\"}" >/dev/null || fail "neg setup IN_PROGRESS->IMPLEMENTED"

# 2a. implementer calling evidence.submit (runner-only) must be rejected.
OUT="$(mcp "$IMPL_TOK" evidence.submit \
  "{\"project\":\"$PROJECT\",\"key\":\"$NKEY\",\"build_exit\":0,\"test_exit\":0,\"ac_exit\":0,\"manifest_json\":\"{}\"}")"; RC=$?
if [ $RC -eq 2 ] && echo "$OUT" | grep -q 'ISERROR'; then
  ok "implementer evidence.submit REJECTED (isError)"
else
  fail "implementer evidence.submit NOT rejected (rc=$RC out=$OUT)"
fi

# 2b. skip transition IMPLEMENTED -> JUDGE_PASSED must be rejected.
OUT="$(mcp "$JUDGE_TOK" task.transition \
  "{\"project\":\"$PROJECT\",\"key\":\"$NKEY\",\"from\":\"IMPLEMENTED\",\"to\":\"JUDGE_PASSED\"}")"; RC=$?
if [ $RC -eq 2 ] && echo "$OUT" | grep -q 'ISERROR'; then
  ok "skip transition IMPLEMENTED->JUDGE_PASSED REJECTED (isError)"
else
  fail "skip transition NOT rejected (rc=$RC out=$OUT)"
fi

# 2c. ->JUDGE_PASSED with NO verdict=PASS comment must be rejected. Advance the
#     neg task to SELF_CHECK_PASSED first (runner evidence + self-check), then a
#     judge transition with no PASS comment present.
mcp "$RUNNER_TOK" evidence.submit \
  "{\"project\":\"$PROJECT\",\"key\":\"$NKEY\",\"build_exit\":0,\"test_exit\":0,\"ac_exit\":0,\"manifest_json\":\"{\\\"files\\\":[]}\"}" >/dev/null || fail "neg runner evidence.submit"
mcp "$SELFCHECK_TOK" task.selfcheck "{\"project\":\"$PROJECT\",\"key\":\"$NKEY\"}" >/dev/null || fail "neg self-check"
OUT="$(mcp "$JUDGE_TOK" task.transition \
  "{\"project\":\"$PROJECT\",\"key\":\"$NKEY\",\"from\":\"SELF_CHECK_PASSED\",\"to\":\"JUDGE_PASSED\"}")"; RC=$?
if [ $RC -eq 2 ] && echo "$OUT" | grep -q 'ISERROR'; then
  ok "->JUDGE_PASSED with no verdict=PASS comment REJECTED (isError)"
else
  fail "->JUDGE_PASSED without PASS comment NOT rejected (rc=$RC out=$OUT)"
fi

# 2d. non-human approve (judge ->DONE) must be rejected. Bring the neg task to
#     JUDGE_PASSED legitimately (judge PASS comment + transition), then have a
#     NON-human role attempt the approve.
mcp "$JUDGE_TOK" comment.add \
  "{\"project\":\"$PROJECT\",\"key\":\"$NKEY\",\"kind\":\"verdict\",\"verdict\":\"PASS\",\"body_md\":\"VERDICT: PASS\"}" >/dev/null || fail "neg judge PASS comment"
mcp "$JUDGE_TOK" task.transition \
  "{\"project\":\"$PROJECT\",\"key\":\"$NKEY\",\"from\":\"SELF_CHECK_PASSED\",\"to\":\"JUDGE_PASSED\"}" >/dev/null || fail "neg SELF_CHECK_PASSED->JUDGE_PASSED"
OUT="$(mcp "$JUDGE_TOK" task.approve "{\"project\":\"$PROJECT\",\"key\":\"$NKEY\"}")"; RC=$?
if [ $RC -eq 2 ] && echo "$OUT" | grep -q 'ISERROR'; then
  ok "non-human (judge) approve ->DONE REJECTED (isError)"
else
  fail "non-human approve NOT rejected (rc=$RC out=$OUT)"
fi

# ---------- (3) token lifecycle: revoke 200 -> 409 -> 401, project scope ----------
step "(3) token lifecycle — mint, revoke 200, repeat 409, revoked secret 401, project scope"
# Mint a fresh runner token and capture both id + secret.
api POST /api/tokens "$ADMIN_TOKEN" '{"role":"runner","label":"vdf-revoke-me"}' >/dev/null
REVOKE_ID="$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).id||"")' "$HOSTDIR/.resp")"
REVOKE_SECRET="$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).secret||"")' "$HOSTDIR/.resp")"
[ -n "$REVOKE_ID" ] && ok "minted revoke-me token id=$REVOKE_ID" || fail "mint revoke-me failed"

# The revoked secret works BEFORE revocation (positive control).
STATUS="$(api GET /api/projects "$REVOKE_SECRET")"
[ "$STATUS" = "200" ] && ok "revoke-me secret works before revoke (200)" || fail "revoke-me secret pre-revoke status $STATUS"

# DELETE /api/tokens/:id -> 200
STATUS="$(api DELETE "/api/tokens/$REVOKE_ID" "$ADMIN_TOKEN")"
[ "$STATUS" = "200" ] && ok "DELETE token -> 200 (revoke)" || fail "first DELETE status $STATUS (expected 200)"
# Repeat DELETE -> 409
STATUS="$(api DELETE "/api/tokens/$REVOKE_ID" "$ADMIN_TOKEN")"
[ "$STATUS" = "409" ] && ok "repeat DELETE -> 409 (already revoked)" || fail "repeat DELETE status $STATUS (expected 409)"
# Request with the revoked secret -> 401
STATUS="$(api GET /api/projects "$REVOKE_SECRET")"
[ "$STATUS" = "401" ] && ok "revoked secret -> 401" || fail "revoked secret status $STATUS (expected 401)"

# Project-scoped token (TASK-042): scoped to PROJECT, blocked acting on P2.
# Use a scoped HUMAN so the own-project create is a real scope positive control
# (implementer lacks task.create — that would 403 on authorization, not scope).
SCOPED_TOK="$(mint_token human vdf-scoped "$PROJECT")"
[ -n "$SCOPED_TOK" ] && ok "minted token scoped to $PROJECT" || fail "scoped mint failed"
# Positive control: scoped token can create a task in its OWN project.
STATUS="$(api POST /api/tasks "$SCOPED_TOK" "{\"project\":\"$PROJECT\",\"key\":\"VDF-SCOPE-OWN\",\"title\":\"own\"}")"
[ "$STATUS" = "201" ] && ok "scoped token creates in own project (201)" || fail "scoped own-project create status $STATUS"
# Blocked: same token acting on a DIFFERENT project -> 403.
STATUS="$(api POST /api/tasks "$SCOPED_TOK" "{\"project\":\"$P2\",\"key\":\"VDF-SCOPE-X\",\"title\":\"cross\"}")"
[ "$STATUS" = "403" ] && ok "scoped token BLOCKED on other project (403)" || fail "scoped cross-project status $STATUS (expected 403)"

# ---------- (4) SSE live transition event ----------
step "(4) SSE live — open /api/stream, drive a transition, assert transition event"
SKEY="VDF-SSE-1"
mcp "$HUMAN_TOK" task.create \
  "{\"project\":\"$PROJECT\",\"key\":\"$SKEY\",\"title\":\"sse\",\"allow_no_code_change\":true}" >/dev/null \
  && ok "created $SKEY" || fail "could not create $SKEY"
# Confirm the stream advertises text/event-stream.
SSE_HDR="$(curl -s -D - -o /dev/null -m 2 -H 'Accept: text/event-stream' "$BASE/api/stream" 2>/dev/null || true)"
echo "$SSE_HDR" | grep -qi 'content-type: *text/event-stream' \
  && ok "/api/stream Content-Type text/event-stream" || fail "/api/stream not text/event-stream"
# Open the SSE stream in node, drive a transition, assert the transition frame.
SSE_OUT="$(MCP_URL="$BASE/mcp" SSE_BASE="$BASE" SSE_PROJECT="$PROJECT" SSE_KEY="$SKEY" \
  SSE_IMPL="$IMPL_TOK" node - <<'EOF'
const base = process.env.SSE_BASE, project = process.env.SSE_PROJECT, key = process.env.SSE_KEY
const ctrl = new AbortController()
const res = await fetch(base + '/api/stream', { headers: { Accept: 'text/event-stream' }, signal: ctrl.signal })
if (!res.ok || !res.body) { console.log('SSE-CONNECT-FAIL ' + res.status); process.exit(1) }
const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
const events = []
;(async () => { try { for (;;) { const { done, value } = await reader.read(); if (done) break
  buf += dec.decode(value, { stream: true }); const parts = buf.split('\n\n'); buf = parts.pop()
  for (const p of parts) { let type='message', data=''; for (const ln of p.split('\n')) {
    if (ln.startsWith('event:')) type = ln.slice(6).trim(); else if (ln.startsWith('data:')) data += ln.slice(5).trim() }
    events.push({ type, data }) } } } catch {} })()
const waitFor = (cond, ms) => new Promise((resolve, reject) => { const s = Date.now()
  const t = () => cond() ? resolve() : (Date.now() - s > ms ? reject(new Error('timeout')) : setTimeout(t, 50)); t() })
await waitFor(() => events.some(e => e.type === 'connected'), 3000)
// Drive a transition via MCP (implementer claims TODO->IN_PROGRESS).
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
const transport = new StreamableHTTPClientTransport(new URL(process.env.MCP_URL), {
  requestInit: { headers: { Authorization: 'Bearer ' + process.env.SSE_IMPL } } })
const client = new Client({ name: 'sse-drive', version: '0.0.1' }); await client.connect(transport)
// Claim a lease first (gate lease guard), then drive the forward transition.
await client.callTool({ name: 'task.claim', arguments: { project, key } })
const r = await client.callTool({ name: 'task.transition', arguments: { project, key, from: 'TODO', to: 'IN_PROGRESS' } })
await client.close()
if (r.isError) { console.log('TRANSITION-FAIL'); ctrl.abort(); process.exit(1) }
try { await waitFor(() => events.some(e => e.type === 'transition' && e.data.includes(key)), 4000) }
catch { console.log('NO-TRANSITION-EVENT'); ctrl.abort(); process.exit(1) }
ctrl.abort()
console.log('SSE-TRANSITION-OK ' + key)
EOF
)"; RC=$?
if [ $RC -eq 0 ] && echo "$SSE_OUT" | grep -q "SSE-TRANSITION-OK $SKEY"; then
  ok "SSE transition event received for $SKEY"
else
  fail "SSE transition event not received (rc=$RC out=$SSE_OUT)"
fi

# ---------- (5) dependency gate (TASK-044) ----------
step "(5) dependency gate — B depends_on A: B blocked while A not DONE, allowed once A DONE"
AKEY="VDF-DEP-A"
BKEY="VDF-DEP-B"
mcp "$HUMAN_TOK" task.create \
  "{\"project\":\"$PROJECT\",\"key\":\"$AKEY\",\"title\":\"dep A\",\"allow_no_code_change\":true}" >/dev/null \
  && ok "created A=$AKEY" || fail "create A failed"
mcp "$HUMAN_TOK" task.create \
  "{\"project\":\"$PROJECT\",\"key\":\"$BKEY\",\"title\":\"dep B\",\"allow_no_code_change\":true,\"depends_on\":[\"$AKEY\"]}" >/dev/null \
  && ok "created B=$BKEY depends_on [$AKEY]" || fail "create B failed"
# Confirm depends_on is persisted + read back.
DEP_READ="$(mcp "$HUMAN_TOK" task.get "{\"project\":\"$PROJECT\",\"key\":\"$BKEY\"}")"
echo "$DEP_READ" | grep -q "\"$AKEY\"" \
  && ok "B.depends_on read back contains $AKEY" || fail "B.depends_on missing $AKEY: $DEP_READ"

# B's claim is BLOCKED while A is not DONE (the gate guards claim on unmet deps).
OUT="$(mcp "$IMPL_TOK" task.claim "{\"project\":\"$PROJECT\",\"key\":\"$BKEY\"}")"; RC=$?
if [ $RC -eq 2 ] && echo "$OUT" | grep -q 'ISERROR' && echo "$OUT" | grep -q "$AKEY"; then
  ok "B claim BLOCKED while A not DONE (isError, names $AKEY)"
else
  fail "B claim NOT blocked (rc=$RC out=$OUT)"
fi

# Drive A all the way to DONE through the real lifecycle.
mcp "$IMPL_TOK" task.claim "{\"project\":\"$PROJECT\",\"key\":\"$AKEY\"}" >/dev/null || fail "A claim"
mcp "$IMPL_TOK" task.transition "{\"project\":\"$PROJECT\",\"key\":\"$AKEY\",\"from\":\"TODO\",\"to\":\"IN_PROGRESS\"}" >/dev/null || fail "A TODO->IN_PROGRESS"
mcp "$IMPL_TOK" task.transition "{\"project\":\"$PROJECT\",\"key\":\"$AKEY\",\"from\":\"IN_PROGRESS\",\"to\":\"IMPLEMENTED\"}" >/dev/null || fail "A IN_PROGRESS->IMPLEMENTED"
mcp "$RUNNER_TOK" evidence.submit "{\"project\":\"$PROJECT\",\"key\":\"$AKEY\",\"build_exit\":0,\"test_exit\":0,\"ac_exit\":0,\"manifest_json\":\"{\\\"files\\\":[]}\"}" >/dev/null || fail "A evidence.submit"
mcp "$SELFCHECK_TOK" task.selfcheck "{\"project\":\"$PROJECT\",\"key\":\"$AKEY\"}" >/dev/null || fail "A self-check"
mcp "$JUDGE_TOK" comment.add "{\"project\":\"$PROJECT\",\"key\":\"$AKEY\",\"kind\":\"verdict\",\"verdict\":\"PASS\",\"body_md\":\"VERDICT: PASS\"}" >/dev/null || fail "A judge PASS comment"
mcp "$JUDGE_TOK" task.transition "{\"project\":\"$PROJECT\",\"key\":\"$AKEY\",\"from\":\"SELF_CHECK_PASSED\",\"to\":\"JUDGE_PASSED\"}" >/dev/null || fail "A ->JUDGE_PASSED"
mcp "$HUMAN_TOK" task.approve "{\"project\":\"$PROJECT\",\"key\":\"$AKEY\"}" >/dev/null || fail "A approve"
A_STATE="$(mcp "$HUMAN_TOK" task.get "{\"project\":\"$PROJECT\",\"key\":\"$AKEY\"}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).state||"")}catch{}})')"
[ "$A_STATE" = "DONE" ] && ok "A reached DONE" || fail "A not DONE (got '$A_STATE')"

# Now B's claim is ALLOWED (positive control).
mcp "$IMPL_TOK" task.claim "{\"project\":\"$PROJECT\",\"key\":\"$BKEY\"}" >/dev/null \
  && ok "B claim ALLOWED once A is DONE" || fail "B claim still blocked after A DONE"

# ---------- (6) UI / a11y smoke ----------
step "(6) UI / a11y — static 200 + axe (WCAG A/AA) zero violations"
STATUS="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/signin.html")"
[ "$STATUS" = "200" ] && ok "signin.html served 200" || fail "signin.html status $STATUS"
STATUS="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/$PROJECT/index.html")"
[ "$STATUS" = "200" ] && ok "board page served 200" || fail "board page status $STATUS"

# axe scan (board, workflow, tokens). A missing browser is a visible skip.
# Seed the human ADMIN_TOKEN so the app shell authenticates instead of bouncing
# to signin (a redirect mid-scan would destroy the page context).
AXE_OUT="$(node "$AXE" "$BASE" "$PROJECT" "$ADMIN_TOKEN" 2>&1)"; AXE_RC=$?
echo "$AXE_OUT" | sed 's/^/    axe: /'
if [ $AXE_RC -eq 0 ]; then
  ok "axe WCAG A/AA: zero violations on board, workflow, tokens"
elif [ $AXE_RC -eq 4 ]; then
  echo "skip: no browser available for axe scan — a11y sub-step skipped (static 200 checks still ran)"
else
  fail "axe found WCAG A/AA violations (see axe: lines above)"
fi

# ---------- summary ----------
if [ "$FAIL" -eq 0 ]; then
  echo "VERIFY-DOCKER-FEATURES: ALL CHECKS PASSED"
  exit 0
fi
echo "VERIFY-DOCKER-FEATURES: FAILED"
exit 1
