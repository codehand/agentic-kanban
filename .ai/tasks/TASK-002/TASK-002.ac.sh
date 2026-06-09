#!/usr/bin/env bash
# Machine-verifiable AC for TASK-002 (P0: scaffold & toolchain).
# Exit 0 = all AC met; non-zero = fail. Will fail until P0 is implemented (target state).
#
# Runs in WORKTREE: runner exports AI_WT_<REPO> pointing at the worktree holding the task's code.
#   repo '.' -> ${AI_WT_ROOT:-$ROOT}. Always anchor via this var, never hard-code paths.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"   # .ai/tasks/<ID> -> repo root
cd "${AI_WT_ROOT:-$ROOT}"

fail=0
need_file() { [ -f "$1" ] || { echo "MISSING file: $1"; fail=1; }; }
need_dir()  { [ -d "$1" ] || { echo "MISSING dir: $1"; fail=1; }; }
need_grep() { grep -qE "$2" "$1" 2>/dev/null || { echo "MISSING pattern /$2/ in $1"; fail=1; }; }

# AC1: package.json (build+test scripts), tsconfig.json (ESM), vitest config
need_file "package.json"
if [ -f package.json ]; then
  grep -qE '"build"[[:space:]]*:' package.json || { echo "package.json: no build script"; fail=1; }
  grep -qE '"test"[[:space:]]*:'  package.json || { echo "package.json: no test script"; fail=1; }
fi
need_file "tsconfig.json"
[ -f tsconfig.json ] && { grep -qiE '"module"[[:space:]]*:[[:space:]]*"(node(next|16)|es[0-9a-z]+)"' tsconfig.json \
  || { echo "tsconfig.json: no ESM module setting"; fail=1; }; }
{ [ -f vitest.config.ts ] || [ -f vitest.config.mts ] || [ -f vitest.config.js ]; } \
  || { echo "MISSING vitest config (vitest.config.{ts,mts,js})"; fail=1; }

# AC2: directory tree
for d in config db auth domain mcp api http; do need_dir "server/src/$d"; done
need_dir "server/test"

# AC3: config loader references env + config.yml
need_file "server/src/config/index.ts"
if [ -f server/src/config/index.ts ]; then
  for k in PORT ADMIN_TOKEN DB_PATH; do
    grep -qF "$k" server/src/config/index.ts || { echo "config/index.ts: no ref to env $k"; fail=1; }
  done
  grep -qiE 'config\.ya?ml' server/src/config/index.ts || { echo "config/index.ts: no config.yml ref"; fail=1; }
fi

# AC4: logger (pino) + http server (node:http, /healthz, status ok)
need_file "server/src/logger.ts"
[ -f server/src/logger.ts ] && need_grep "server/src/logger.ts" "pino"
need_file "server/src/http/server.ts"
if [ -f server/src/http/server.ts ]; then
  need_grep "server/src/http/server.ts" "node:http"
  need_grep "server/src/http/server.ts" "/healthz"
  need_grep "server/src/http/server.ts" '"?status"?[[:space:]]*:?[[:space:]]*"ok"'
fi

# AC5: .ai/config.yml maps build/test to pnpm
need_file ".ai/config.yml"
if [ -f .ai/config.yml ]; then
  grep -qE 'build:[[:space:]]*"?pnpm build' .ai/config.yml || { echo ".ai/config.yml: build != pnpm build"; fail=1; }
  grep -qE 'test:[[:space:]]*"?pnpm test'   .ai/config.yml || { echo ".ai/config.yml: test != pnpm test"; fail=1; }
fi

# AC6: /healthz smoke test exists under server/test
if ! grep -rqlE 'healthz' server/test 2>/dev/null; then
  echo "MISSING /healthz smoke test under server/test"; fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "AC OK: P0 scaffold present (toolchain, server/src tree, config loader, pino, node:http /healthz, .ai pnpm, smoke test)"
  exit 0
else
  echo "AC FAILED"
  exit 1
fi
