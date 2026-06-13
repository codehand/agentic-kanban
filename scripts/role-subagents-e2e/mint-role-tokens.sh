#!/usr/bin/env bash
# mint-role-tokens.sh — mint one bearer token per role against a running
# container so each role-subagent gets EXACTLY ONE token (no shared bearer).
#
# Inputs (env or positional):
#   BASE_URL      base url of the running server, e.g. http://127.0.0.1:3961  ($1)
#   ADMIN_TOKEN   the human bootstrap bearer (POST /api/tokens is human-only)   ($2)
#
# The human entry is the ADMIN_TOKEN itself; its token_id is read back from
# GET /api/tokens (matching role=human). The other four roles are minted via
# POST /api/tokens. Output is machine-parseable TSV, one line per role:
#
#   ROLE<TAB>TOKEN_ID<TAB>SECRET
#
# (the order is: human, implementer, runner, self-check, judge). Nothing else
# is written to stdout, so callers can `read role id secret` line by line.
set -uo pipefail

BASE_URL="${BASE_URL:-${1:-}}"
ADMIN_TOKEN="${ADMIN_TOKEN:-${2:-}}"

if [ -z "$BASE_URL" ] || [ -z "$ADMIN_TOKEN" ]; then
  echo "usage: BASE_URL=<url> ADMIN_TOKEN=<secret> $0   (or: $0 <BASE_URL> <ADMIN_TOKEN>)" >&2
  exit 2
fi
command -v curl >/dev/null 2>&1 || { echo "mint-role-tokens: curl not on PATH" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "mint-role-tokens: node not on PATH" >&2; exit 1; }

# Extract a top-level string field from a JSON object on stdin.
json_field() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);process.stdout.write(String(o[process.argv[1]]??""))}catch{}})' "$1"
}

# mint ROLE LABEL — POST /api/tokens as human; echo "TOKEN_ID\tSECRET".
mint() {
  local role="$1" label="$2" resp id secret
  resp="$(curl -fsS -X POST \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
    -d "{\"role\":\"$role\",\"label\":\"$label\"}" "$BASE_URL/api/tokens")" || {
      echo "mint-role-tokens: POST /api/tokens failed for role=$role" >&2; exit 1; }
  id="$(printf '%s' "$resp" | json_field id)"
  secret="$(printf '%s' "$resp" | json_field secret)"
  if [ -z "$id" ] || [ -z "$secret" ]; then
    echo "mint-role-tokens: empty id/secret minting role=$role (resp=$resp)" >&2; exit 1
  fi
  printf '%s\t%s' "$id" "$secret"
}

# human token_id: read back from GET /api/tokens (first row whose role=human).
HUMAN_ID="$(curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE_URL/api/tokens" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const t=(JSON.parse(s).tokens||[]).find(x=>x.role==="human");process.stdout.write(t?t.id:"")}catch{}})')"
if [ -z "$HUMAN_ID" ]; then
  echo "mint-role-tokens: could not resolve human token_id from GET /api/tokens" >&2; exit 1
fi

printf 'human\t%s\t%s\n' "$HUMAN_ID" "$ADMIN_TOKEN"
printf 'implementer\t%s\n' "$(mint implementer rs-implementer)"
printf 'runner\t%s\n'      "$(mint runner rs-runner)"
printf 'self-check\t%s\n'  "$(mint self-check rs-selfcheck)"
printf 'judge\t%s\n'       "$(mint judge rs-judge)"
