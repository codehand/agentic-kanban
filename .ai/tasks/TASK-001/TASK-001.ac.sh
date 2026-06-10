#!/usr/bin/env bash
# Machine-verifiable AC cho TASK-001 (task tài liệu).
# Exit 0 = tất cả AC đạt; non-zero = fail.
#
# Chạy trong WORKTREE: runner export AI_WT_<REPO> trỏ vào worktree chứa code task.
#   repo '.' -> ${AI_WT_ROOT:-$ROOT}.  Luôn neo qua biến này, KHÔNG hard-code path.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"   # .ai/tasks/<ID> -> repo root
cd "${AI_WT_ROOT:-$ROOT}"

PH="docs/phases"
fail=0

# 7 section bắt buộc trong mỗi P<n>.md (đúng tiêu đề trong spec)
req=(
  "## Mục tiêu"
  "## Phạm vi"
  "## Module & file"
  "## Task checklist"
  "## Acceptance criteria"
  "## Ánh xạ design"
  "## Phụ thuộc & rủi ro"
)

# AC1 + AC2 + AC3: 10 file phase, đủ section, có ref design, không còn placeholder
for n in 0 1 2 3 4 5 6 7 8 9; do
  f="$PH/P$n.md"
  if [ ! -f "$f" ]; then echo "MISSING file: $f"; fail=1; continue; fi
  for h in "${req[@]}"; do
    grep -qF "$h" "$f" || { echo "MISSING section '$h' in $f"; fail=1; }
  done
  grep -qE 'TASK_HUB_DESIGN|IMPLEMENTATION_PLAN' "$f" || { echo "NO design reference in $f"; fail=1; }
  grep -qF '<…>' "$f" && { echo "PLACEHOLDER '<…>' left in $f"; fail=1; }
done

# AC4: index
[ -f "$PH/README.md" ] || { echo "MISSING index: $PH/README.md"; fail=1; }

if [ "$fail" -eq 0 ]; then
  echo "AC OK: 10 phase specs (P0..P9) present with all required sections + design refs + index"
  exit 0
else
  echo "AC FAILED"
  exit 1
fi
