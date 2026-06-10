#!/usr/bin/env bash
# Machine-verifiable Acceptance Criteria for TASK-007 (P5: MCP server, Streamable HTTP).
# Exit 0 = tất cả AC đạt; non-zero = fail. Faithful to docs/phases/P5.md.
# Will exit 1 until P5 is implemented — that is the target.
#
# QUAN TRỌNG — chạy trong WORKTREE: runner export AI_WT_<REPO> trỏ vào worktree chứa code task.
#   repo '.'      -> ${AI_WT_ROOT:-$ROOT}
# Luôn neo qua biến này; KHÔNG hard-code path. Build/test do gate+run-evidence lo (na nếu chưa có project).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"   # .ai/tasks/<ID> -> repo root
cd "${AI_WT_ROOT:-$ROOT}"

fail() { echo "AC FAIL: $*" >&2; exit 1; }

SRV="server/src/mcp/server.ts"
ERR="server/src/mcp/errors.ts"
TOOLS="server/src/mcp/tools"

# AC3: required modules/dir exist.
[ -f "$SRV" ]  || fail "missing $SRV"
[ -f "$ERR" ]  || fail "missing $ERR"
[ -d "$TOOLS" ] || fail "missing dir $TOOLS"

# All mcp sources, for cross-file grepping of tool registration.
mcp_src=$(grep -rEl '.' server/src/mcp --include='*.ts' 2>/dev/null || true)
[ -n "$mcp_src" ] || fail "no .ts sources under server/src/mcp"

# AC4: SDK + Streamable HTTP transport, /mcp route, bearer auth.
grep -rEq '@modelcontextprotocol/sdk' server/src/mcp || fail "no @modelcontextprotocol/sdk import"
grep -rEqi 'streamable' server/src/mcp || fail "no Streamable HTTP transport reference"
grep -rEq '/mcp' server/src/mcp || fail "no '/mcp' route"
grep -rEqi 'bearer|authorization' server/src/mcp || fail "no bearer auth reference"

# AC5: node:http, NO web framework imported in mcp sources.
grep -rEq "node:http|require\(['\"]http['\"]\)|from ['\"]http['\"]" server/src/mcp \
  || fail "server not built on node:http"
if grep -rEq "from ['\"](express|fastify|koa|@hapi/hapi|hapi)['\"]" server/src/mcp; then
  fail "a web framework is imported in mcp sources (must stay on node:http)"
fi
# And no framework declared as a dependency.
if [ -f package.json ]; then
  if grep -Eq '"(express|fastify|koa|@hapi/hapi|hapi)"[[:space:]]*:' package.json; then
    fail "a web framework is declared in package.json dependencies"
  fi
fi

# AC6: zod used for tool input schemas.
grep -rEq "from ['\"]zod['\"]|require\(['\"]zod['\"]\)" "$TOOLS" || fail "zod not imported in $TOOLS"

# AC7: every read + write tool from TASK_HUB_DESIGN.md §6 is registered (name appears in mcp sources).
tools="project.list project.create task.list task.get task.next comment.list evidence.get gitref.list \
task.create task.claim task.heartbeat task.release task.transition gitref.set comment.add \
evidence.submit task.selfcheck task.approve"
for t in $tools; do
  grep -rFq "$t" server/src/mcp || fail "tool not registered: $t"
done

# --- Integration tests. ---
itest=$(grep -rEl '@modelcontextprotocol/sdk|/mcp|StreamableHTTP' server/src --include='*.test.ts' --include='*.spec.ts' 2>/dev/null || true)
[ -n "$itest" ] || fail "no MCP integration test found"

# AC11: no skipped tests.
grep -REq '\b(it|test|describe)\.skip\b' $itest && fail "skipped tests present in mcp integration tests"

# AC8: connect with bearer over Streamable HTTP.
grep -Eqi 'bearer|authorization' $itest || fail "no test connecting with a bearer token"

# AC9: full happy-path lifecycle across states.
for st in IN_PROGRESS IMPLEMENTED SELF_CHECK_PASSED JUDGE_PASSED; do
  grep -Fq "$st" $itest || fail "happy-path test missing state: $st"
done

# AC10: implementer token calling evidence.submit -> role error.
grep -Eqi 'implementer' $itest || fail "no test for implementer-role rejection"
grep -Fq 'evidence.submit' $itest || fail "no test invoking evidence.submit for role rejection"

echo "TASK-007 machine AC: PASS"
exit 0
