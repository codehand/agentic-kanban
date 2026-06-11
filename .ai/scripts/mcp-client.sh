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
# _mcp_extract_json BODY
#   Streamable HTTP returns the JSON-RPC response either as plain JSON or
#   wrapped in an SSE frame ("event: message\ndata: {...}"). Emit the JSON
#   object (the `data:` payload when SSE) to stdout.
# ---------------------------------------------------------------------------
_mcp_extract_json() {
  local body="$1"
  if printf '%s' "$body" | grep -q '^data:'; then
    printf '%s\n' "$body" | sed -n 's/^data: //p' | tail -1
  else
    printf '%s' "$body"
  fi
}

# ---------------------------------------------------------------------------
# mcp_call TOOL_NAME JSON_ARGS
#   Calls an MCP tool via Streamable HTTP POST /mcp (JSON-RPC 2.0).
#   Performs the required MCP handshake per request: initialize (to obtain an
#   Mcp-Session-Id), notifications/initialized, then tools/call on that session.
#   On success: prints the tool result text to stdout.
#   On failure: prints error to stderr, returns non-zero.
# ---------------------------------------------------------------------------
mcp_call() {
  local tool="$1" args="${2:-}"
  [ -n "$args" ] || args='{}'
  local base token url hdrs init_resp sid payload resp http_code body json text

  base="$(_mcp_resolve_url)"   || return 1
  token="$(_mcp_resolve_token)" || return 1
  url="$base/mcp"
  hdrs="$(mktemp)"

  # 1. initialize -> capture Mcp-Session-Id response header.
  init_resp="$(curl -sS -D "$hdrs" -X POST "$url" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"aka-thin-client","version":"0.1.0"}}}' 2>&1)" \
    || { echo "mcp-client: curl failed (initialize) for $tool" >&2; rm -f "$hdrs"; return 1; }

  sid="$(grep -i '^mcp-session-id:' "$hdrs" | tail -1 | tr -d '\r' | sed -E 's/^[Mm]cp-[Ss]ession-[Ii]d:[[:space:]]*//')"
  rm -f "$hdrs"
  if [ -z "$sid" ]; then
    echo "mcp-client: no Mcp-Session-Id returned on initialize for '$tool': $(_mcp_extract_json "$init_resp")" >&2
    return 1
  fi

  # 2. notifications/initialized (required to complete the handshake).
  curl -sS -o /dev/null -X POST "$url" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -H "Accept: application/json, text/event-stream" \
    -H "Mcp-Session-Id: $sid" \
    -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' 2>/dev/null || true

  # 3. tools/call on the session.
  payload="$(jq -nc --arg tool "$tool" --argjson args "$args" \
    '{jsonrpc:"2.0", id:1, method:"tools/call", params:{name:$tool, arguments:$args}}')"
  resp="$(curl -sS -w $'\n%{http_code}' -X POST "$url" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -H "Accept: application/json, text/event-stream" \
    -H "Mcp-Session-Id: $sid" \
    -d "$payload" 2>&1)" || { echo "mcp-client: curl failed for $tool" >&2; return 1; }

  http_code="$(printf '%s' "$resp" | tail -1)"
  body="$(printf '%s' "$resp" | sed '$d')"

  # Best-effort: close the session so we don't leak transports server-side.
  curl -sS -o /dev/null -X DELETE "$url" \
    -H "Authorization: Bearer $token" -H "Mcp-Session-Id: $sid" 2>/dev/null || true

  if [ "$http_code" -lt 200 ] || [ "$http_code" -ge 300 ]; then
    echo "mcp-client: HTTP $http_code from $url for tool '$tool': $body" >&2
    return 1
  fi

  json="$(_mcp_extract_json "$body")"
  text="$(printf '%s' "$json" | jq -r '
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
