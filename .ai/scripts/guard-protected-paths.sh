#!/usr/bin/env bash
# PreToolUse hook: chặn agent GHI vào .ai/evidence/ và .ai/state/.
# Chỉ run-evidence.sh / gate.sh (chạy qua Bash) mới được ghi 2 thư mục này.
# .ai/reports/ KHÔNG bị chặn — agent ghi narrative ở đó.
# Exit code 2 = block (Claude Code đọc stderr làm lý do).
input="$(cat)"
tool="$(printf '%s' "$input" | jq -r '.tool_name // empty')"

case "$tool" in
  Edit|Write|MultiEdit|NotebookEdit)
    path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')"
    case "$path" in
      *.ai/evidence/*|*.ai/state/*)
        echo "BLOCKED: '$path' là vùng do gate quản lý. Agent không được ghi trực tiếp." >&2
        echo "Dùng scripts/run-evidence.sh để sinh evidence, scripts/gate.sh để chuyển state." >&2
        echo "Narrative của agent ghi vào .ai/reports/<TASK>/ thay vì .ai/evidence/." >&2
        exit 2 ;;
    esac ;;
  Bash)
    cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty')"
    # cho phép 2 script tất định
    case "$cmd" in
      *scripts/run-evidence.sh*|*scripts/gate.sh*) exit 0 ;;
    esac
    # chặn thao tác ghi (redirect/tee/rm/chmod/mv/cp/sed -i/truncate) nhắm vào vùng bảo vệ
    if printf '%s' "$cmd" | grep -Eq '\.ai/(evidence|state)/' \
       && printf '%s' "$cmd" | grep -Eq '(>>?|[[:space:]]tee[[:space:]]|[[:space:]]rm[[:space:]]|chmod|[[:space:]]mv[[:space:]]|[[:space:]]cp[[:space:]]|sed[[:space:]]+-i|truncate|dd[[:space:]])'; then
      echo "BLOCKED: ghi vào .ai/evidence|.ai/state chỉ dành cho scripts/run-evidence.sh và scripts/gate.sh." >&2
      exit 2
    fi ;;
esac
exit 0
