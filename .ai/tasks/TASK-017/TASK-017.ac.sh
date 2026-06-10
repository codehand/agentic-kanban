#!/usr/bin/env bash
# Machine-verifiable Acceptance Criteria cho TASK-017. Exit 0 = tất cả AC đạt; non-zero = fail.
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

# AC3: MCP write path emit event
echo "AC3: MCP write path emit"
W="server/src/mcp/tools/write.ts"
if has "$W"; then
  grep -qE 'broadcast(Created|Transition)' "$W" && ok "write.ts gọi broadcast*" || bad "write.ts không gọi broadcastCreated/broadcastTransition"
else
  bad "thiếu $W"
fi

# AC4: event 'created' trong stream.ts
echo "AC4: event created"
S="server/src/api/stream.ts"
if has "$S"; then
  grep -q 'broadcastCreated' "$S"           && ok "định nghĩa/export broadcastCreated" || bad "stream.ts thiếu broadcastCreated"
  grep -qE 'event:[[:space:]]*created' "$S"  && ok "phát 'event: created'"             || bad "stream.ts không phát event: created"
else
  bad "thiếu $S"
fi

# AC5: UI live + toast, bỏ location.reload trong handler SSE
echo "AC5: UI live + toast"
A="design-system/api.js"
if has "$A"; then
  grep -q "addEventListener('created'" "$A"    && ok "lắng nghe 'created'"     || bad "api.js không addEventListener('created')"
  grep -q "addEventListener('transition'" "$A" && ok "lắng nghe 'transition'"  || bad "api.js không addEventListener('transition')"
  grep -qiE 'showToast|toast' "$A"             && ok "có gọi toast"            || bad "api.js không gọi toast"
  if grep -q 'location.reload' "$A"; then bad "vẫn còn location.reload() (cần soft-refetch)"; else ok "không còn location.reload()"; fi
else
  bad "thiếu $A"
fi

# AC6: vitest cover emit (created + transition)
echo "AC6: vitest cover emit"
emit_test="$(grep -rlE 'sseBus|broadcastCreated' server/src --include='*.test.ts' 2>/dev/null)"
if [ -n "$emit_test" ]; then
  if grep -rqE "'created'|broadcastCreated" $emit_test && grep -rqE "'transition'|broadcastTransition" $emit_test; then
    ok "test cover created + transition ($(echo $emit_test | tr '\n' ' '))"
  else
    bad "test có nhưng chưa cover cả created lẫn transition"
  fi
else
  bad "không thấy test nào reference sseBus/broadcastCreated"
fi

# AC7: artifacts core MCP
echo "AC7: artifacts core MCP"
for f in docs/mcp/live-update.md docs/mcp/live-update-scenario.md scripts/test-mcp-live.mjs docs/mcp/TASK-017/agent-transcript.md; do
  has "$f" && ok "$f" || bad "thiếu $f"
done
if [ -d examples/mcp-live ] && [ -n "$(ls -A examples/mcp-live 2>/dev/null)" ]; then
  ok "examples/mcp-live/ (không rỗng)"
else
  bad "thiếu examples/mcp-live/ hoặc rỗng"
fi

# AC8: output UI (playwright spec + screenshots)
echo "AC8: output UI"
SPEC="tests/ui/live-update.spec.ts"
if has "$SPEC"; then
  ok "spec tồn tại"
  grep -qiE 'toast|task' "$SPEC" && ok "spec assert toast/task" || bad "spec không assert toast/task"
else
  bad "thiếu $SPEC"
fi
SHOT="docs/ui/TASK-017"
if [ -d "$SHOT" ]; then
  n="$(find "$SHOT" -maxdepth 1 -type f -name '*.png' | wc -l | tr -d ' ')"
  [ "$n" -ge 3 ] && ok "$n ảnh png (>=3)" || bad "chỉ $n ảnh png (<3)"
  ls "$SHOT"/*toast*.png    >/dev/null 2>&1 && ok "có ảnh *toast*.png"    || bad "thiếu ảnh *toast*.png"
  ls "$SHOT"/*autoload*.png >/dev/null 2>&1 && ok "có ảnh *autoload*.png" || bad "thiếu ảnh *autoload*.png"
else
  bad "thiếu thư mục $SHOT"
fi

echo
[ "$fail" -eq 0 ] && { echo "ALL MACHINE AC PASS"; exit 0; } || { echo "MACHINE AC FAILED"; exit 1; }
