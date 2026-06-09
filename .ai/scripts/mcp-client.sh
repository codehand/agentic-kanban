#!/usr/bin/env bash
# mcp-client.sh — Reusable thin-client helper for talking to the Task Hub MCP server.
#
# Used by gate.sh / run-evidence.sh / new-task.sh to call MCP tools over
# Streamable HTTP (POST /mcp) with bearer auth.
#
# Environment variables:
#   TASK_HUB_URL   — base URL of the Task Hub server (e.g. http://localhost:4444).
#                    Also accepts SERVER_URL, MCP_URL, BASE_URL (fallback order).
#   TASK_HUB_TOKEN — bearer token for authorization (also accepts TASK_HUB_BEARER).
#
# Usage:
#   source "$(dirname "${BASH_SOURCE[0]}")/mcp-client.sh"
#   mcp_call "task.transition" '{"task_id":"TASK-1","from":"TODO","to":"IN_PROGRESS"}'
#
# Outputs the tool result text to stdout. Returns non-zero on HTTP/RPC error.
set -uo pipefail

# ---------------------------------------------------------------------------
# Resolve server base URL (TASK_HUB_URL > SERVER_URL > MCP_URL > BASE_URL)
# ---------------------------------------------------------------------------
_mcp_resolve_url() {
  local u="${TASK_HUB_URL:-${SERVER_URL:-${MCP_URL:-${BASE_URL:-}}}}"
  if [ -z "$u" ]; then
    echo "mcp-client: TASK_HUB_URL (or SERVER_URL/MCP_URL/BASE_URL) is not set" >&2
    return 1
  fi
  # Strip trailing slash; caller appends /mcp.
  printf '%s' "${u%/}"
}

# ---------------------------------------------------------------------------
# Resolve bearer token (TASK_HUB_TOKEN > TASK_HUB_BEARER)
# ---------------------------------------------------------------------------
_mcp_resolve_token() {
  local t="${TASK_HUB_TOKEN:-${TASK_HUB_BEARER:-}}"
  if [ -z "$t" ]; then
    echo "mcp-client: TASK_HUB_TOKEN is not set (bearer token required)" >&2
    return 1
  fi
  printf '%s' "$t"
}

# ---------------------------------------------------------------------------
# mcp_call TOOL_NAME JSON_ARGS
#   Calls an MCP tool via Streamable HTTP POST /mcp (JSON-RPC 2.0).
#   On success: prints the tool result text to stdout.
#   On failure: prints error to stderr, returns non-zero.
# ---------------------------------------------------------------------------
mcp_call() {
  local tool="$1" args="${2:-{}}"
  local base token url payload resp http_code body

  base="$(_mcp_resolve_url)"   || return 1
  token="$(_mcp_resolve_token)" || return 1
  url="$base/mcp"

  # JSON-RPC 2.0 request body for tools/call.
  payload="$(jq -nc \
    --arg tool "$tool" \
    --argjson args "$args" \
    '{jsonrpc:"2.0", id:1, method:"tools/call", params:{name:$tool, arguments:$args}}')"

  # Single-shot POST — MCP Streamable HTTP accepts a JSON-RPC request and
  # returns a JSON-RPC response (application/json) for non-streaming calls.
  resp="$(curl -sS -w $'\n%{http_code}' -X POST "$url" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -H "Accept: application/json, text/event-stream" \
    -d "$payload" 2>&1)" || { echo "mcp-client: curl failed for $tool" >&2; return 1; }

  http_code="$(printf '%s' "$resp" | tail -1)"
  body="$(printf '%s' "$resp" | sed '$d')"

  if [ "$http_code" -lt 200 ] || [ "$http_code" -ge 300 ]; then
    echo "mcp-client: HTTP $http_code from $url for tool '$tool': $body" >&2
    return 1
  fi

  # Extract tool result text (handles both direct JSON-RPC and SSE-wrapped responses).
  local text
  text="$(printf '%s' "$body" | jq -r '
    if .result.content then
      [.result.content[] | select(.type=="text") | .text] | join("\n")
    elif .error then
      "error: \(.error.message // "unknown")"
    else empty end' 2>/dev/null)"

  if printf '%s' "$text" | grep -q '^error:'; then
    echo "mcp-client: tool '$tool' returned error: $text" >&2
    return 1
  fi

  printf '%s\n' "$text"
}

# ---------------------------------------------------------------------------
# mcp_ping — lightweight health check (hits GET /healthz on the server).
# ---------------------------------------------------------------------------
mcp_ping() {
  local base
  base="$(_mcp_resolve_url)" || return 1
  curl -sS -o /dev/null -w "%{http_code}" "$base/healthz" 2>/dev/null | grep -qF "200"
}
