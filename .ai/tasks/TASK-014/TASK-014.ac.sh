#!/usr/bin/env bash
# Machine-verifiable Acceptance Criteria. Exit 0 = tất cả AC đạt; non-zero = fail.
# VIẾT KIỂM TRA THẬT vào đây. Mặc định fail để buộc tác giả định nghĩa AC.
#
# QUAN TRỌNG — chạy trong WORKTREE: runner export AI_WT_<REPO> trỏ vào worktree chứa code task.
#   repo '.'      -> ${AI_WT_ROOT:-$ROOT}
# Luôn neo qua biến này (fallback checkout chính để chạy tay vẫn được); KHÔNG hard-code path.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"   # .ai/tasks/<ID> -> repo root
cd "${AI_WT_ROOT:-$ROOT}"

fail=0

# AC3a: schema evidence có cột lưu checksum tham chiếu (không chỉ comment).
if ! grep -REq 'manifest_checksum|checksum[[:space:]]+TEXT|checksum[[:space:]]+BLOB' server/src/db/migrations 2>/dev/null; then
  echo "AC FAIL: chưa thấy cột lưu checksum tham chiếu trong migration (evidence schema)"; fail=1
fi

# AC3b: KHÔNG còn pattern tautology verify-manifest-against-its-own-freshly-computed-hash.
if grep -Eq 'verifyManifestChecksum\([^,]*manifest_json[^,]*,[[:space:]]*validateAndChecksumManifest\(' server/src/domain/evidence.ts 2>/dev/null; then
  echo "AC FAIL: vẫn còn verify tautology (so manifest với hash tính lại từ chính nó) trong evidence.ts"; fail=1
fi

# AC3c: có test mô phỏng tamper manifest đã lưu trong DB rồi kỳ vọng reject.
if ! grep -Eiq 'tamper|tampered|giả mạo|sửa.*manifest' server/test/evidence.test.ts 2>/dev/null; then
  echo "AC FAIL: thiếu test tamper-detection trong server/test/evidence.test.ts"; fail=1
fi

[ "$fail" -eq 0 ] || exit 1
echo "AC OK: có cột checksum tham chiếu, verify không còn tautology, có test tamper"
exit 0
