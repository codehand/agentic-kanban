#!/usr/bin/env bash
# Machine-verifiable Acceptance Criteria cho TASK-023. Exit 0 = tất cả AC đạt; non-zero = fail.
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

SH="design-system/shell.js"
T="design-system/tasks.html"
TJS="design-system/tasks.js"

# AC3: rail trỏ tasks.html (không còn index.html cho Tasks)
echo "AC3: rail Tasks -> tasks.html"
if has "$SH"; then
  grep -qE "nav\('tasks',[[:space:]]*'tasks\.html'" "$SH" && ok "nav Tasks -> tasks.html" || bad "shell.js chưa trỏ Tasks sang tasks.html"
  grep -qE "nav\('tasks',[[:space:]]*'index\.html'" "$SH" && bad "vẫn còn nav Tasks -> index.html" || ok "không còn Tasks -> index.html"
else
  bad "thiếu $SH"
fi

# AC4: tasks.html tồn tại + shell + api.js
echo "AC4: tasks.html"
if has "$T"; then
  ok "tasks.html tồn tại"
  grep -q 'data-active="tasks"' "$T" && ok "data-active=tasks" || bad "thiếu data-active=tasks"
  grep -q 'id="rail"' "$T"           && ok "mount rail"        || bad "thiếu <aside id=rail>"
  grep -q 'api.js' "$T"              && ok "nạp api.js"        || bad "không nạp api.js"
else
  bad "thiếu $T"
fi

# AC5: list view thật (listTasks + filter + click detail)
echo "AC5: list view"
src=""
has "$T"   && src="$src $T"
has "$TJS" && src="$src $TJS"
if [ -n "$src" ]; then
  grep -qh 'listTasks' $src                     && ok "gọi listTasks"          || bad "không gọi listTasks"
  grep -qhiE 'state|filter' $src                && ok "có lọc/cột state"       || bad "thiếu filter/state"
  grep -qhiE '#task=|openDrawer|__openDrawer|getTask' $src && ok "click dòng mở chi tiết" || bad "không mở chi tiết khi click"
else
  bad "không có nguồn render (tasks.html/tasks.js)"
fi

# AC6: Playwright spec
echo "AC6: Playwright spec"
SPEC="tests/ui/tasks-view.spec.ts"
if has "$SPEC"; then
  ok "spec tồn tại"
  grep -qiE 'tasks\.html|Tasks|active' "$SPEC" && ok "spec assert điều hướng/active" || bad "spec không assert tasks/active"
else
  bad "thiếu $SPEC"
fi

# AC7: screenshots menu + list
echo "AC7: screenshots"
SHOT="docs/ui/TASK-023"
if [ -d "$SHOT" ]; then
  n="$(find "$SHOT" -maxdepth 1 -type f -name '*.png' | wc -l | tr -d ' ')"
  [ "$n" -ge 2 ] && ok "$n ảnh png (>=2)" || bad "chỉ $n ảnh png (<2)"
  ls "$SHOT"/*menu*.png >/dev/null 2>&1 && ok "có ảnh *menu*.png" || bad "thiếu ảnh *menu*.png"
  ls "$SHOT"/*list*.png >/dev/null 2>&1 && ok "có ảnh *list*.png" || bad "thiếu ảnh *list*.png"
else
  bad "thiếu thư mục $SHOT"
fi

# AC8: document
echo "AC8: docs/ui/tasks-view.md"
has "docs/ui/tasks-view.md" && ok "doc tồn tại" || bad "thiếu docs/ui/tasks-view.md"

echo
[ "$fail" -eq 0 ] && { echo "ALL MACHINE AC PASS"; exit 0; } || { echo "MACHINE AC FAILED"; exit 1; }
