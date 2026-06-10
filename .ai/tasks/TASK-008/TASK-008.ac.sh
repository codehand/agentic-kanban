#!/usr/bin/env bash
# Machine-verifiable AC cho TASK-008 (P6 — Concurrency: claim / lease / heartbeat).
# Exit 0 = tất cả AC đạt; non-zero = fail. Hiện exit 1 vì phase chưa implement (đúng target).
#
# QUAN TRỌNG — chạy trong WORKTREE: runner export AI_WT_<REPO> trỏ vào worktree chứa code task.
#   repo '.' -> ${AI_WT_ROOT:-$ROOT}.  Luôn neo qua biến này, KHÔNG hard-code path.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"   # .ai/tasks/<ID> -> repo root
cd "${AI_WT_ROOT:-$ROOT}"

fail=0

# AC3: lease domain module tồn tại + export claim/heartbeat/release + transaction SQLite
LEASE="server/src/domain/lease.ts"
if [ ! -f "$LEASE" ]; then
  echo "MISSING: $LEASE"; fail=1
else
  for fn in claim heartbeat release; do
    grep -qE "\b${fn}\b" "$LEASE" || { echo "MISSING lease fn '$fn' in $LEASE"; fail=1; }
  done
  grep -qiE 'transaction|begin[[:space:]]+(immediate|exclusive)' "$LEASE" \
    || { echo "NO SQLite transaction in $LEASE"; fail=1; }
fi

# AC4: config có lease TTL + heartbeat interval
CFG="server/src/config/index.ts"
if [ ! -f "$CFG" ]; then
  echo "MISSING: $CFG"; fail=1
else
  grep -qiE 'lease' "$CFG"     || { echo "NO lease TTL config in $CFG"; fail=1; }
  grep -qiE 'heartbeat' "$CFG" || { echo "NO heartbeat interval config in $CFG"; fail=1; }
fi

# AC5: gate guard "caller giữ lease" cho transition non-human/non-gate
GATE="server/src/domain/gate.ts"
if [ ! -f "$GATE" ]; then
  echo "MISSING: $GATE"; fail=1
else
  grep -qiE 'lease' "$GATE" || { echo "NO lease guard in $GATE"; fail=1; }
fi

# AC6: test lease cover claim / expiry / transition-without-lease
LEASE_TEST="$(grep -rlE 'lease|claim|heartbeat' server --include='*.test.ts' --include='*.spec.ts' 2>/dev/null | head -1)"
if [ -z "$LEASE_TEST" ]; then
  echo "MISSING lease test file (server/**/*.test.ts|*.spec.ts referencing lease/claim/heartbeat)"; fail=1
else
  grep -qiE 'claim'                         "$LEASE_TEST" || { echo "test missing claim case in $LEASE_TEST"; fail=1; }
  grep -qiE 'expir|lease_until|lease until'  "$LEASE_TEST" || { echo "test missing expiry case in $LEASE_TEST"; fail=1; }
  grep -qiE 'transition'                     "$LEASE_TEST" || { echo "test missing transition-without-lease case in $LEASE_TEST"; fail=1; }
fi

if [ "$fail" -eq 0 ]; then
  echo "AC OK: lease module + config TTL/heartbeat + gate lease-guard + lease tests present"
  exit 0
else
  echo "AC FAILED"
  exit 1
fi
