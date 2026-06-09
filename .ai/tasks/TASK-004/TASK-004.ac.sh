#!/usr/bin/env bash
# Machine-verifiable AC for TASK-004 (P2: Auth & roles).
# Exit 0 = all AC met; non-zero = fail. Faithful to docs/phases/P2.md.
#
# Runs in WORKTREE: runner exports AI_WT_<REPO> pointing at the worktree with task code.
#   repo '.' -> ${AI_WT_ROOT:-$ROOT}. Always anchor via this var, never hard-code path.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"   # .ai/tasks/<ID> -> repo root
cd "${AI_WT_ROOT:-$ROOT}"

AUTH="server/src/auth"
fail=0

# AC1: required auth modules exist (parse, resolve, authorize, bootstrap, mint).
for f in parse.ts resolve.ts authorize.ts bootstrap.ts mint.ts; do
  [ -f "$AUTH/$f" ] || { echo "MISSING module: $AUTH/$f"; fail=1; }
done

# AC2: secrets stored as hash only — mint references SHA-256 + salt; secret_hash column used.
if [ -f "$AUTH/mint.ts" ]; then
  grep -qiE 'sha-?256|createHash' "$AUTH/mint.ts" || { echo "AC2: mint.ts does not reference SHA-256 hashing"; fail=1; }
  grep -qiE 'salt' "$AUTH/mint.ts" || { echo "AC2: mint.ts does not reference salt"; fail=1; }
fi
grep -rqE 'secret_hash' server/src 2>/dev/null || { echo "AC2: no 'secret_hash' column referenced under server/src"; fail=1; }

# AC8 (machine-checkable slice): constant-time compare used in auth.
grep -rqE 'timingSafeEqual' server/src/auth 2>/dev/null || { echo "AC8: no constant-time compare (timingSafeEqual) in server/src/auth"; fail=1; }

# AC3/AC4/AC5: tests must exist covering bootstrap idempotency, 401/403, and authorize per-role.
AUTH_TESTS="$(grep -rlE 'authorize|bootstrap|ADMIN_TOKEN|401|403|revoked' server --include='*.test.ts' 2>/dev/null || true)"
[ -n "$AUTH_TESTS" ] || { echo "AC3/4/5: no auth tests (*.test.ts) found covering bootstrap/401-403/authorize"; fail=1; }
if [ -n "$AUTH_TESTS" ]; then
  grep -rqiE 'idempoten|re-?run|twice|duplicate' $AUTH_TESTS || { echo "AC3: no bootstrap idempotency assertion in auth tests"; fail=1; }
  grep -rqE '401|403' $AUTH_TESTS || { echo "AC4: no 401/403 assertion in auth tests"; fail=1; }
  grep -rqE 'runner' $AUTH_TESTS || { echo "AC5: no runner-denied authorize assertion in auth tests"; fail=1; }
fi

if [ "$fail" -eq 0 ]; then
  echo "AC OK: P2 auth modules + hash-only storage + constant-time compare + role/401-403/idempotency tests present"
  exit 0
else
  echo "AC FAILED (TASK-004 not yet implemented — expected until P2 is built)"
  exit 1
fi
