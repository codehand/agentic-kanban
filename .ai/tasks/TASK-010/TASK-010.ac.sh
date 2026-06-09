#!/usr/bin/env bash
# Machine-verifiable AC for TASK-010 (P8: .ai engine as thin client).
# Exit 0 = all AC met; non-zero = fail. Faithful to docs/phases/P8.md + TASK_HUB_DESIGN.md §12.
#
# Runs in WORKTREE: runner exports AI_WT_<REPO> pointing at the worktree with task code.
#   repo '.' -> ${AI_WT_ROOT:-$ROOT}. Always anchor via this var, never hard-code path.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"   # .ai/tasks/<ID> -> repo root
cd "${AI_WT_ROOT:-$ROOT}"

fail=0

GATE=".ai/scripts/gate.sh"
RUNEV=".ai/scripts/run-evidence.sh"
NEWTASK=".ai/scripts/new-task.sh"

for f in "$GATE" "$RUNEV" "$NEWTASK"; do
  [ -f "$f" ] || { echo "MISSING engine script: $f"; fail=1; }
done

# AC3: a reusable MCP/HTTP client helper exists under .ai/scripts/ talking to the server.
client="$(ls .ai/scripts/ 2>/dev/null | grep -Ei 'mcp|client' | head -1)"
if [ -z "$client" ]; then
  echo "AC3: no MCP/HTTP client helper under .ai/scripts/ (expected e.g. mcp-client.sh)"; fail=1
else
  CLIENT=".ai/scripts/$client"
  grep -Eiq 'TASK_HUB_URL|SERVER_URL|MCP_URL|BASE_URL|/mcp' "$CLIENT" \
    || { echo "AC3: client helper does not reference a server base URL"; fail=1; }
  grep -Eiq 'AUTHORIZATION|BEARER|TOKEN' "$CLIENT" \
    || { echo "AC3: client helper does not reference a bearer token"; fail=1; }
fi

# AC4: gate.sh maps propose/selfcheck/approve -> task.transition/task.selfcheck/task.approve.
if [ -f "$GATE" ]; then
  grep -qF 'task.transition' "$GATE" || { echo "AC4: gate.sh missing task.transition tool"; fail=1; }
  grep -qF 'task.selfcheck'  "$GATE" || { echo "AC4: gate.sh missing task.selfcheck tool"; fail=1; }
  grep -qF 'task.approve'    "$GATE" || { echo "AC4: gate.sh missing task.approve tool"; fail=1; }
  grep -qF 'propose'   "$GATE" || { echo "AC4: gate.sh missing propose subcommand"; fail=1; }
  grep -qF 'selfcheck' "$GATE" || { echo "AC4: gate.sh missing selfcheck subcommand"; fail=1; }
  grep -qF 'approve'   "$GATE" || { echo "AC4: gate.sh missing approve subcommand"; fail=1; }
fi

# AC5: run-evidence.sh submits via evidence.submit with a runner token, still builds/tests locally.
if [ -f "$RUNEV" ]; then
  grep -qF 'evidence.submit' "$RUNEV" || { echo "AC5: run-evidence.sh missing evidence.submit tool"; fail=1; }
  grep -EiqF 'RUNNER' "$RUNEV" || { echo "AC5: run-evidence.sh missing runner-token reference"; fail=1; }
  grep -EqF 'package.json' "$RUNEV" || grep -EqF 'pnpm' "$RUNEV" \
    || { echo "AC5: run-evidence.sh no longer builds/tests locally"; fail=1; }
fi

# AC6: new-task.sh maps to task.create.
if [ -f "$NEWTASK" ]; then
  grep -qF 'task.create' "$NEWTASK" || { echo "AC6: new-task.sh missing task.create tool"; fail=1; }
fi

# AC7: gitref.set referenced from engine scripts (mapping local gitref to server).
grep -rqF 'gitref.set' .ai/scripts/ || { echo "AC7: gitref.set not referenced in .ai/scripts/"; fail=1; }

# AC8: an integration test for the thin-client -> server path exists.
INTEG="$(grep -rlEi 'thin|engine|gate\.sh|run-evidence|new-task|cli' server --include='*.test.ts' 2>/dev/null || true)"
[ -n "$INTEG" ] || { echo "AC8: no thin-client/engine integration test (*.test.ts) under server/"; fail=1; }

if [ "$fail" -eq 0 ]; then
  echo "AC OK: P8 engine scripts wired as thin clients (mcp client + transition/selfcheck/approve/evidence.submit/task.create/gitref.set) + integration test present"
  exit 0
else
  echo "AC FAILED (TASK-010 not yet implemented — expected until P8 is built)"
  exit 1
fi
