#!/usr/bin/env bash
# example-mint-and-connect.sh — mint a judge token, then print the
# `claude mcp add` command that registers it.
#
# Usage:
#   ADMIN_TOKEN=<human-secret> BASE_URL=http://127.0.0.1:3000 ./example-mint-and-connect.sh
set -euo pipefail

: "${ADMIN_TOKEN:?set ADMIN_TOKEN to a human bearer}"
: "${BASE_URL:=http://127.0.0.1:3000}"
LABEL="${1:-example-judge}"

echo "→ minting token (role=judge, label=$LABEL) against $BASE_URL"
RESP=$(curl -sS -X POST "$BASE_URL/api/tokens" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"role\":\"judge\",\"label\":\"$LABEL\"}")

SECRET=$(printf '%s' "$RESP" | python3 -c 'import sys, json; print(json.load(sys.stdin)["secret"])')
ID=$(printf '%s' "$RESP" | python3 -c 'import sys, json; print(json.load(sys.stdin)["id"])')

echo "  minted id=$ID"
echo "  secret (SAVE NOW): $SECRET"
echo
echo "→ register with Claude Code:"
echo "  claude mcp add --transport http taskhub-$LABEL $BASE_URL/mcp \\"
echo "    --header \"Authorization: Bearer $SECRET\""
