#!/usr/bin/env bash
# Machine-verifiable AC cho TASK-009 (P7 — JSON read API + Web UI wiring + SSE).
# Exit 0 = tất cả AC đạt; non-zero = fail. Hiện exit 1 vì phase chưa implement (đúng target).
#
# QUAN TRỌNG — chạy trong WORKTREE: runner export AI_WT_<REPO> trỏ vào worktree chứa code task.
#   repo '.' -> ${AI_WT_ROOT:-$ROOT}.  Luôn neo qua biến này, KHÔNG hard-code path.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"   # .ai/tasks/<ID> -> repo root
cd "${AI_WT_ROOT:-$ROOT}"

fail=0

# AC3: routes + stream + static modules tồn tại
ROUTES="server/src/api/routes.ts"
STREAM="server/src/api/stream.ts"
STATIC="server/src/http/static.ts"
[ -f "$ROUTES" ] || { echo "MISSING: $ROUTES"; fail=1; }
[ -f "$STREAM" ] || { echo "MISSING: $STREAM"; fail=1; }
[ -f "$STATIC" ] || { echo "MISSING: $STATIC"; fail=1; }

# Read endpoints có mặt trong routes
if [ -f "$ROUTES" ]; then
  for ep in '/api/projects' '/api/tasks' '/api/evidence' '/api/tokens'; do
    grep -qF "$ep" "$ROUTES" || { echo "MISSING endpoint '$ep' in $ROUTES"; fail=1; }
  done
  # write human action: approve
  grep -qiE 'approve' "$ROUTES" || { echo "NO human approve action in $ROUTES"; fail=1; }
fi

# SSE stream phát qua /api/stream
if [ -f "$STREAM" ]; then
  grep -qF '/api/stream' "$STREAM" \
    || grep -qF '/api/stream' "$ROUTES" 2>/dev/null \
    || { echo "NO /api/stream route in $STREAM/$ROUTES"; fail=1; }
  grep -qiE 'text/event-stream' "$STREAM" || { echo "NO SSE content-type in $STREAM"; fail=1; }
fi

# AC4: design-system JS wiring tới /api/ (mock thay bằng fetch)
if grep -rqE 'fetch\(|/api/|EventSource' design-system --include='*.js' 2>/dev/null; then
  :
else
  echo "NO fetch/EventSource wiring to /api/ in design-system/*.js"; fail=1
fi

# AC5: tests — smoke endpoints + approve persist→DONE + SSE event + 401 thiếu token
API_TESTS="$(grep -rlE '/api/|approve|EventSource|text/event-stream' server --include='*.test.ts' --include='*.spec.ts' 2>/dev/null)"
if [ -z "$API_TESTS" ]; then
  echo "MISSING API test file (server/**/*.test.ts|*.spec.ts referencing /api/ endpoints)"; fail=1
else
  grep -qiE 'approve'                      $API_TESTS || { echo "tests missing approve persist->DONE case"; fail=1; }
  grep -qiE 'sse|event-stream|EventSource' $API_TESTS || { echo "tests missing SSE event case"; fail=1; }
  grep -qE  '401'                          $API_TESTS || { echo "tests missing 401 missing-token case"; fail=1; }
fi

if [ "$fail" -eq 0 ]; then
  echo "AC OK: read API + write approve + SSE stream + static serve + UI fetch wiring + API tests present"
  exit 0
else
  echo "AC FAILED"
  exit 1
fi
