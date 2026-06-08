#!/usr/bin/env bash
# new-task.sh "Title" [--id TASK-NNN] [--ac] [--repos ". a b"] [--branch fix/...]
# Tạo skeleton task cho workflow: .ai/tasks/<ID>/<ID>.md (+ tùy chọn <ID>/<ID>.ac.sh) rồi gate.sh init.
# Tự sinh ID kế tiếp (TASK-NNN) nếu không truyền --id.
# Repos/Branch: khai báo repo task đụng + branch worktree chung (gate đọc lúc IN_PROGRESS).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # .ai/scripts -> repo root
TASKS="$ROOT/.ai/tasks"
mkdir -p "$TASKS"

TITLE=""; ID=""; WITH_AC=0; REPOS="."; BRANCH=""
while [ $# -gt 0 ]; do
  case "$1" in
    --id) ID="$2"; shift 2 ;;
    --ac) WITH_AC=1; shift ;;
    --repos) REPOS="$2"; shift 2 ;;     # danh sách repo task đụng (mặc định '.')
    --branch) BRANCH="$2"; shift 2 ;;   # branch worktree chung (mặc định fix/<ID>)
    -*) echo "unknown flag: $1" >&2; exit 1 ;;
    *) TITLE="$1"; shift ;;
  esac
done
[ -n "$TITLE" ] || { echo "usage: new-task.sh \"Title\" [--id TASK-NNN] [--ac] [--repos \". a b\"] [--branch fix/...]" >&2; exit 1; }

# auto ID = max(TASK-NNN) + 1 (mỗi task là một folder .ai/tasks/TASK-NNN/)
if [ -z "$ID" ]; then
  last="$(ls -d "$TASKS"/TASK-*/ 2>/dev/null | sed -E 's#.*/TASK-([0-9]+)/?#\1#' | sort -n | tail -1)"
  next="$(printf '%03d' "$(( 10#${last:-0} + 1 ))")"
  ID="TASK-$next"
fi
[ -n "$BRANCH" ] || BRANCH="fix/$ID"
DIR="$TASKS/$ID"
MD="$DIR/$ID.md"
AC="$DIR/$ID.ac.sh"
[ -d "$DIR" ] && { echo "$ID đã tồn tại: $DIR" >&2; exit 1; }
mkdir -p "$DIR"

cat > "$MD" <<EOF
# $ID: $TITLE

Repos: $REPOS
Branch: $BRANCH

## Purpose
<vì sao cần task này>

## Scope
- In scope: <…>
- Out of scope: <…>

## Acceptance Criteria

### Machine-verifiable (chấm bởi $ID.ac.sh + gate; build/test/ac luôn hard-required)
- [ ] AC1: \`go build ./...\` succeeds (build.exit == 0).
- [ ] AC2: \`go test ./...\` passes (test.exit == 0).
- [ ] AC3: <điều kiện đo được — viết vào $ID.ac.sh để gate tự chấm>

### Human / semantic (Judge + Human)
- [ ] AC4: <không tautology / không t.Skip / không xóa assertion để qua>
- [ ] AC5: <error path / edge case được cover>

## Definition of Done
Mọi machine-verifiable AC pass dưới evidence mới sinh, Judge \`VERDICT: PASS\`, và human \`.ai/scripts/gate.sh approve $ID\`.

## Dependencies
<none | TASK-xxx>

## References
- .ai/WORKFLOW_DESIGN.md
EOF

if [ "$WITH_AC" -eq 1 ]; then
  cat > "$AC" <<'EOF'
#!/usr/bin/env bash
# Machine-verifiable Acceptance Criteria. Exit 0 = tất cả AC đạt; non-zero = fail.
# VIẾT KIỂM TRA THẬT vào đây. Mặc định fail để buộc tác giả định nghĩa AC.
#
# QUAN TRỌNG — chạy trong WORKTREE: runner export AI_WT_<REPO> trỏ vào worktree chứa code task.
#   repo '.'      -> ${AI_WT_ROOT:-$ROOT}
#   repo 'x-y-z'  -> ${AI_WT_X_Y_Z:-$ROOT/x-y-z}   (UPPERCASE; '.', '/', '-' -> '_')
# Luôn neo qua biến này (fallback checkout chính để chạy tay vẫn được); KHÔNG hard-code path.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"   # .ai/tasks/<ID> -> repo root
cd "${AI_WT_ROOT:-$ROOT}"

echo "TODO: define machine-verifiable AC for this task"
exit 1
EOF
  chmod +x "$AC"
fi

"$ROOT/.ai/scripts/gate.sh" init "$ID" >/dev/null

echo "Created $ID"
echo "  spec : $MD"
[ "$WITH_AC" -eq 1 ] && echo "  ac   : $AC  (đang exit 1 — hãy viết kiểm tra thật)"
echo "  state: $("$ROOT/.ai/scripts/gate.sh" state "$ID")"
echo
echo "Tiếp theo: sửa $MD (và .ac.sh nếu có) → /impl $ID → /selfcheck $ID → /judge $ID → .ai/scripts/gate.sh approve $ID"
