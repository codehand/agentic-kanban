# Mint-token scenarios — API + agent

This document records two test scenarios that prove `POST /api/tokens` works
end-to-end and that a freshly-minted token is usable by an MCP agent.

## Scenario A — API-level test (`scripts/test-mint-token.mjs`)

Pre: server running, `ADMIN_TOKEN` set to a human token.

1. `POST /api/tokens` with `Authorization: Bearer $ADMIN_TOKEN` and
   `{ role: "judge", label: "scenario-a" }`.
2. Expect `200` with `{ id, role, label, secret }` where `secret` is a
   non-empty string starting with the role prefix.
3. `GET /api/tokens` with the same bearer — expect the list to contain the new
   token id but **not** the secret substring.
4. `POST /api/tokens` **without** `Authorization` — expect `401`.
5. `POST /api/tokens` with an `implementer` bearer — expect `403`.
6. `POST /api/tokens` with `{ role: "not-a-role" }` — expect `400`.

Run: `node scripts/test-mint-token.mjs http://127.0.0.1:3000 $ADMIN_TOKEN`

## Scenario B — Agent connects to `/mcp` with the minted token

Pre: server running, human token in `$ADMIN_TOKEN`.

1. Human (via UI or script) calls `POST /api/tokens` → gets `SECRET_JUDGE`.
2. Agent registers the endpoint:
   ```
   claude mcp add --transport http taskhub-judge http://127.0.0.1:3000/mcp \
     --header "Authorization: Bearer $SECRET_JUDGE"
   ```
3. Agent calls a read-only tool (`project.list`) — expect success (role `judge`
   has `read`).
4. Agent calls `evidence.submit` — expect a role error (only `runner` may
   submit evidence). This proves server-side role enforcement uses the minted
   token, not a shared admin credential.

## Pass criteria

- All HTTP status codes match the table in `docs/api/mint-token.md`.
- The secret returned in step 1 of Scenario A does **not** appear in the body
  of step 2 (the list response).
- In Scenario B, step 4 returns an explicit role error rather than a generic
  5xx.
