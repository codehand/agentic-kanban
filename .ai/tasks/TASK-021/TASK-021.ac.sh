#!/usr/bin/env bash
# Machine-verifiable Acceptance Criteria cho TASK-021. Exit 0 = tất cả AC đạt; non-zero = fail.
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

FIELDS="priority complexity estimate_hours tags link_document"
TASKREPO="server/src/db/repositories/task.ts"
WRITE="server/src/mcp/tools/write.ts"
RT="server/src/api/routes.ts"
NEW="design-system/new-task.html"
API="design-system/api.js"
IDX="design-system/index.html"

# AC3: migration thêm 5 cột
echo "AC3: migration 0003 add columns"
MIG="server/src/db/migrations/0003_add_task_attributes.sql"
if has "$MIG"; then
  ok "migration tồn tại"
  for c in $FIELDS; do
    grep -qiE "ADD COLUMN[[:space:]]+$c" "$MIG" && ok "ADD COLUMN $c" || bad "migration thiếu cột $c"
  done
else
  bad "thiếu $MIG"
fi

# AC4: repo cập nhật
echo "AC4: task.ts repo"
if has "$TASKREPO"; then
  grep -q 'priority' "$TASKREPO" && grep -q 'tags' "$TASKREPO" && ok "Task interface có field mới" || bad "task.ts thiếu field mới"
  grep -q 'updateTaskAttributes' "$TASKREPO" && ok "có updateTaskAttributes" || bad "task.ts thiếu updateTaskAttributes"
else
  bad "thiếu $TASKREPO"
fi

# AC5: MCP create schema + task.update tool
echo "AC5: MCP"
if has "$WRITE"; then
  grep -q "registerTool('task.update'" "$WRITE" && ok "đăng ký tool task.update" || bad "write.ts thiếu tool task.update"
  grep -q 'priority' "$WRITE" && grep -q 'complexity' "$WRITE" && ok "create/update schema có field mới" || bad "write.ts schema thiếu field mới"
else
  bad "thiếu $WRITE"
fi

# AC6: HTTP PATCH handleUpdateTask
echo "AC6: HTTP PATCH"
if has "$RT"; then
  cnt="$(grep -c 'handleUpdateTask' "$RT" 2>/dev/null)"; cnt="${cnt:-0}"
  [ "$cnt" -ge 2 ] && ok "handleUpdateTask định nghĩa + gọi (x$cnt)" || bad "routes.ts thiếu handleUpdateTask"
  grep -qE "method === 'PATCH'|'PATCH'" "$RT" && ok "có nhánh PATCH" || bad "routes.ts không xử lý PATCH"
else
  bad "thiếu $RT"
fi

# AC7: UI form + api.updateTask
echo "AC7: UI form"
if has "$NEW"; then
  miss=0
  for f in priority complexity tags link_document; do
    grep -q "$f" "$NEW" || { bad "new-task.html thiếu field $f"; miss=1; }
  done
  grep -qE 'estimate' "$NEW" || { bad "new-task.html thiếu estimate"; miss=1; }
  [ "$miss" -eq 0 ] && ok "form có đủ field thuộc tính"
else
  bad "thiếu $NEW"
fi
has "$API" && { grep -q 'updateTask' "$API" && ok "api.js có updateTask" || bad "api.js thiếu updateTask"; }

# AC8: UI detail hiển thị
echo "AC8: UI detail"
if has "$IDX"; then
  grep -q 'priority' "$IDX" && grep -q 'tags' "$IDX" && ok "detail tham chiếu priority+tags" || bad "index.html chưa hiển thị priority/tags"
else
  bad "thiếu $IDX"
fi

# AC9: vitest cover (create persist + update + reject enum sai)
echo "AC9: vitest cover"
ct="$(grep -rlE 'priority|task.update|estimate_hours' server/src --include='*.test.ts' 2>/dev/null)"
if [ -n "$ct" ]; then
  grep -rqE 'task.update|updateTaskAttributes|PATCH' $ct && ok "test cover update" || bad "test chưa cover update"
  grep -rqiE 'invalid|reject|toThrow|400|P9|XXL' $ct && ok "test cover validation sai" || bad "test chưa cover enum/validation sai"
else
  bad "không thấy test cho thuộc tính mới"
fi

# AC10: artifacts core
echo "AC10: artifacts core"
for f in docs/api/task-attributes.md docs/api/task-attributes-scenario.md scripts/test-task-attributes.mjs docs/api/TASK-021/agent-transcript.md; do
  has "$f" && ok "$f" || bad "thiếu $f"
done
if [ -d examples/task-attributes ] && [ -n "$(ls -A examples/task-attributes 2>/dev/null)" ]; then
  ok "examples/task-attributes/ (không rỗng)"
else
  bad "thiếu examples/task-attributes/ hoặc rỗng"
fi

# AC11: output UI
echo "AC11: output UI"
SPEC="tests/ui/task-attributes.spec.ts"
if has "$SPEC"; then
  ok "spec tồn tại"
  grep -qiE 'priority|tags|estimate' "$SPEC" && ok "spec assert thuộc tính" || bad "spec không assert thuộc tính"
else
  bad "thiếu $SPEC"
fi
SHOT="docs/ui/TASK-021"
if [ -d "$SHOT" ]; then
  n="$(find "$SHOT" -maxdepth 1 -type f -name '*.png' | wc -l | tr -d ' ')"
  [ "$n" -ge 3 ] && ok "$n ảnh png (>=3)" || bad "chỉ $n ảnh png (<3)"
  ls "$SHOT"/*form*.png   >/dev/null 2>&1 && ok "có ảnh *form*.png"   || bad "thiếu ảnh *form*.png"
  ls "$SHOT"/*detail*.png >/dev/null 2>&1 && ok "có ảnh *detail*.png" || bad "thiếu ảnh *detail*.png"
else
  bad "thiếu thư mục $SHOT"
fi

echo
[ "$fail" -eq 0 ] && { echo "ALL MACHINE AC PASS"; exit 0; } || { echo "MACHINE AC FAILED"; exit 1; }
