#!/usr/bin/env bash
# gate.sh — thực thể TẤT ĐỊNH duy nhất (cùng run-evidence.sh) được ghi .ai/state/.
# Không agent nào được tự chuyển state; agent chỉ GỌI gate, gate tự kiểm tra
# evidence rồi mới ghi. Đây là chốt chặn chống false-positive completion.
#
# Lệnh:
#   gate.sh init     TASK [STATE]      -> tạo state file (mặc định TODO)
#   gate.sh state    TASK              -> in state hiện tại
#   gate.sh worktrees TASK            -> in branch + path worktree mỗi repo (cho implementer)
#   gate.sh propose  TASK FROM TO ACTOR-> agent đề xuất chuyển state (có guard)
#   gate.sh selfcheck TASK             -> gate tự chấm từ evidence -> SELF_CHECK_PASSED/FAILED
#   gate.sh approve  TASK              -> CHỈ HUMAN: JUDGE_PASSED -> DONE
#   gate.sh merge    TASK              -> CHỈ DONE: merge branch worktree -> current branch mỗi repo,
#                                         clean thì gỡ worktree/branch (giữ task); conflict thì dựng
#                                         integration worktree (exit 2) cho agent resolve rồi merge-finish
#   gate.sh merge-finish TASK          -> sau khi agent resolve+commit trong integration worktree:
#                                         FF current branch -> integration, gỡ integration + worktree/branch task
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # .ai/scripts -> repo root
CONFIG="$ROOT/.ai/config.yml"
NOW="$(date -u +%FT%TZ)"

die()  { echo "GATE REJECT: $*" >&2; exit 1; }
ok()   { echo "GATE OK: $*"; }
warn() { echo "GATE WARN: $*"; }

state_file() { echo "$ROOT/.ai/state/$1.json"; }
log_file()   { echo "$ROOT/.ai/state/$1.log"; }
ev_dir()     { echo "$ROOT/.ai/evidence/$1"; }
report()     { echo "$ROOT/.ai/reports/$1/$2"; }
task_md()    { echo "$ROOT/.ai/tasks/$1/$1.md"; }

# ---- worktree / N-repo helpers (khai báo: 'Repos:'/'Branch:' trong task md) ----
# Repos: danh sách repo (path tương đối $ROOT) task đụng. Mặc định '.' (repo gốc).
task_repos() { # TASK
  local line; line="$(grep -iE '^[[:space:]]*Repos:[[:space:]]*' "$(task_md "$1")" 2>/dev/null \
    | head -1 | sed -E 's/^[[:space:]]*[Rr]epos:[[:space:]]*//')"
  [ -n "${line// }" ] && echo "$line" || echo "."
}
# Branch: tên branch chung mọi repo của task (slug AI sinh @newtask). Fallback fix/<TASK>.
task_branch() { # TASK
  local line; line="$(grep -iE '^[[:space:]]*Branch:[[:space:]]*' "$(task_md "$1")" 2>/dev/null \
    | head -1 | sed -E 's/^[[:space:]]*[Bb]ranch:[[:space:]]*//' | tr -d '[:space:]')"
  [ -n "$line" ] && echo "$line" || echo "fix/$1"
}
repo_dir() { if [ "$1" = "." ]; then echo "$ROOT"; else echo "$ROOT/$1"; fi; }     # checkout chính
repo_wt()  { echo "$(repo_dir "$2")/.claude/worktree/$(task_branch "$1")"; }        # TASK REPO -> worktree

# Tạo branch + worktree mỗi repo khi vào IN_PROGRESS; tái dùng nếu đã có (rework).
# Ghi branch + repos{base_sha,base_ref,wt} vào state (nguồn sự thật cho runner/judge).
worktree_init() { # TASK
  local task="$1" sf br r rd wt excl base_sha base_ref reposjson='{}'
  sf="$(state_file "$task")"; br="$(task_branch "$task")"
  for r in $(task_repos "$task"); do
    rd="$(repo_dir "$r")"
    [ -d "$rd/.git" ] || die "repo '$r' không phải git repo ($rd) — sửa 'Repos:' trong $task.md"
    wt="$(repo_wt "$task" "$r")"
    excl="$rd/.git/info/exclude"
    if [ -f "$excl" ] && ! grep -qxF ".claude/worktree/" "$excl" 2>/dev/null; then
      printf '%s\n' ".claude/worktree/" >> "$excl"
    fi
    if [ -d "$wt" ]; then
      base_sha="$(jq -r --arg r "$r" '.repos[$r].base_sha // ""' "$sf")"
      base_ref="$(jq -r --arg r "$r" '.repos[$r].base_ref // ""' "$sf")"
      warn "$r: worktree đã tồn tại, tái dùng (${wt#$ROOT/})"
    else
      base_sha="$(git -C "$rd" rev-parse HEAD 2>/dev/null)" || die "$r: không lấy được HEAD"
      base_ref="$(git -C "$rd" rev-parse --abbrev-ref HEAD 2>/dev/null)"
      mkdir -p "$(dirname "$wt")"
      if git -C "$rd" show-ref --verify --quiet "refs/heads/$br"; then
        git -C "$rd" worktree add "$wt" "$br" >/dev/null 2>&1 || die "$r: worktree add (branch sẵn có '$br') thất bại"
      else
        git -C "$rd" worktree add -b "$br" "$wt" "$base_sha" >/dev/null 2>&1 || die "$r: worktree add -b '$br' thất bại"
      fi
      ok "$r: worktree ${wt#$ROOT/} (branch $br ⟵ $base_ref@${base_sha:0:8})"
    fi
    reposjson="$(jq -n --argjson cur "$reposjson" --arg r "$r" --arg bs "$base_sha" --arg bref "$base_ref" --arg wt "${wt#$ROOT/}" \
      '$cur + {($r): {base_sha:$bs, base_ref:$bref, wt:$wt}}')"
  done
  local tmp; tmp="$(mktemp)"
  jq --arg br "$br" --argjson repos "$reposjson" '.branch=$br | .repos=$repos' "$sf" > "$tmp" && mv "$tmp" "$sf"
}

# Gỡ worktree + xoá branch của task (reset/remove).
worktree_teardown() { # TASK
  local task="$1" sf br r rd wt; sf="$(state_file "$task")"
  [ -f "$sf" ] || return 0
  br="$(jq -r '.branch // ""' "$sf")"
  while IFS=$'\t' read -r r wt; do
    [ -z "$r" ] && continue
    rd="$(repo_dir "$r")"; [ -d "$rd/.git" ] || continue
    git -C "$rd" worktree remove --force "$ROOT/$wt" 2>/dev/null || rm -rf "$ROOT/$wt"
    git -C "$rd" worktree prune 2>/dev/null || true
    [ -n "$br" ] && git -C "$rd" branch -D "$br" 2>/dev/null || true
  done < <(jq -r '.repos // {} | to_entries[] | "\(.key)\t\(.value.wt)"' "$sf")
}

cur_state() {
  local sf; sf="$(state_file "$1")"
  [ -f "$sf" ] || die "no state file for $1 (run: gate.sh init $1)"
  jq -r '.state' "$sf"
}

# ---- config readers (grep theo format inline trong config.yml) ----
cfg_mode() { grep -E "^[[:space:]]*$1:" "$CONFIG" | grep -oE 'mode:[[:space:]]*[a-z]+' | awk '{print $2}' | head -1; }
cfg_threshold() { grep -E '^[[:space:]]*coverage:' "$CONFIG" | grep -oE 'threshold:[[:space:]]*[0-9]+' | grep -oE '[0-9]+' | head -1; }
cfg_fastpath()  { grep -E '^[[:space:]]*fast_path:' "$CONFIG" | grep -oE '(true|false)' | head -1; }

# ---- bảng transition hợp lệ: "FROM>TO:ACTOR" ----
ALLOWED="
TODO>IN_PROGRESS:implementer
IN_PROGRESS>IMPLEMENTED:implementer
IMPLEMENTED>SELF_CHECK_PASSED:gate
IMPLEMENTED>SELF_CHECK_FAILED:gate
SELF_CHECK_FAILED>IN_PROGRESS:implementer
SELF_CHECK_PASSED>JUDGE_PASSED:judge
SELF_CHECK_PASSED>JUDGE_REJECTED:judge
JUDGE_REJECTED>IN_PROGRESS:implementer
JUDGE_PASSED>DONE:human
"

transition_allowed() { echo "$ALLOWED" | grep -qx "$1>$2:$3"; }

write_state() { # TASK NEW ACTOR EVIDENCE_REF NOTE
  local task="$1" new="$2" actor="$3" ref="${4:-}" note="${5:-}"
  local sf lf old; sf="$(state_file "$task")"; lf="$(log_file "$task")"
  old="$(jq -r '.state' "$sf")"
  local tmp; tmp="$(mktemp)"
  jq --arg s "$new" --arg a "$actor" --arg t "$NOW" --arg r "$ref" --arg n "$note" --arg o "$old" \
    '.state=$s | .actor=$a | .updated=$t | .evidence_ref=$r |
     .history += [{from:$o, to:$s, actor:$a, at:$t, ref:$r, note:$n}]' \
    "$sf" > "$tmp" && mv "$tmp" "$sf"
  printf '%s\t%s\t%s -> %s\tactor=%s\tref=%s\t%s\n' "$NOW" "$task" "$old" "$new" "$actor" "$ref" "$note" >> "$lf"
  ok "$task: $old -> $new (actor=$actor)"
}

# ---- guard IN_PROGRESS->IMPLEMENTED: code task PHẢI nằm TRONG worktree ----
# Cưỡng chế cô lập: checkout chính của mỗi repo phải SẠCH và HEAD==base (code không rò ra
# main tree -> nếu có thì REJECT), đồng thời worktree phải có thay đổi vs base (đã làm thật).
guard_implemented() { # TASK
  local task="$1" sf r rd wt base any_change=0 md
  sf="$(state_file "$task")"
  [ -f "$(report "$task" implementer.md)" ] || die "thiếu reports/$task/implementer.md"
  for r in $(task_repos "$task"); do
    rd="$(repo_dir "$r")"
    wt="$ROOT/$(jq -r --arg r "$r" '.repos[$r].wt // ""' "$sf")"
    base="$(jq -r --arg r "$r" '.repos[$r].base_sha // ""' "$sf")"
    [ -d "$wt" ] || die "$r: thiếu worktree (chạy lại propose TODO->IN_PROGRESS). Code task phải nằm trong worktree."
    # (a) checkout chính phải SẠCH (loại .ai/.claude) — code task không được nằm ngoài worktree
    if [ -n "$(git -C "$rd" status --porcelain -- . ':(exclude).ai' ':(exclude).claude' 2>/dev/null)" ]; then
      die "$r: checkout chính ($rd) có thay đổi chưa commit. Code task PHẢI nằm trong worktree, không phải main tree. REJECT."
    fi
    # (a') branch chính không được advance ngoài worktree
    if [ -n "$base" ] && [ "$(git -C "$rd" rev-parse HEAD 2>/dev/null)" != "$base" ]; then
      die "$r: branch chính có commit mới ngoài worktree (HEAD != base). Code task PHẢI nằm trong worktree. REJECT."
    fi
    # (b) worktree phải có thay đổi vs base (commit lên branch hoặc uncommitted)
    [ -n "$(git -C "$wt" status --porcelain -- . ':(exclude).ai' ':(exclude).claude' 2>/dev/null)" ] && any_change=1
    [ -n "$base" ] && [ -n "$(git -C "$wt" diff --name-only "$base" -- . ':(exclude).ai' ':(exclude).claude' 2>/dev/null)" ] && any_change=1
  done
  [ "$any_change" -eq 1 ] && return 0
  md="$(task_md "$task")"
  if grep -qiE '^Allow-No-Code-Change:[[:space:]]*true' "$md" 2>/dev/null; then
    warn "$task: worktree không có thay đổi nhưng task khai báo Allow-No-Code-Change: true (do người tạo task quyết định)"
    return 0
  fi
  die "không repo nào có thay đổi trong worktree kể từ base — Implementer chưa làm gì. Nếu task thực sự không cần đổi code, NGƯỜI TẠO TASK thêm 'Allow-No-Code-Change: true' vào $task.md."
}

verify_checksums() { # so sánh sha256 thực tế với manifest -> chống sửa lén evidence
  local task="$1" ev mani; ev="$(ev_dir "$task")"; mani="$ev/manifest.json"
  [ -f "$mani" ] || die "thiếu evidence/$task/manifest.json — chạy run-evidence.sh trước"
  local bad=0 f want got
  while IFS=$'\t' read -r f want; do
    [ -z "$f" ] && continue
    if [ ! -f "$ev/$f" ]; then echo "  MISSING $f"; bad=1; continue; fi
    got="$(shasum -a 256 "$ev/$f" | awk '{print $1}')"
    if [ "$got" != "$want" ]; then echo "  TAMPERED $f"; bad=1; fi
  done < <(jq -r '.files | to_entries[] | "\(.key)\t\(.value)"' "$mani")
  [ "$bad" -eq 0 ] || die "evidence checksum không khớp manifest — nghi bị sửa lén"
}

# =====================================================================
cmd="${1:-}"; task="${2:-}"
[ -n "$cmd" ] || die "usage: gate.sh <init|state|worktrees|propose|selfcheck|approve|merge|merge-finish|reset|remove> ..."

case "$cmd" in
  init)
    [ -n "$task" ] || die "usage: gate.sh init TASK [STATE]"
    init_state="${3:-TODO}"
    sf="$(state_file "$task")"
    mkdir -p "$(dirname "$sf")" "$ROOT/.ai/reports/$task"
    [ -f "$sf" ] && die "$task đã có state file"
    jq -n --arg t "$task" --arg s "$init_state" --arg at "$NOW" \
      '{task:$t, state:$s, actor:"system", updated:$at, evidence_ref:null, history:[{from:null,to:$s,actor:"system",at:$at}]}' \
      > "$sf"
    printf '%s\t%s\tinit -> %s\n' "$NOW" "$task" "$init_state" >> "$(log_file "$task")"
    ok "$task khởi tạo state=$init_state"
    ;;

  state)
    [ -n "$task" ] || die "usage: gate.sh state TASK"
    cur_state "$task"
    ;;

  worktrees)
    # in branch + path worktree mỗi repo (implementer cd vào đây để làm việc)
    [ -n "$task" ] || die "usage: gate.sh worktrees TASK"
    sf="$(state_file "$task")"; [ -f "$sf" ] || die "no state file for $task"
    echo "branch: $(jq -r '.branch // "(chưa tạo — propose TODO->IN_PROGRESS trước)"' "$sf")"
    jq -r '.repos // {} | to_entries[] | "  \(.key)\t\(.value.wt)"' "$sf" 2>/dev/null \
      | while IFS=$'\t' read -r r w; do echo "$r -> $ROOT/$w"; done
    ;;

  propose)
    # gate.sh propose TASK FROM TO ACTOR
    from="${3:?FROM}"; to="${4:?TO}"; actor="${5:?ACTOR}"
    real="$(cur_state "$task")"
    [ "$real" = "$from" ] || die "state thực tế là '$real', không phải '$from'"
    [ "$to" = "DONE" ] && die "DONE chỉ được set qua 'gate.sh approve' bởi human"
    if [ "$actor" = "gate" ] || [ "$actor" = "human" ]; then die "actor '$actor' không được dùng qua propose (dành cho selfcheck/approve)"; fi
    transition_allowed "$from" "$to" "$actor" || die "transition không hợp lệ: $from -> $to bởi $actor"

    case "$to" in
      IMPLEMENTED) guard_implemented "$task" ;;
      JUDGE_PASSED)
        jf="$(report "$task" judge.md)"
        [ -f "$jf" ] || die "thiếu reports/$task/judge.md"
        grep -Eq '^VERDICT:[[:space:]]*PASS([[:space:]]|$)' "$jf" || die "judge.md không có 'VERDICT: PASS'"
        verify_checksums "$task"
        ;;
      JUDGE_REJECTED)
        jf="$(report "$task" judge.md)"
        [ -f "$jf" ] || die "thiếu reports/$task/judge.md"
        grep -Eq '^VERDICT:[[:space:]]*REJECT([[:space:]]|$)' "$jf" || die "judge.md không có 'VERDICT: REJECT'"
        ;;
    esac
    write_state "$task" "$to" "$actor" "$(ev_dir "$task")"
    # vào IN_PROGRESS: tạo (hoặc tái dùng khi rework) branch + worktree cho từng repo
    if [ "$to" = "IN_PROGRESS" ]; then
      worktree_init "$task"
    fi
    ;;

  selfcheck)
    # gate TỰ chấm từ evidence (không tin agent). IMPLEMENTED -> SELF_CHECK_PASSED/FAILED
    [ -n "$task" ] || die "usage: gate.sh selfcheck TASK"
    real="$(cur_state "$task")"
    [ "$real" = "IMPLEMENTED" ] || die "selfcheck yêu cầu state=IMPLEMENTED (hiện: $real)"
    verify_checksums "$task"

    ev="$(ev_dir "$task")"
    be="$(cat "$ev/build.exit")"; te="$(cat "$ev/test.exit")"
    ae="$(cat "$ev/ac.exit")"; le="$(cat "$ev/lint.exit")"
    cov="$(cat "$ev/coverage.pct")"

    fail=""; notes=""
    # --- required cứng ('na' = repo chưa có project build được; honest, không phải pass giả) ---
    [ "$be" = "0" ] || [ "$be" = "na" ] || fail="$fail build($be)"
    [ "$te" = "0" ] || [ "$te" = "na" ] || fail="$fail test($te)"
    [ "$ae" = "0" ] || [ "$ae" = "na" ] || fail="$fail ac($ae)"
    [ "$be" = "na" ] && notes="$notes [warn:build=na — no buildable project]"
    [ "$te" = "na" ] && notes="$notes [warn:test=na — no test project]"

    # --- optional theo config ---
    lint_mode="$(cfg_mode lint)"; cov_mode="$(cfg_mode coverage)"; thr="$(cfg_threshold)"; thr="${thr:-80}"
    if [ "$le" != "0" ] && [ "$le" != "skipped" ]; then
      if [ "$lint_mode" = "required" ]; then fail="$fail lint($le)"; else notes="$notes [warn:lint=$le optional]"; fi
    fi
    cov_ok="$(awk -v c="$cov" -v t="$thr" 'BEGIN{print (c+0>=t+0)?1:0}')"
    if [ "$cov_ok" != "1" ]; then
      if [ "$cov_mode" = "required" ]; then fail="$fail coverage($cov<$thr)"; else notes="$notes [warn:coverage $cov%<$thr% optional]"; fi
    fi

    if [ -n "$fail" ]; then
      write_state "$task" "SELF_CHECK_FAILED" "gate" "$ev" "FAILED:$fail$notes"
      die "self-check FAILED:$fail$notes"
    else
      write_state "$task" "SELF_CHECK_PASSED" "gate" "$ev" "PASSED$notes"
      ok "self-check PASSED$notes"
    fi
    ;;

  approve)
    # CHỈ HUMAN. JUDGE_PASSED -> DONE
    [ -n "$task" ] || die "usage: gate.sh approve TASK"
    real="$(cur_state "$task")"
    [ "$real" = "JUDGE_PASSED" ] || die "approve yêu cầu state=JUDGE_PASSED (hiện: $real)"
    transition_allowed "JUDGE_PASSED" "DONE" "human" || die "transition không hợp lệ"
    write_state "$task" "DONE" "human" "$(ev_dir "$task")" "approved by $(whoami)"
    ;;

  merge)
    # CHỈ DONE: merge branch worktree -> current branch mỗi repo. KHÔNG xoá task.
    # Clean  -> merge thẳng + gỡ worktree/branch task (giữ task).
    # Conflict -> KHÔNG để main tree bẩn: abort, dựng integration worktree từ current branch,
    #             merge branch task vào đó (để conflict lại), exit 2. Agent resolve+commit trong
    #             integration worktree rồi chạy 'gate.sh merge-finish'.
    [ -n "$task" ] || die "usage: gate.sh merge TASK"
    sf="$(state_file "$task")"; [ -f "$sf" ] || die "no state file for $task"
    [ "$(cur_state "$task")" = "DONE" ] || die "merge yêu cầu state=DONE (đã approve). Hiện: $(cur_state "$task")"
    br="$(jq -r '.branch // ""' "$sf")"
    [ -n "$br" ] || die "$task chưa có branch worktree (chưa từng vào IN_PROGRESS)"

    mergejson='{}'; need_resolve=0
    for r in $(task_repos "$task"); do
      rd="$(repo_dir "$r")"
      [ -d "$rd/.git" ] || die "$r: không phải git repo ($rd)"
      wt="$ROOT/$(jq -r --arg r "$r" '.repos[$r].wt // ""' "$sf")"
      git -C "$rd" show-ref --verify --quiet "refs/heads/$br" || die "$r: branch '$br' không tồn tại"
      cur="$(git -C "$rd" rev-parse --abbrev-ref HEAD 2>/dev/null)"
      [ "$cur" = "HEAD" ] && die "$r: checkout chính đang detached HEAD — checkout branch đích trước khi merge"
      [ "$cur" = "$br" ] && die "$r: checkout chính đang đứng trên '$br' — checkout branch đích trước khi merge"
      [ -z "$(git -C "$rd" status --porcelain -- . ':(exclude).ai' ':(exclude).claude' 2>/dev/null)" ] \
        || die "$r: checkout chính ($rd) chưa sạch — commit/stash trước khi merge"
      if [ -d "$wt" ] && [ -n "$(git -C "$wt" status --porcelain -- . ':(exclude).ai' ':(exclude).claude' 2>/dev/null)" ]; then
        die "$r: worktree task ($wt) còn thay đổi chưa commit — commit trong worktree trước khi merge"
      fi
      if git -C "$rd" merge --no-edit -m "Merge branch '$br' ($task) into $cur" "$br" >/dev/null 2>&1; then
        ok "$r: merged '$br' -> $cur (clean)"
        mergejson="$(jq -n --argjson c "$mergejson" --arg r "$r" --arg t "$cur" '$c + {($r):{target:$t, mode:"merged"}}')"
      else
        git -C "$rd" merge --abort 2>/dev/null || true
        ibr="integrate/$task"; iwt="$rd/.claude/worktree/$ibr"
        if [ -d "$iwt" ]; then
          git -C "$rd" worktree remove --force "$iwt" 2>/dev/null || rm -rf "$iwt"
          git -C "$rd" worktree prune 2>/dev/null || true
          git -C "$rd" branch -D "$ibr" 2>/dev/null || true
        fi
        mkdir -p "$(dirname "$iwt")"
        git -C "$rd" worktree add -b "$ibr" "$iwt" HEAD >/dev/null 2>&1 \
          || die "$r: tạo integration worktree thất bại"
        git -C "$iwt" merge --no-edit -m "Merge branch '$br' ($task) into $cur" "$br" >/dev/null 2>&1 || true
        conflicts="$(git -C "$iwt" diff --name-only --diff-filter=U 2>/dev/null | tr '\n' ' ')"
        need_resolve=1
        warn "$r: CONFLICT — integration worktree: ${iwt#$ROOT/}"
        warn "$r:   file conflict: ${conflicts:-(merge dừng, xem git -C $iwt status)}"
        mergejson="$(jq -n --argjson c "$mergejson" --arg r "$r" --arg t "$cur" --arg ib "$ibr" --arg iw "${iwt#$ROOT/}" \
          '$c + {($r):{target:$t, mode:"integrating", integ_branch:$ib, integ_wt:$iw}}')"
      fi
    done

    tmp="$(mktemp)"; jq --argjson m "$mergejson" '.merge={repos:$m}' "$sf" > "$tmp" && mv "$tmp" "$sf"

    if [ "$need_resolve" = "1" ]; then
      echo "MERGE_CONFLICT: resolve conflict trong (các) integration worktree ở trên, 'git add' + 'git commit', rồi chạy: .ai/scripts/gate.sh merge-finish $task" >&2
      exit 2
    fi
    worktree_teardown "$task"
    tmp="$(mktemp)"; jq 'del(.branch,.repos,.merge) | .merged=true' "$sf" > "$tmp" && mv "$tmp" "$sf"
    printf '%s\t%s\tmerge -> done (clean)\tactor=human\n' "$NOW" "$task" >> "$(log_file "$task")"
    ok "$task: merged toàn bộ repo vào current branch; worktree/branch task đã gỡ (task giữ nguyên)"
    ;;

  merge-finish)
    # Hoàn tất merge sau khi agent resolve conflict + commit trong integration worktree.
    [ -n "$task" ] || die "usage: gate.sh merge-finish TASK"
    sf="$(state_file "$task")"; [ -f "$sf" ] || die "no state file for $task"
    jq -e '.merge.repos' "$sf" >/dev/null 2>&1 || die "$task không ở giữa quá trình merge (chạy gate.sh merge trước)"
    while IFS=$'\t' read -r r mode target ibr iwtrel; do
      [ -z "$r" ] && continue
      [ "$mode" = "integrating" ] || continue
      rd="$(repo_dir "$r")"; iwt="$ROOT/$iwtrel"
      [ -d "$iwt" ] || die "$r: thiếu integration worktree ($iwtrel) — chạy lại gate.sh merge"
      git -C "$iwt" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 \
        && die "$r: integration worktree còn merge dở — resolve + 'git commit' trong $iwtrel trước"
      [ -z "$(git -C "$iwt" diff --name-only --diff-filter=U 2>/dev/null)" ] \
        || die "$r: còn file conflict chưa resolve trong $iwtrel"
      [ -z "$(git -C "$iwt" status --porcelain 2>/dev/null)" ] \
        || die "$r: integration worktree còn thay đổi chưa commit ($iwtrel)"
      cur="$(git -C "$rd" rev-parse --abbrev-ref HEAD 2>/dev/null)"
      [ "$cur" = "$target" ] || die "$r: checkout chính đang ở '$cur', không phải '$target' — checkout lại trước khi finish"
      [ -z "$(git -C "$rd" status --porcelain -- . ':(exclude).ai' ':(exclude).claude' 2>/dev/null)" ] \
        || die "$r: checkout chính chưa sạch"
      git -C "$rd" merge --ff-only "$ibr" >/dev/null 2>&1 \
        || die "$r: không FF được '$target' -> '$ibr' (branch đích đã dịch chuyển?)"
      ok "$r: merged (qua integration) -> $target"
      git -C "$rd" worktree remove --force "$iwt" 2>/dev/null || rm -rf "$iwt"
      git -C "$rd" worktree prune 2>/dev/null || true
      git -C "$rd" branch -D "$ibr" 2>/dev/null || true
    done < <(jq -r '.merge.repos | to_entries[] | "\(.key)\t\(.value.mode)\t\(.value.target)\t\(.value.integ_branch // "")\t\(.value.integ_wt // "")"' "$sf")

    worktree_teardown "$task"
    tmp="$(mktemp)"; jq 'del(.branch,.repos,.merge) | .merged=true' "$sf" > "$tmp" && mv "$tmp" "$sf"
    printf '%s\t%s\tmerge-finish -> done\tactor=human\n' "$NOW" "$task" >> "$(log_file "$task")"
    ok "$task: hoàn tất merge (conflict đã resolve); worktree/branch task đã gỡ (task giữ nguyên)"
    ;;

  reset)
    # operator: đưa state về TODO (giữ spec), xoá evidence/reports + gỡ worktree/branch để chạy lại sạch
    [ -n "$task" ] || die "usage: gate.sh reset TASK"
    sf="$(state_file "$task")"; [ -f "$sf" ] || die "no state file for $task"
    worktree_teardown "$task"
    chmod -R u+w "$(ev_dir "$task")" 2>/dev/null || true
    rm -rf "$(ev_dir "$task")" "$ROOT/.ai/reports/$task"
    mkdir -p "$ROOT/.ai/reports/$task"
    tmp="$(mktemp)"; jq 'del(.branch, .repos)' "$sf" > "$tmp" && mv "$tmp" "$sf"
    write_state "$task" "TODO" "human" "" "reset by $(whoami)"
    ;;

  remove)
    # operator: xoá HẲN một task (spec + ac + state + evidence + reports + worktree/branch). Cần --yes.
    [ -n "$task" ] || die "usage: gate.sh remove TASK --yes"
    [ "${3:-}" = "--yes" ] || die "thao tác phá huỷ — cần xác nhận: gate.sh remove $task --yes"
    worktree_teardown "$task"
    chmod -R u+w "$(ev_dir "$task")" 2>/dev/null || true
    rm -rf "$(ev_dir "$task")" "$ROOT/.ai/reports/$task" \
           "$(state_file "$task")" "$(log_file "$task")" \
           "$ROOT/.ai/tasks/$task"
    ok "$task đã xoá hoàn toàn"
    ;;

  *) die "lệnh không hợp lệ: $cmd" ;;
esac
