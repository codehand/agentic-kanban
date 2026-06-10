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

f="TASK-006.ac.sh"
# AC3: file lạc chỗ ở root không còn tồn tại VÀ không còn được git track.
[ ! -e "$f" ] || { echo "AC FAIL: $f vẫn còn ở root"; exit 1; }
if git rev-parse --git-dir >/dev/null 2>&1; then
  tracked="$(git ls-files -- "$f")"
  [ -z "$tracked" ] || { echo "AC FAIL: $f vẫn được git track"; exit 1; }
fi
echo "AC OK: $f đã được gỡ khỏi root và khỏi git tracking"
exit 0
