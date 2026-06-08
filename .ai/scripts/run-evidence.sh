#!/usr/bin/env bash
# run-evidence.sh TASK-ID
# Sinh evidence TẤT ĐỊNH cho một task. Đây là thực thể DUY NHẤT (cùng gate.sh)
# được phép ghi vào .ai/evidence/. Agent không bao giờ tự "kể" kết quả test/build.
# Tái dùng đúng lệnh của skill test-report (go test -coverprofile / go tool cover).
set -uo pipefail

TASK="${1:?usage: run-evidence.sh TASK-ID}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # .ai/scripts -> repo root
EV="$ROOT/.ai/evidence/$TASK"
AC="$ROOT/.ai/tasks/$TASK/$TASK.ac.sh"
NOW="$(date -u +%FT%TZ)"

cd "$ROOT"

# Mở khoá để tái ghi (file evidence được set 0444 ở cuối mỗi lần chạy).
mkdir -p "$EV"
chmod -R u+w "$EV" 2>/dev/null || true

echo "[run-evidence] $TASK @ $NOW"

# --- build + test + coverage theo TỪNG repo, BÊN TRONG worktree ---
# gate ghi repos{wt,base_sha} vào state lúc IN_PROGRESS. Build/test mỗi repo trong worktree
# của nó (code task nằm ở đây, không phải checkout chính). exit = tổng hợp (fail nếu BẤT KỲ
# repo nào fail); coverage.pct = MIN các repo. Mỗi repo được export AI_WT_<REPO>=<worktree>
# để ac.sh tự trỏ vào worktree (fallback checkout chính khi chạy tay).
SF="$ROOT/.ai/state/$TASK.json"
build_exit=0; test_exit=0; cov_min=""
: > "$EV/build.log"; : > "$EV/test.log"; : > "$EV/coverage.func.txt"
rm -f "$EV"/coverage-*.out 2>/dev/null || true

run_in_repo() { # REPO WT(relative|empty)
  local repo="$1" wt="$2" bdir envname rc cov pct
  if [ -n "$wt" ] && [ -d "$ROOT/$wt" ]; then bdir="$ROOT/$wt"; else bdir="$(cd "$ROOT/$repo" 2>/dev/null && pwd || echo "$ROOT")"; fi
  if [ "$repo" = "." ]; then envname="AI_WT_ROOT"; else
    envname="AI_WT_$(printf '%s' "$repo" | tr '[:lower:]./-' '[:upper:]___')"; fi
  export "$envname=$bdir"
  if [ ! -f "$bdir/go.mod" ]; then
    { echo "== [$repo] skip (no go.mod) @ $bdir =="; } | tee -a "$EV/build.log" >> "$EV/test.log"
    return 0
  fi
  echo "== [$repo] go build ./...  @ $bdir ==" >> "$EV/build.log"
  ( cd "$bdir" && go build ./... ) >> "$EV/build.log" 2>&1; rc=$?
  [ "$rc" -gt "$build_exit" ] && build_exit=$rc
  echo "== [$repo] go test ./...  @ $bdir ==" >> "$EV/test.log"
  cov="$EV/coverage-$(printf '%s' "$repo" | tr './' '__').out"
  ( cd "$bdir" && go test ./... -count=1 -timeout 120s -coverprofile="$cov" -v ) >> "$EV/test.log" 2>&1; rc=$?
  [ "$rc" -gt "$test_exit" ] && test_exit=$rc
  if [ -f "$cov" ]; then
    # cover phải chạy TRONG worktree để resolve được path nguồn (file chỉ tồn tại ở branch task)
    echo "== [$repo] ==" >> "$EV/coverage.func.txt"
    ( cd "$bdir" && go tool cover -func="$cov" ) >> "$EV/coverage.func.txt" 2>&1 || true
    pct="$( ( cd "$bdir" && go tool cover -func="$cov" ) 2>/dev/null | awk '/^total:/{gsub(/%/,"",$NF); print $NF}' | tail -1)"
    if [ -n "$pct" ]; then
      if [ -z "$cov_min" ]; then cov_min="$pct"
      else cov_min="$(awk -v a="$cov_min" -v b="$pct" 'BEGIN{print (b+0<a+0)?b:a}')"; fi
    fi
  fi
}

found_repo=0
while IFS=$'\t' read -r repo wt; do
  [ -z "$repo" ] && continue
  found_repo=1
  run_in_repo "$repo" "$wt"
done < <(jq -r '.repos // {} | to_entries[] | "\(.key)\t\(.value.wt)"' "$SF" 2>/dev/null)
# fallback: chưa có worktree trong state (repo đơn chưa qua IN_PROGRESS) -> build tại ROOT
[ "$found_repo" -eq 0 ] && run_in_repo "." ""

echo "$build_exit" > "$EV/build.exit"
echo "$test_exit" > "$EV/test.exit"
echo "${cov_min:-0.0}" > "$EV/coverage.pct"

# --- lint (optional; công cụ có thể chưa cài) ---
if command -v golangci-lint >/dev/null 2>&1; then
  golangci-lint run > "$EV/lint.log" 2>&1
  echo $? > "$EV/lint.exit"
else
  echo "golangci-lint not installed — skipped" > "$EV/lint.log"
  echo "skipped" > "$EV/lint.exit"
fi

# --- AC machine-verify (nếu task có .ac.sh) ---
if [ -f "$AC" ]; then
  bash "$AC" > "$EV/ac.log" 2>&1
  echo $? > "$EV/ac.exit"
else
  echo "no AC script for $TASK" > "$EV/ac.log"
  echo "na" > "$EV/ac.exit"
fi

# --- manifest: sha256 từng file + exit codes + coverage% (qua jq cho an toàn) ---
FILES_JSON="$(cd "$EV" && for f in *; do
    [ "$f" = "manifest.json" ] && continue
    [ -f "$f" ] || continue
    printf '%s\t%s\n' "$(shasum -a 256 "$f" | awk '{print $1}')" "$f"
  done | jq -Rn '[inputs | split("\t") | {(.[1]): .[0]}] | add // {}')"

jq -n \
  --arg task "$TASK" \
  --arg generated_at "$NOW" \
  --argjson build_exit "$(cat "$EV/build.exit")" \
  --argjson test_exit "$(cat "$EV/test.exit")" \
  --arg lint_exit "$(cat "$EV/lint.exit")" \
  --arg ac_exit "$(cat "$EV/ac.exit")" \
  --argjson coverage_pct "$(cat "$EV/coverage.pct")" \
  --argjson files "$FILES_JSON" \
  '{task:$task, generated_at:$generated_at,
    build_exit:$build_exit, test_exit:$test_exit,
    lint_exit:$lint_exit, ac_exit:$ac_exit,
    coverage_pct:$coverage_pct, files:$files}' \
  > "$EV/manifest.json"

# --- khoá evidence read-only (defense-in-depth; hook là lớp chính) ---
find "$EV" -type f -exec chmod 0444 {} +

echo "[run-evidence] done → $EV"
echo "  build_exit=$(cat "$EV/build.exit") test_exit=$(cat "$EV/test.exit") lint=$(cat "$EV/lint.exit") ac=$(cat "$EV/ac.exit") coverage=$(cat "$EV/coverage.pct")%"
