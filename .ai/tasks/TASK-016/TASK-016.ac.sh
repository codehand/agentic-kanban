#!/usr/bin/env bash
# Machine-verifiable Acceptance Criteria cho TASK-016. Exit 0 = tất cả AC đạt; non-zero = fail.
#
# QUAN TRỌNG — chạy trong WORKTREE: runner export AI_WT_<REPO> trỏ vào worktree chứa code task.
#   repo '.' -> ${AI_WT_ROOT:-$ROOT}
# Luôn neo qua biến này (fallback checkout chính để chạy tay vẫn được); KHÔNG hard-code path.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"   # .ai/tasks/<ID> -> repo root
cd "${AI_WT_ROOT:-$ROOT}"

fail=0
ok()   { echo "  ok   - $1"; }
bad()  { echo "  FAIL - $1"; fail=1; }

# AC3: floor 13px — không còn cỡ chữ <=12px trong design-system/*.html
echo "AC3: floor 13px trong design-system/*.html"
small="$(grep -rhoE 'text-\[(9|10|11|12)(\.5)?px\]' design-system/*.html 2>/dev/null | sort -u)"
if [ -n "$small" ]; then
  bad "còn cỡ <=12px: $(echo "$small" | tr '\n' ' ')"
else
  ok "không còn text-[<=12px]"
fi

# AC4: Playwright runner tồn tại (dependency + script test:ui + spec có assert)
echo "AC4: Playwright runner"
grep -q '"@playwright/test"' package.json            && ok "@playwright/test trong package.json" || bad "thiếu @playwright/test trong package.json"
grep -qE '"test:ui"[[:space:]]*:' package.json        && ok "script test:ui"                       || bad "thiếu script test:ui"
spec="tests/ui/font-size.spec.ts"
if [ -f "$spec" ]; then
  ok "spec tồn tại: $spec"
  grep -q 'font-size' "$spec"        && ok "spec đọc font-size"     || bad "spec không tham chiếu font-size"
  grep -qE '>=[[:space:]]*13|13\b'   "$spec" && ok "spec assert >= 13" || bad "spec không assert ngưỡng 13"
else
  bad "thiếu spec $spec"
fi

# AC5: ảnh bắt buộc trong docs/ui/TASK-016/ (>=4 png, gồm menu/cta/font)
echo "AC5: screenshots docs/ui/TASK-016/"
shotdir="docs/ui/TASK-016"
if [ -d "$shotdir" ]; then
  n="$(find "$shotdir" -maxdepth 1 -type f -name '*.png' | wc -l | tr -d ' ')"
  [ "$n" -ge 4 ] && ok "$n ảnh png (>=4)" || bad "chỉ có $n ảnh png (<4)"
  for kw in menu cta font; do
    if ls "$shotdir"/*"$kw"*.png >/dev/null 2>&1; then ok "có ảnh *$kw*.png"; else bad "thiếu ảnh *$kw*.png"; fi
  done
else
  bad "thiếu thư mục $shotdir"
fi

# AC6: tài liệu core docs/ui/font-size.md
echo "AC6: docs/ui/font-size.md"
doc="docs/ui/font-size.md"
if [ -f "$doc" ]; then
  ok "doc tồn tại"
  grep -q 'docs/ui/TASK-016\|TASK-016/' "$doc" && ok "doc tham chiếu docs/ui/TASK-016/" || bad "doc không tham chiếu docs/ui/TASK-016/"
else
  bad "thiếu $doc"
fi

echo
[ "$fail" -eq 0 ] && { echo "ALL MACHINE AC PASS"; exit 0; } || { echo "MACHINE AC FAILED"; exit 1; }
