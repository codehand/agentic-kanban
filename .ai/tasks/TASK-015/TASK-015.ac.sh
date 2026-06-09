#!/usr/bin/env bash
# Machine-verifiable Acceptance Criteria. Exit 0 = tất cả AC đạt; non-zero = fail.
# VIẾT KIỂM TRA THẬT vào đây. Mặc định fail để buộc tác giả định nghĩa AC.
#
# QUAN TRỌNG — chạy trong WORKTREE: runner export AI_WT_<REPO> trỏ vào worktree chứa code task.
#   repo '.'      -> ${AI_WT_ROOT:-$ROOT}
# Luôn neo qua biến này (fallback checkout chính để chạy tay vẫn được); KHÔNG hard-code path.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"   # .ai/tasks/<ID> -> repo root
cd "${AI_WT_ROOT:-$ROOT}"

fail=0

# AC3a: không còn export public updateTaskState (đường ghi state bỏ qua gate đã bị đóng).
if grep -Eq '^[[:space:]]*export[[:space:]]+function[[:space:]]+updateTaskState' server/src/db/repositories/task.ts 2>/dev/null; then
  echo "AC FAIL: updateTaskState vẫn được export khỏi task.ts (còn đường ghi state bỏ qua gate)"; fail=1
fi

# AC3b: gate.test.ts có test cho cả SELF_CHECK_PASSED và SELF_CHECK_FAILED.
grep -q 'SELF_CHECK_PASSED' server/test/gate.test.ts 2>/dev/null || { echo "AC FAIL: thiếu test SELF_CHECK_PASSED trong gate.test.ts"; fail=1; }
grep -q 'SELF_CHECK_FAILED' server/test/gate.test.ts 2>/dev/null || { echo "AC FAIL: thiếu test SELF_CHECK_FAILED trong gate.test.ts"; fail=1; }

[ "$fail" -eq 0 ] || exit 1
echo "AC OK: updateTaskState không còn export; gate.test.ts cover SELF_CHECK_PASSED + SELF_CHECK_FAILED"
exit 0
