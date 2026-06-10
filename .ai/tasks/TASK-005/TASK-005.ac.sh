#!/usr/bin/env bash
# Machine-verifiable AC for TASK-005 (P3: State machine & Gate).
# Exit 0 = all AC met; non-zero = fail. Faithful to docs/phases/P3.md + TASK_HUB_DESIGN.md §5.
#
# Runs in WORKTREE: runner exports AI_WT_<REPO> pointing at the worktree with task code.
#   repo '.' -> ${AI_WT_ROOT:-$ROOT}. Always anchor via this var, never hard-code path.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"   # .ai/tasks/<ID> -> repo root
cd "${AI_WT_ROOT:-$ROOT}"

DOM="server/src/domain"
fail=0

# AC1: required domain modules exist.
for f in statemachine.ts gate.ts guards.ts; do
  [ -f "$DOM/$f" ] || { echo "MISSING module: $DOM/$f"; fail=1; }
done

# AC2: ALLOWED table encodes the full §5 transition set + roles.
SM="$DOM/statemachine.ts"
if [ -f "$SM" ]; then
  grep -qE 'ALLOWED' "$SM" || { echo "AC2: no ALLOWED table in statemachine.ts"; fail=1; }
  for st in TODO IN_PROGRESS IMPLEMENTED SELF_CHECK_PASSED SELF_CHECK_FAILED JUDGE_PASSED JUDGE_REJECTED DONE; do
    grep -qF "$st" "$SM" || { echo "AC2: state '$st' missing in statemachine.ts"; fail=1; }
  done
  for r in implementer self-check judge human; do
    grep -qF "$r" "$SM" || { echo "AC2: role '$r' missing in statemachine.ts"; fail=1; }
  done
fi

# AC5/AC6: guards present for gitref head>base / allow_no_code_change and verdict.
G="$DOM/guards.ts"
if [ -f "$G" ]; then
  grep -qE 'head_sha|base_sha' "$G" || { echo "AC5: gitref head/base guard not referenced in guards.ts"; fail=1; }
  grep -qE 'allow_no_code_change' "$G" || { echo "AC5: allow_no_code_change not referenced in guards.ts"; fail=1; }
  grep -qiE 'verdict' "$G" || { echo "AC6: verdict guard not referenced in guards.ts"; fail=1; }
fi

# AC3/AC4/AC5/AC6/AC7: tests cover skip, wrong-role, gitref guard, verdict guard, non-human ->DONE.
GATE_TESTS="$(grep -rlE 'propose|ALLOWED|JUDGE_PASSED|IMPLEMENTED|transition' server --include='*.test.ts' 2>/dev/null || true)"
[ -n "$GATE_TESTS" ] || { echo "AC3-7: no gate/state-machine tests (*.test.ts) found"; fail=1; }
if [ -n "$GATE_TESTS" ]; then
  grep -rqiE 'skip|nhảy|jump|IMPLEMENTED.*JUDGE_PASSED' $GATE_TESTS || { echo "AC3: no skip-transition reject test"; fail=1; }
  grep -rqiE 'role' $GATE_TESTS || { echo "AC4: no wrong-role reject test"; fail=1; }
  grep -rqE 'allow_no_code_change|head_sha|base_sha' $GATE_TESTS || { echo "AC5: no gitref/->IMPLEMENTED guard test"; fail=1; }
  grep -rqiE 'verdict' $GATE_TESTS || { echo "AC6: no verdict-guard reject test"; fail=1; }
  grep -rqE 'DONE' $GATE_TESTS || { echo "AC7: no ->DONE non-human reject test"; fail=1; }
fi

if [ "$fail" -eq 0 ]; then
  echo "AC OK: P3 statemachine/gate/guards modules + ALLOWED table + guards + reject/happy-path tests present"
  exit 0
else
  echo "AC FAILED (TASK-005 not yet implemented — expected until P3 is built)"
  exit 1
fi
