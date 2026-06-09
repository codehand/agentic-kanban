#!/usr/bin/env bash
# Machine-verifiable AC for TASK-003 (P1: data layer / SQLite schema + repositories).
# Exit 0 = all AC met; non-zero = fail. Will fail until P1 is implemented (target state).
#
# Runs in WORKTREE: runner exports AI_WT_<REPO> pointing at the worktree holding the task's code.
#   repo '.' -> ${AI_WT_ROOT:-$ROOT}. Always anchor via this var, never hard-code paths.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"   # .ai/tasks/<ID> -> repo root
cd "${AI_WT_ROOT:-$ROOT}"

fail=0
need_file() { [ -f "$1" ] || { echo "MISSING file: $1"; fail=1; }; }

# AC1: migration with all 7 tables
MIG="server/src/db/migrations/0001_init.sql"
need_file "$MIG"
if [ -f "$MIG" ]; then
  for t in project task transition comment evidence gitref token; do
    grep -qiE "create[[:space:]]+table[[:space:]]+(if[[:space:]]+not[[:space:]]+exists[[:space:]]+)?[\"\`']?${t}[\"\`']?\b" "$MIG" \
      || { echo "$MIG: missing CREATE TABLE $t"; fail=1; }
  done

  # AC2: append-only triggers on evidence + transition, and indexes on task(project_id)/task(state)
  for tbl in evidence transition; do
    grep -qiE "create[[:space:]]+trigger\b" "$MIG" && grep -qiE "before[[:space:]]+update[[:space:]]+on[[:space:]]+[\"\`']?${tbl}\b" "$MIG" \
      || { echo "$MIG: no BEFORE UPDATE trigger on $tbl"; fail=1; }
    grep -qiE "before[[:space:]]+delete[[:space:]]+on[[:space:]]+[\"\`']?${tbl}\b" "$MIG" \
      || { echo "$MIG: no BEFORE DELETE trigger on $tbl"; fail=1; }
  done
  grep -qiE "create[[:space:]]+(unique[[:space:]]+)?index[^;]*\btask\b[^;]*\bproject_id\b" "$MIG" \
    || { echo "$MIG: no index on task(project_id)"; fail=1; }
  grep -qiE "create[[:space:]]+(unique[[:space:]]+)?index[^;]*\btask\b[^;]*\bstate\b" "$MIG" \
    || { echo "$MIG: no index on task(state)"; fail=1; }
fi

# AC3: connection + idempotent migrate runner
need_file "server/src/db/connection.ts"
need_file "server/src/db/migrate.ts"

# AC4: repository per table
for r in project task transition comment evidence gitref token; do
  need_file "server/src/db/repositories/$r.ts"
done

# AC5: tests for idempotency / CRUD / append-only rejection under server/test
if [ -d server/test ]; then
  grep -rqiE 'idempoten' server/test || { echo "no migration idempotency test under server/test"; fail=1; }
  grep -rqiE '(update|delete)' server/test \
    && grep -rqiE '(evidence|transition)' server/test \
    || { echo "no append-only (UPDATE/DELETE reject) test for evidence/transition under server/test"; fail=1; }
else
  echo "MISSING dir: server/test"; fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "AC OK: P1 data layer present (7-table migration, append-only triggers, indexes, connection+idempotent runner, repos, tests)"
  exit 0
else
  echo "AC FAILED"
  exit 1
fi
