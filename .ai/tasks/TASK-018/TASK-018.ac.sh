#!/usr/bin/env bash
# Machine-verifiable Acceptance Criteria cho TASK-018. Exit 0 = tất cả AC đạt; non-zero = fail.
#
# QUAN TRỌNG — chạy trong WORKTREE: runner export AI_WT_<REPO> trỏ vào worktree chứa code task.
#   repo '.' -> ${AI_WT_ROOT:-$ROOT}
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"   # .ai/tasks/<ID> -> repo root
cd "${AI_WT_ROOT:-$ROOT}"

fail=0
ok()  { echo "  ok   - $1"; }
bad() { echo "  FAIL - $1"; fail=1; }
has() { [ -f "$1" ]; }

TJS="design-system/theme.js"
TCSS="design-system/theme.css"
IDX="design-system/index.html"

# AC3: CTA được wire (id trên nút + handler classList + localStorage trong theme.js)
echo "AC3: CTA wired"
if has "$IDX" && grep -A2 'Toggle theme' "$IDX" | grep -q 'id='; then ok "nút toggle có id"; else bad "nút Toggle theme chưa có id"; fi
if has "$TJS"; then
  grep -q 'classList' "$TJS"    && ok "theme.js dùng classList"   || bad "theme.js không có classList toggle"
  grep -q 'localStorage' "$TJS" && ok "theme.js persist localStorage" || bad "theme.js không persist localStorage"
else
  bad "thiếu $TJS"
fi

# AC4: hai palette qua CSS var
echo "AC4: CSS var palettes"
if has "$TCSS"; then
  grep -qE ':root' "$TCSS"                   && ok "có :root tokens"      || bad "theme.css thiếu :root tokens"
  grep -qE 'html\.dark|\.dark[[:space:]]*\{' "$TCSS" && ok "có html.dark/.dark tokens" || bad "theme.css thiếu khối .dark"
  grep -qE '\-\-bg' "$TCSS"                  && ok "định nghĩa biến --bg" || bad "theme.css thiếu biến --bg"
else
  bad "thiếu $TCSS"
fi
has "$TJS" && { grep -q 'var(--' "$TJS" && ok "theme.js token dùng var(--…)" || bad "theme.js color token chưa dùng var(--…)"; }

# AC5: không còn nền dark hardcode trong theme.css (html,body)
echo "AC5: bỏ nền hardcode"
if has "$TCSS" && grep -E 'html,[[:space:]]*body' "$TCSS" | grep -qi '#0E0F13'; then
  bad "html,body vẫn hardcode #0E0F13"
else
  ok "html,body không còn #0E0F13 cứng"
fi

# AC6: apply-before-paint + prefers-color-scheme
echo "AC6: theo OS + đọc localStorage lúc tải"
if grep -rqi 'prefers-color-scheme' design-system/*.js design-system/*.html 2>/dev/null; then ok "tham chiếu prefers-color-scheme"; else bad "không tham chiếu prefers-color-scheme"; fi

# AC7: Playwright spec
echo "AC7: Playwright spec"
SPEC="tests/ui/theme-toggle.spec.ts"
if has "$SPEC"; then
  ok "spec tồn tại"
  grep -qiE 'background-color|classList|class' "$SPEC" && ok "spec assert đổi class/màu" || bad "spec không assert class/màu"
  grep -qiE 'reload|localStorage|persist' "$SPEC"      && ok "spec kiểm tra persist"      || bad "spec không kiểm tra persist"
else
  bad "thiếu $SPEC"
fi

# AC8: screenshots light/dark/cta
echo "AC8: screenshots"
SHOT="docs/ui/TASK-018"
if [ -d "$SHOT" ]; then
  n="$(find "$SHOT" -maxdepth 1 -type f -name '*.png' | wc -l | tr -d ' ')"
  [ "$n" -ge 3 ] && ok "$n ảnh png (>=3)" || bad "chỉ $n ảnh png (<3)"
  for kw in light dark cta; do
    ls "$SHOT"/*"$kw"*.png >/dev/null 2>&1 && ok "có ảnh *$kw*.png" || bad "thiếu ảnh *$kw*.png"
  done
else
  bad "thiếu thư mục $SHOT"
fi

# AC9: document core
echo "AC9: docs/ui/theme.md"
has "docs/ui/theme.md" && ok "doc tồn tại" || bad "thiếu docs/ui/theme.md"

echo
[ "$fail" -eq 0 ] && { echo "ALL MACHINE AC PASS"; exit 0; } || { echo "MACHINE AC FAILED"; exit 1; }
