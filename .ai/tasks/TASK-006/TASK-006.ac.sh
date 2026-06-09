#!/usr/bin/env bash
# Machine-verifiable Acceptance Criteria for TASK-006 (P4: Evidence subsystem).
# Exit 0 = tất cả AC đạt; non-zero = fail. Faithful to docs/phases/P4.md.
# Will exit 1 until P4 is implemented — that is the target.
#
# QUAN TRỌNG — chạy trong WORKTREE: runner export AI_WT_<REPO> trỏ vào worktree chứa code task.
#   repo '.'      -> ${AI_WT_ROOT:-$ROOT}
# Luôn neo qua biến này; KHÔNG hard-code path. Build/test do gate+run-evidence lo (na nếu chưa có project).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"   # .ai/tasks/<ID> -> repo root
cd "${AI_WT_ROOT:-$ROOT}"

fail() { echo "AC FAIL: $*" >&2; exit 1; }

EV="server/src/domain/evidence.ts"
CK="server/src/domain/checksum.ts"

# AC3: evidence.ts exists and exports submit + selfcheck.
[ -f "$EV" ] || fail "missing $EV"
grep -Eq 'export[^=]*\bsubmit\b'    "$EV" || grep -Eq '\bsubmit\b[^=]*=>'    "$EV" || fail "$EV: no 'submit' export"
grep -Eq 'export[^=]*\bselfcheck\b' "$EV" || grep -Eq '\bselfcheck\b[^=]*=>' "$EV" || fail "$EV: no 'selfcheck' export"

# AC4: checksum.ts exists and exports a manifest-verify function.
[ -f "$CK" ] || fail "missing $CK"
grep -Eqi 'export' "$CK" || fail "$CK: no export"
grep -Eqi 'verify|checksum|sha256|manifest' "$CK" || fail "$CK: no verify/manifest/sha256 reference"

# AC: evidence row records the required exit codes + coverage + manifest (per P4 doc).
for field in build_exit test_exit lint_exit ac_exit coverage manifest; do
  grep -Eqi "$field" "$EV" || fail "$EV: no reference to '$field'"
done

# AC5/AC13: submit enforces role=runner (rejects non-runner).
grep -Eqi 'runner' "$EV" || fail "$EV: no runner role enforcement"

# AC10/AC13: selfcheck delegates state changes to the P3 gate; defines the two outcomes.
grep -Eqi 'gate' "$EV" || fail "$EV: selfcheck must delegate to gate (P3)"
grep -Eq 'SELF_CHECK_PASSED' "$EV" || fail "$EV: no SELF_CHECK_PASSED outcome"
grep -Eq 'SELF_CHECK_FAILED' "$EV" || fail "$EV: no SELF_CHECK_FAILED outcome"

# --- Tests must exist and cover the P4 acceptance criteria. ---
test_files=$(grep -rEl 'evidence|selfcheck' server/src --include='*.test.ts' --include='*.spec.ts' 2>/dev/null || true)
[ -n "$test_files" ] || fail "no evidence/selfcheck test file under server/src"

# AC11: no skipped tests in those files.
grep -REq '\b(it|test|describe)\.skip\b' $test_files && fail "skipped tests present in evidence tests"

# AC5: role != runner reject — test.
grep -Eqi 'runner' $test_files || fail "no test exercising the runner-only rule"

# AC8: tampered checksum reject — test.
grep -Eqi 'tamper|checksum|mismatch|sha256|manifest' $test_files || fail "no checksum-tamper test"

# AC7: pass/fail by exit code — test.
grep -Eq 'SELF_CHECK_PASSED' $test_files || fail "no test asserting SELF_CHECK_PASSED"
grep -Eq 'SELF_CHECK_FAILED' $test_files || fail "no test asserting SELF_CHECK_FAILED"

# AC9: lint/coverage optional vs required behaviour — test.
grep -Eqi 'optional|required|coverage|lint|warn' $test_files || fail "no optional-vs-required check test"

echo "TASK-006 machine AC: PASS"
exit 0
