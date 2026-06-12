#!/usr/bin/env bash
# wait-for-work.sh <project> <STATE> [STATE...]
# Zero-token idle watcher: polls the hub JSON API until any of the given states
# has at least one task, then exits 0. Run it in the background from an agent
# session — the harness wakes the session when it exits.
#
# Hub URL + token are resolved from .mcp.json in the cwd (the clone's own
# taskhub registration); override with AKA_HUB_URL / AKA_TOKEN env vars.
set -uo pipefail
PROJECT="${1:?usage: wait-for-work.sh <project> <STATE>...}"; shift
[ "$#" -ge 1 ] || { echo "need at least one STATE"; exit 2; }

HUB="${AKA_HUB_URL:-}"
TOKEN="${AKA_TOKEN:-}"
if [ -z "$HUB" ] && [ -f .mcp.json ]; then
  HUB="$(jq -r '.mcpServers.taskhub.url // empty' .mcp.json | sed 's|/mcp$||')"
fi
if [ -z "$TOKEN" ] && [ -f .mcp.json ]; then
  TOKEN="$(jq -r '.mcpServers.taskhub.headers.Authorization // empty' .mcp.json | sed 's/^Bearer //')"
fi
[ -n "$HUB" ] && [ -n "$TOKEN" ] || { echo "cannot resolve hub url/token (set AKA_HUB_URL / AKA_TOKEN or provide .mcp.json)"; exit 2; }

INTERVAL="${AKA_POLL_INTERVAL:-30}"
echo "watching $HUB project=$PROJECT states=$* (every ${INTERVAL}s)"
while :; do
  for st in "$@"; do
    n="$(curl -sf "$HUB/api/tasks?project=$PROJECT&state=$st" \
          -H "Authorization: Bearer $TOKEN" | jq '.tasks | length' 2>/dev/null || echo 0)"
    if [ "${n:-0}" -gt 0 ]; then
      echo "work available: $n task(s) in $st"
      exit 0
    fi
  done
  sleep "$INTERVAL"
done
