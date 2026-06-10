#!/usr/bin/env bash
# Machine-verifiable Acceptance Criteria cho TASK-020. Exit 0 = tất cả AC đạt; non-zero = fail.
#
# QUAN TRỌNG — chạy trong WORKTREE: runner export AI_WT_<REPO> trỏ vào worktree chứa code task.
#   repo '.' -> ${AI_WT_ROOT:-$ROOT}
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"   # .ai/tasks/<ID> -> repo root
cd "${AI_WT_ROOT:-$ROOT}"

fail=0
ok()  { echo "  ok   - $1"; }
bad() { echo "  FAIL - $1"; fail=1; }

SH="design-system/shell.js"

# AC3: đã gỡ switcher khỏi shell.js
echo "AC3: gỡ screen-switcher"
if [ -f "$SH" ]; then
  rm=0
  for pat in 'sw-btn' 'sw-panel' 'Prototype screens'; do
    if grep -q "$pat" "$SH"; then bad "vẫn còn '$pat' trong shell.js"; rm=1; fi
  done
  [ "$rm" -eq 0 ] && ok "không còn dấu vết switcher (sw-btn/sw-panel/Prototype screens)"
else
  bad "thiếu $SH"
fi

# AC4: left rail giữ lại
echo "AC4: rail còn nguyên"
grep -q "getElementById('rail')" "$SH" 2>/dev/null && ok "vẫn inject rail" || bad "shell.js mất phần rail (xoá nhầm)"

# AC5: Playwright spec
echo "AC5: Playwright spec"
SPEC="tests/ui/remove-screens.spec.ts"
if [ -f "$SPEC" ]; then
  ok "spec tồn tại"
  grep -qE 'sw-btn|Screens' "$SPEC" && ok "spec tham chiếu nút Screens/#sw-btn" || bad "spec không tham chiếu nút Screens"
  grep -qiE 'toHaveCount\(0\)|not\.|toBeHidden|count\(\)|\b0\b' "$SPEC" && ok "spec assert vắng mặt" || bad "spec chưa assert nút đã biến mất"
else
  bad "thiếu $SPEC"
fi

# AC6: screenshots before/after
echo "AC6: screenshots"
SHOT="docs/ui/TASK-020"
if [ -d "$SHOT" ]; then
  n="$(find "$SHOT" -maxdepth 1 -type f -name '*.png' | wc -l | tr -d ' ')"
  [ "$n" -ge 2 ] && ok "$n ảnh png (>=2)" || bad "chỉ $n ảnh png (<2)"
  for kw in before after; do
    ls "$SHOT"/*"$kw"*.png >/dev/null 2>&1 && ok "có ảnh *$kw*.png" || bad "thiếu ảnh *$kw*.png"
  done
else
  bad "thiếu thư mục $SHOT"
fi

echo
[ "$fail" -eq 0 ] && { echo "ALL MACHINE AC PASS"; exit 0; } || { echo "MACHINE AC FAILED"; exit 1; }
