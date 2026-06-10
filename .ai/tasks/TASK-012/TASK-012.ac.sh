#!/usr/bin/env bash
# Machine-verifiable Acceptance Criteria. Exit 0 = tất cả AC đạt; non-zero = fail.
#
# QUAN TRỌNG — chạy trong WORKTREE: runner export AI_WT_<REPO> trỏ vào worktree chứa code task.
#   repo '.'      -> ${AI_WT_ROOT:-$ROOT}
# Luôn neo qua biến này (fallback checkout chính để chạy tay vẫn được); KHÔNG hard-code path.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"   # .ai/tasks/<ID> -> repo root
cd "${AI_WT_ROOT:-$ROOT}"

f="docs/README.md"
# AC3: file đích tồn tại và không rỗng (chất lượng bản dịch do Judge/Human chấm — AC4/AC5).
[ -f "$f" ] || { echo "AC FAIL: $f không tồn tại"; exit 1; }
[ -s "$f" ] || { echo "AC FAIL: $f rỗng"; exit 1; }
echo "AC OK: $f tồn tại và không rỗng ($(wc -l < "$f" | tr -d ' ') dòng)"
exit 0
