#!/usr/bin/env bash
# run-evidence.sh TASK-ID
# Sinh evidence TẤT ĐỊNH cho một task. Đây là thực thể DUY NHẤT (cùng gate.sh)
# được phép ghi vào .ai/evidence/. Agent không bao giờ tự "kể" kết quả test/build.
#
# ADAPTED FOR NODE (TypeScript): chạy lệnh build/test/lint đọc từ .ai/config.yml
# (mặc định pnpm + vitest), per-repo BÊN TRONG worktree mỗi repo.
# KHÁC bản Go cũ: repo KHÔNG có project (không package.json) -> build/test = "na"
# (KHÔNG còn skip->0 "xanh giả"). gate selfcheck chấp nhận "na" cho repo chưa có code.
set -uo pipefail

TASK="${1:?usage: run-evidence.sh TASK-ID}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # .ai/scripts -> repo root
CONFIG="$ROOT/.ai/config.yml"
EV="$ROOT/.ai/evidence/$TASK"
AC="$ROOT/.ai/tasks/$TASK/$TASK.ac.sh"
SF="$ROOT/.ai/state/$TASK.json"
NOW="$(date -u +%FT%TZ)"

cd "$ROOT"

# --- Thin-client: source MCP client for server calls (TASK_HUB_DESIGN.md §12) ---
# When TASK_HUB_URL is set, submit evidence to the server via MCP tool evidence.submit
# using a RUNNER token (distinct from implementer credentials — per §7 evidence/agent separation).
MCP_CLIENT="$ROOT/.ai/scripts/mcp-client.sh"
if [ -f "$MCP_CLIENT" ]; then
  # shellcheck source=./mcp-client.sh
  source "$MCP_CLIENT"
fi

# Submit evidence to the Task Hub server via MCP tool evidence.submit.
# Uses TASK_HUB_RUNNER_TOKEN (runner role) — distinct from implementer credentials.
# The server keys evidence by (project, key): key == TASK-id, project defaults
# to "default" (override with TASK_HUB_PROJECT). build/test/ac exits are coerced
# to integers (non-numeric "na"/"skipped" -> 0) since the tool requires ints.
TASK_HUB_PROJECT="${TASK_HUB_PROJECT:-default}"
server_evidence_submit() { # TASK MANIFEST_JSON BUILD_EXIT TEST_EXIT AC_EXIT LINT_EXIT COVERAGE_PCT
  [ -n "${TASK_HUB_URL:-}" ] && type mcp_call &>/dev/null || return 0
  local task="$1" manifest="$2" be="$3" te="$4" ae="$5" le="$6" cov="$7"
  # Runner token: TASK_HUB_RUNNER_TOKEN (falls back to TASK_HUB_TOKEN for dev convenience)
  local runner_token="${TASK_HUB_RUNNER_TOKEN:-${TASK_HUB_TOKEN:-}}"
  [ -n "$runner_token" ] || { warn "server: evidence.submit skipped — no RUNNER token set"; return 0; }
  # Coerce non-numeric exit codes (na/skipped) to 0 for the integer schema.
  local n_be n_te n_ae n_le n_cov
  n_be=$([[ "$be" =~ ^-?[0-9]+$ ]] && echo "$be" || echo 0)
  n_te=$([[ "$te" =~ ^-?[0-9]+$ ]] && echo "$te" || echo 0)
  n_ae=$([[ "$ae" =~ ^-?[0-9]+$ ]] && echo "$ae" || echo 0)
  n_le=$([[ "$le" =~ ^-?[0-9]+$ ]] && echo "$le" || echo 0)
  n_cov=$([[ "$cov" =~ ^-?[0-9]+(\.[0-9]+)?$ ]] && echo "$cov" || echo 0)
  TASK_HUB_TOKEN="$runner_token" mcp_call "evidence.submit" "$(jq -nc \
    --arg p "$TASK_HUB_PROJECT" --arg k "$task" --arg m "$manifest" \
    --argjson be "$n_be" --argjson te "$n_te" --argjson ae "$n_ae" --argjson le "$n_le" --argjson cov "$n_cov" \
    '{project:$p, key:$k, build_exit:$be, test_exit:$te, ac_exit:$ae, lint_exit:$le, coverage_pct:$cov, manifest_json:$m}')" \
    || warn "server: evidence.submit failed (offline fallback OK)"
}

# đọc lệnh từ config.yml (format inline: '  build: "pnpm build"')
cfg_cmd() { grep -E "^[[:space:]]*$1:[[:space:]]*\"" "$CONFIG" 2>/dev/null | head -1 | sed -E 's/^[^"]*"//; s/"[[:space:]]*$//'; }
BUILD_CMD="$(cfg_cmd build)"; BUILD_CMD="${BUILD_CMD:-pnpm build}"
TEST_CMD="$(cfg_cmd test)";   TEST_CMD="${TEST_CMD:-pnpm test}"
LINT_CMD="$(cfg_cmd lint)";   LINT_CMD="${LINT_CMD:-pnpm lint}"

# Mở khoá để tái ghi (evidence set 0444 ở cuối mỗi lần chạy).
mkdir -p "$EV"
chmod -R u+w "$EV" 2>/dev/null || true

echo "[run-evidence] $TASK @ $NOW  (build='$BUILD_CMD' test='$TEST_CMD')"

# --- build + test + coverage theo TỪNG repo, BÊN TRONG worktree ---
# build.exit/test.exit = tổng hợp (MAX qua các repo); coverage.pct = MIN qua các repo.
# ran_any=0 nghĩa là KHÔNG repo nào có project Node -> build/test = "na".
build_exit=0; test_exit=0; cov_min=""; ran_any=0; LINT_BDIR=""
: > "$EV/build.log"; : > "$EV/test.log"
rm -f "$EV"/coverage-*.json 2>/dev/null || true

run_in_repo() { # REPO WT(relative|empty)
  local repo="$1" wt="$2" bdir envname rc pct cs
  if [ -n "$wt" ] && [ -d "$ROOT/$wt" ]; then bdir="$ROOT/$wt"; else bdir="$(cd "$ROOT/$repo" 2>/dev/null && pwd || echo "$ROOT")"; fi
  if [ "$repo" = "." ]; then envname="AI_WT_ROOT"; else
    envname="AI_WT_$(printf '%s' "$repo" | tr '[:lower:]./-' '[:upper:]___')"; fi
  export "$envname=$bdir"

  if [ ! -f "$bdir/package.json" ]; then
    { echo "== [$repo] no package.json @ $bdir -> build/test skipped (na) =="; } | tee -a "$EV/build.log" >> "$EV/test.log"
    return 0
  fi
  ran_any=1
  [ -z "$LINT_BDIR" ] && LINT_BDIR="$bdir"

  echo "== [$repo] $BUILD_CMD  @ $bdir ==" >> "$EV/build.log"
  ( cd "$bdir" && bash -c "$BUILD_CMD" ) >> "$EV/build.log" 2>&1; rc=$?
  [ "$rc" -gt "$build_exit" ] && build_exit=$rc

  echo "== [$repo] $TEST_CMD  @ $bdir ==" >> "$EV/test.log"
  ( cd "$bdir" && bash -c "$TEST_CMD" ) >> "$EV/test.log" 2>&1; rc=$?
  [ "$rc" -gt "$test_exit" ] && test_exit=$rc

  # coverage: vitest reporter 'json-summary' -> coverage/coverage-summary.json (.total.lines.pct)
  cs="$bdir/coverage/coverage-summary.json"
  if [ -f "$cs" ]; then
    cp "$cs" "$EV/coverage-$(printf '%s' "$repo" | tr './' '__').json" 2>/dev/null || true
    pct="$(jq -r '.total.lines.pct // empty' "$cs" 2>/dev/null)"
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
# fallback: chưa có worktree trong state (repo đơn chưa qua IN_PROGRESS) -> chạy tại ROOT
[ "$found_repo" -eq 0 ] && run_in_repo "." ""

if [ "$ran_any" -eq 0 ]; then
  # không repo nào có project Node -> build/test KHÔNG áp dụng (na), KHÔNG phải pass giả
  echo "na" > "$EV/build.exit"; echo "na" > "$EV/test.exit"; echo "0.0" > "$EV/coverage.pct"
  echo "  (no package.json in any repo -> build/test = na)"
else
  echo "$build_exit" > "$EV/build.exit"
  echo "$test_exit" > "$EV/test.exit"
  echo "${cov_min:-0.0}" > "$EV/coverage.pct"
fi

# --- lint (optional; chỉ chạy nếu repo có script "lint") ---
if [ -n "$LINT_BDIR" ] && grep -q '"lint"' "$LINT_BDIR/package.json" 2>/dev/null; then
  ( cd "$LINT_BDIR" && bash -c "$LINT_CMD" ) > "$EV/lint.log" 2>&1
  echo $? > "$EV/lint.exit"
else
  echo "no lint script — skipped" > "$EV/lint.log"
  echo "skipped" > "$EV/lint.exit"
fi

# --- AC machine-verify (nếu task có .ac.sh; ac.sh tự cd vào worktree qua AI_WT_<REPO>) ---
if [ -f "$AC" ]; then
  bash "$AC" > "$EV/ac.log" 2>&1
  echo $? > "$EV/ac.exit"
else
  echo "no AC script for $TASK" > "$EV/ac.log"
  echo "na" > "$EV/ac.exit"
fi

# --- manifest: sha256 từng file + exit codes + coverage% (qua jq cho an toàn) ---
# build/test/lint/ac là string (có thể "na"/"skipped"); coverage là số.
FILES_JSON="$(cd "$EV" && for f in *; do
    [ "$f" = "manifest.json" ] && continue
    [ -f "$f" ] || continue
    printf '%s\t%s\n' "$(shasum -a 256 "$f" | awk '{print $1}')" "$f"
  done | jq -Rn '[inputs | split("\t") | {(.[1]): .[0]}] | add // {}')"

jq -n \
  --arg task "$TASK" \
  --arg generated_at "$NOW" \
  --arg build_exit "$(cat "$EV/build.exit")" \
  --arg test_exit "$(cat "$EV/test.exit")" \
  --arg lint_exit "$(cat "$EV/lint.exit")" \
  --arg ac_exit "$(cat "$EV/ac.exit")" \
  --argjson coverage_pct "$(cat "$EV/coverage.pct")" \
  --argjson files "$FILES_JSON" \
  '{task:$task, generated_at:$generated_at,
    build_exit:$build_exit, test_exit:$test_exit,
    lint_exit:$lint_exit, ac_exit:$ac_exit,
    coverage_pct:$coverage_pct, files:$files}' \
  > "$EV/manifest.json"

# --- Thin-client: submit evidence to server via MCP evidence.submit (P8 / §12) ---
# Uses the RUNNER token (TASK_HUB_RUNNER_TOKEN) — distinct from implementer credentials.
if [ -f "$EV/manifest.json" ]; then
  MANIFEST_JSON="$(cat "$EV/manifest.json")"
  server_evidence_submit "$TASK" "$MANIFEST_JSON" \
    "$(cat "$EV/build.exit")" "$(cat "$EV/test.exit")" "$(cat "$EV/ac.exit")" \
    "$(cat "$EV/lint.exit")" "$(cat "$EV/coverage.pct")"
fi

# --- khoá evidence read-only (defense-in-depth; hook là lớp chính) ---
find "$EV" -type f -exec chmod 0444 {} +

echo "[run-evidence] done → $EV"
echo "  build_exit=$(cat "$EV/build.exit") test_exit=$(cat "$EV/test.exit") lint=$(cat "$EV/lint.exit") ac=$(cat "$EV/ac.exit") coverage=$(cat "$EV/coverage.pct")%"
