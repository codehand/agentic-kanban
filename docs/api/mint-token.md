# `POST /api/tokens` — Mint a bearer token

Human-only HTTP endpoint that mints a new role-scoped bearer token and returns
the raw secret exactly once. The secret is never persisted in plaintext — only a
SHA-256 + salt `secret_hash` is stored in the `token` table.

## Request

```
POST /api/tokens
Authorization: Bearer <human-token>
Content-Type: application/json
```

Body:

| Field     | Type     | Required | Description                                                |
|-----------|----------|----------|------------------------------------------------------------|
| `role`    | `string` | yes      | One of `human`, `implementer`, `self-check`, `judge`, `runner`. |
| `label`   | `string` | no       | Free-form human label (e.g. `sonnet-impl-02`).             |
| `project` | `string` | no       | Optional project scope (`slug`). `null` = no scope.        |

## Response

`200 OK` on success:

```json
{
  "id":      "tk_a1b2c3d4...",
  "role":    "judge",
  "label":   "opus-judge",
  "project": null,
  "secret":  "akb_live_judge_<64-hex-chars>"
}
```

The `secret` field is **shown once**. Store it securely; it cannot be recovered.
The server stores only `SHA-256(salt + secret)` and uses constant-time compare
(`timingSafeEqual`) at verify time.

## Errors

| Status | Reason                                         |
|--------|------------------------------------------------|
| `401`  | Missing or invalid `Authorization` header.     |
| `403`  | Caller role is not `human`.                    |
| `400`  | `role` is missing or not one of the allowed values. |

## Security notes

- **Secret is never logged.** Server log lines that reference mint events carry
  only the token id + role, never the secret.
- **Secret is never returned by `GET /api/tokens`.** The list endpoint only
  exposes `id, role, project_id, label, created_at, revoked_at`.
- **Human-only.** Non-human callers always receive `403`, even if they hold a
  valid token.
- **Shown-once.** If lost, the token must be revoked and re-minted.

## Related

- `GET /api/tokens` — list active tokens (no secrets).
- `docs/CONNECT_MCP.md` — how to use a minted token with an MCP client.
- `scripts/test-mint-token.mjs` — smoke script for the endpoint.
