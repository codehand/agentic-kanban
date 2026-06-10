#!/usr/bin/env bash
# Machine-verifiable Acceptance Criteria cho TASK-019. Exit 0 = tất cả AC đạt; non-zero = fail.
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

IDX="design-system/index.html"
NEW="design-system/new-task.html"
API="design-system/api.js"
RT="server/src/api/routes.ts"

# AC3: New Task CTA wired (id + trỏ tới new-task.html)
echo "AC3: New Task CTA wired"
if has "$IDX"; then
  grep -q 'new-task.html' "$IDX"            && ok "index trỏ tới new-task.html" || bad "index không link tới new-task.html"
  grep -iq 'New Task' "$IDX" && grep -A1 -i 'New Task\|new-task.html' "$IDX" | grep -q 'id=' && ok "có id quanh New Task" || bad "nút New Task thiếu id"
else
  bad "thiếu $IDX"
fi

# AC4: server POST /api/tasks create route
# Yêu cầu handler tên `handleCreateTask` (đặt tên rõ để tránh false-positive với GET /api/tasks).
echo "AC4: server create route"
if has "$RT"; then
  # định nghĩa handler + được gọi trong nhánh POST (>=2 lần xuất hiện: định nghĩa + invoke)
  cnt="$(grep -c 'handleCreateTask' "$RT" 2>/dev/null)"; cnt="${cnt:-0}"
  [ "$cnt" -ge 2 ] && ok "handleCreateTask được định nghĩa + gọi (x$cnt)" || bad "routes.ts thiếu handleCreateTask (định nghĩa + invoke trong POST)"
  # invoke nằm trong nhánh POST tạo task (POST + /api/tasks + handleCreateTask cùng file)
  grep -qE "method === 'POST'" "$RT" && grep -q 'handleCreateTask' "$RT" && ok "create gắn vào nhánh POST" || bad "create chưa gắn vào POST"
else
  bad "thiếu $RT"
fi

# AC5: client createTask
echo "AC5: client createTask"
if has "$API"; then
  grep -q 'createTask' "$API"                       && ok "api.js có createTask" || bad "api.js thiếu createTask"
  grep -A6 'createTask' "$API" | grep -qiE "method:[[:space:]]*'POST'|POST" && ok "createTask dùng POST" || bad "createTask không POST"
else
  bad "thiếu $API"
fi

# AC6: form wired trong new-task.html
echo "AC6: form wired"
if has "$NEW"; then
  grep -q '<form' "$NEW"                 && ok "có <form>"                  || bad "new-task.html thiếu <form>"
  grep -iq 'Create task' "$NEW" && grep -A1 -i 'Create task' "$NEW" | grep -q 'id=' && ok "nút Create task có id" \
    || { grep -B1 -i 'Create task' "$NEW" | grep -q 'id=' && ok "nút Create task có id" || bad "nút Create task thiếu id"; }
  grep -q 'createTask' "$NEW"            && ok "có gọi createTask"          || bad "new-task.html không gọi createTask"
else
  bad "thiếu $NEW"
fi

# AC7: vitest cover create (POST tạo + 401)
echo "AC7: vitest cover create"
ct="$(grep -rlE "POST.*/api/tasks|/api/tasks'|createTask|create.*task" server/src --include='*.test.ts' 2>/dev/null)"
if [ -n "$ct" ] && grep -rlqE "api/tasks" $ct 2>/dev/null; then
  grep -rqE '401' $ct && ok "test cover create + 401 ($(echo $ct|tr '\n' ' '))" || bad "thiếu assert 401 trong test create"
else
  bad "không thấy test cho POST /api/tasks create"
fi

# AC8: artifacts core API
echo "AC8: artifacts core API"
for f in docs/api/create-task.md docs/api/create-task-scenario.md scripts/test-create-task.mjs docs/api/TASK-019/agent-transcript.md; do
  has "$f" && ok "$f" || bad "thiếu $f"
done
if [ -d examples/create-task ] && [ -n "$(ls -A examples/create-task 2>/dev/null)" ]; then
  ok "examples/create-task/ (không rỗng)"
else
  bad "thiếu examples/create-task/ hoặc rỗng"
fi

# AC9: output UI
echo "AC9: output UI"
SPEC="tests/ui/new-task.spec.ts"
if has "$SPEC"; then
  ok "spec tồn tại"
  grep -qiE 'toast|task' "$SPEC" && ok "spec assert toast/task" || bad "spec không assert toast/task"
else
  bad "thiếu $SPEC"
fi
SHOT="docs/ui/TASK-019"
if [ -d "$SHOT" ]; then
  n="$(find "$SHOT" -maxdepth 1 -type f -name '*.png' | wc -l | tr -d ' ')"
  [ "$n" -ge 3 ] && ok "$n ảnh png (>=3)" || bad "chỉ $n ảnh png (<3)"
  ls "$SHOT"/*cta*.png     >/dev/null 2>&1 && ok "có ảnh *cta*.png"     || bad "thiếu ảnh *cta*.png"
  ls "$SHOT"/*created*.png >/dev/null 2>&1 && ok "có ảnh *created*.png" || bad "thiếu ảnh *created*.png"
else
  bad "thiếu thư mục $SHOT"
fi

echo
[ "$fail" -eq 0 ] && { echo "ALL MACHINE AC PASS"; exit 0; } || { echo "MACHINE AC FAILED"; exit 1; }
