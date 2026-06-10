#!/usr/bin/env bash
# Machine-verifiable Acceptance Criteria cho TASK-022. Exit 0 = tất cả AC đạt; non-zero = fail.
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

STATIC="server/src/http/static.ts"
RT="server/src/api/routes.ts"
SH="design-system/shell.js"
API="design-system/api.js"
IDX="design-system/index.html"
FR="design-system/first-run.html"

# AC3: routing path-based + test
echo "AC3: routing path-based"
if has "$STATIC"; then
  grep -qiE 'project' "$STATIC" && ok "static.ts có xử lý project prefix" || bad "static.ts chưa xử lý project prefix"
else
  bad "thiếu $STATIC"
fi
ST="server/src/http/static.test.ts"
if has "$ST"; then
  ok "có static.test.ts"
  grep -qE '/[^"]*/index\.html|index\.html' "$ST" && ok "test routing tham chiếu index.html theo path" || bad "static.test.ts chưa assert path project"
else
  bad "thiếu $ST"
fi

# AC4: HTTP create project
echo "AC4: POST /api/projects"
if has "$RT"; then
  cnt="$(grep -c 'handleCreateProject' "$RT" 2>/dev/null)"; cnt="${cnt:-0}"
  [ "$cnt" -ge 2 ] && ok "handleCreateProject định nghĩa + gọi (x$cnt)" || bad "routes.ts thiếu handleCreateProject"
  grep -q '/api/projects' "$RT" && ok "tham chiếu /api/projects" || bad "routes.ts không có /api/projects"
else
  bad "thiếu $RT"
fi

# AC5: dropdown thật (gọi listProjects + đọc project từ path qua helper projectFromPath)
echo "AC5: dropdown"
if has "$SH"; then
  grep -q 'listProjects' "$SH"     && ok "shell.js gọi listProjects"             || bad "shell.js không gọi listProjects"
  grep -q 'projectFromPath' "$SH"  && ok "có helper projectFromPath (đọc từ URL)" || bad "shell.js thiếu helper projectFromPath đọc project từ path"
else
  bad "thiếu $SH"
fi

# AC6: client createProject
echo "AC6: api.createProject"
if has "$API"; then
  grep -q 'createProject' "$API" && ok "api.js có createProject" || bad "api.js thiếu createProject"
else
  bad "thiếu $API"
fi

# AC7: empty-state guide
echo "AC7: empty-state"
has "$IDX" && { grep -qi 'first-run' "$IDX" && ok "index.html guide first-run khi rỗng" || bad "index.html chưa guide first-run"; }
has "$FR"  && { grep -q 'createProject' "$FR" && ok "first-run gọi createProject" || bad "first-run.html chưa gọi createProject"; }

# AC8: asset tuyệt đối
echo "AC8: asset tuyệt đối"
if has "$IDX"; then
  grep -qE 'href="/theme\.css"|href=./theme\.css' "$IDX" && grep -qE 'src="/shell\.js"' "$IDX" \
    && ok "theme.css & shell.js nạp tuyệt đối" || bad "asset chưa dùng đường dẫn tuyệt đối (/theme.css, /shell.js)"
else
  bad "thiếu $IDX"
fi

# AC9: vitest cover (create + 401)
echo "AC9: vitest cover create"
ct="$(grep -rlE '/api/projects|createProject|handleCreateProject' server/src --include='*.test.ts' 2>/dev/null)"
if [ -n "$ct" ]; then
  grep -rqE '401' $ct && ok "test create cover 401 ($(echo $ct|tr '\n' ' '))" || bad "thiếu assert 401 cho create project"
else
  bad "không thấy test cho POST /api/projects"
fi

# AC10: artifacts core
echo "AC10: artifacts core"
for f in docs/projects/project-switcher.md docs/projects/project-switcher-scenario.md scripts/test-projects.mjs docs/projects/TASK-022/agent-transcript.md; do
  has "$f" && ok "$f" || bad "thiếu $f"
done
if [ -d examples/projects ] && [ -n "$(ls -A examples/projects 2>/dev/null)" ]; then
  ok "examples/projects/ (không rỗng)"
else
  bad "thiếu examples/projects/ hoặc rỗng"
fi

# AC11: output UI
echo "AC11: output UI"
SPEC="tests/ui/project-switcher.spec.ts"
if has "$SPEC"; then
  ok "spec tồn tại"
  grep -qiE 'project|url|pathname' "$SPEC" && ok "spec assert project/url" || bad "spec không assert project/url"
else
  bad "thiếu $SPEC"
fi
SHOT="docs/ui/TASK-022"
if [ -d "$SHOT" ]; then
  n="$(find "$SHOT" -maxdepth 1 -type f -name '*.png' | wc -l | tr -d ' ')"
  [ "$n" -ge 3 ] && ok "$n ảnh png (>=3)" || bad "chỉ $n ảnh png (<3)"
  ls "$SHOT"/*dropdown*.png >/dev/null 2>&1 && ok "có ảnh *dropdown*.png" || bad "thiếu ảnh *dropdown*.png"
  ls "$SHOT"/*switch*.png   >/dev/null 2>&1 && ok "có ảnh *switch*.png"   || bad "thiếu ảnh *switch*.png"
else
  bad "thiếu thư mục $SHOT"
fi

echo
[ "$fail" -eq 0 ] && { echo "ALL MACHINE AC PASS"; exit 0; } || { echo "MACHINE AC FAILED"; exit 1; }
