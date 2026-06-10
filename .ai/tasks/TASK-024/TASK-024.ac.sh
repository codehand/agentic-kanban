#!/usr/bin/env bash
# Machine-verifiable Acceptance Criteria cho TASK-024. Exit 0 = tất cả AC đạt; non-zero = fail.
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

RT="server/src/api/routes.ts"
API="design-system/api.js"
TOK="design-system/tokens.html"

# AC3: HTTP mint handler
echo "AC3: POST /api/tokens mint"
if has "$RT"; then
  cnt="$(grep -c 'handleMintToken' "$RT" 2>/dev/null)"; cnt="${cnt:-0}"
  [ "$cnt" -ge 2 ] && ok "handleMintToken định nghĩa + gọi (x$cnt)" || bad "routes.ts thiếu handleMintToken"
  grep -q 'mintToken' "$RT" && ok "tái dùng mintToken()" || bad "routes.ts không gọi mintToken()"
else
  bad "thiếu $RT"
fi

# AC4: client mintToken
echo "AC4: api.mintToken"
if has "$API"; then
  grep -q 'mintToken' "$API" && ok "api.js có mintToken" || bad "api.js thiếu mintToken"
else
  bad "thiếu $API"
fi

# AC5: UI wired + bỏ secret hardcode + clipboard
echo "AC5: tokens.html wired"
if has "$TOK"; then
  grep -q '<form' "$TOK"        && ok "có <form> mint"      || bad "tokens.html thiếu <form>"
  grep -q 'mintToken' "$TOK"    && ok "gọi mintToken"       || bad "tokens.html không gọi mintToken"
  grep -q 'akb_live_judge_3d9f7b1a8c64e02f' "$TOK" && bad "vẫn còn secret hardcode" || ok "đã bỏ secret hardcode"
  grep -q 'navigator.clipboard' "$TOK" && ok "copy dùng clipboard" || bad "copy chưa dùng navigator.clipboard"
else
  bad "thiếu $TOK"
fi

# AC6: hướng dẫn sử dụng
echo "AC6: hướng dẫn sử dụng"
if has "$TOK"; then
  grep -q 'Bearer' "$TOK"        && ok "có Bearer"              || bad "thiếu hướng dẫn Bearer"
  grep -qE '/mcp' "$TOK"         && ok "có endpoint /mcp"        || bad "thiếu endpoint /mcp"
  grep -q 'CONNECT_MCP' "$TOK"   && ok "link CONNECT_MCP.md"     || bad "thiếu link CONNECT_MCP.md"
fi

# AC7: vitest cover (mint trả secret + list không lộ + 401/403)
echo "AC7: vitest cover mint"
ct="$(grep -rlE 'handleMintToken|mintToken|/api/tokens' server/src --include='*.test.ts' 2>/dev/null)"
if [ -n "$ct" ]; then
  grep -rqiE 'secret' $ct && ok "test tham chiếu secret" || bad "test không kiểm tra secret"
  grep -rqE '401' $ct && grep -rqE '403' $ct && ok "test cover 401 + 403" || bad "test thiếu 401/403"
else
  bad "không thấy test cho mint"
fi

# AC8: artifacts core
echo "AC8: artifacts core"
for f in docs/api/mint-token.md docs/api/mint-token-scenario.md scripts/test-mint-token.mjs docs/api/TASK-024/agent-transcript.md; do
  has "$f" && ok "$f" || bad "thiếu $f"
done
if [ -d examples/mint-token ] && [ -n "$(ls -A examples/mint-token 2>/dev/null)" ]; then
  ok "examples/mint-token/ (không rỗng)"
else
  bad "thiếu examples/mint-token/ hoặc rỗng"
fi

# AC9: output UI
echo "AC9: output UI"
SPEC="tests/ui/mint-token.spec.ts"
if has "$SPEC"; then
  ok "spec tồn tại"
  grep -qiE 'secret|mint|bearer|token' "$SPEC" && ok "spec assert mint/secret" || bad "spec không assert mint/secret"
else
  bad "thiếu $SPEC"
fi
SHOT="docs/ui/TASK-024"
if [ -d "$SHOT" ]; then
  n="$(find "$SHOT" -maxdepth 1 -type f -name '*.png' | wc -l | tr -d ' ')"
  [ "$n" -ge 3 ] && ok "$n ảnh png (>=3)" || bad "chỉ $n ảnh png (<3)"
  ls "$SHOT"/*cta*.png    >/dev/null 2>&1 && ok "có ảnh *cta*.png"    || bad "thiếu ảnh *cta*.png"
  ls "$SHOT"/*banner*.png >/dev/null 2>&1 && ok "có ảnh *banner*.png" || bad "thiếu ảnh *banner*.png"
else
  bad "thiếu thư mục $SHOT"
fi

echo
[ "$fail" -eq 0 ] && { echo "ALL MACHINE AC PASS"; exit 0; } || { echo "MACHINE AC FAILED"; exit 1; }
