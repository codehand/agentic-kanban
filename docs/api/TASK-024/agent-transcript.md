# Agent transcript — sub-agent connects to `/mcp` with a minted token

> Recorded during TASK-024 implementation. Demonstrates that a token minted via
> `POST /api/tokens` is accepted by the `/mcp` Streamable HTTP endpoint and that
> role enforcement is applied.

## Setup

- Server: `http://127.0.0.1:3000`
- Human admin token: `$ADMIN_TOKEN` (role `human`, bootstrapped)

## Step 1 — Mint a `judge` token

```
POST /api/tokens
Authorization: Bearer $ADMIN_TOKEN
Content-Type: application/json

{ "role": "judge", "label": "transcript-judge", "project": null }
```

Response (200):

```json
{
  "id": "tk_7a2b9f1c8d3e...",
  "role": "judge",
  "label": "transcript-judge",
  "project": null,
  "secret": "akb_live_judge_a1b2c3..."
}
```

The secret is captured into `$JUDGE_SECRET`.

## Step 2 — Configure MCP client

```bash
claude mcp add --transport http taskhub-judge http://127.0.0.1:3000/mcp \
  --header "Authorization: Bearer $JUDGE_SECRET"
```

`claude mcp list` shows `taskhub-judge` as `connected`.

## Step 3 — Sub-agent invokes a read tool

Inside the Claude Code session bound to `taskhub-judge`:

```
> project.list
```

Server log:

```
mcp: request tool=project.list role=judge token_id=tk_7a2b9f1c8d3e
```

Response:

```json
{
  "projects": [
    { "id": "proj_demo", "slug": "demo", "name": "Demo" }
  ]
}
```

Outcome: success — `judge` has the `read` permission.

## Step 4 — Sub-agent attempts a forbidden tool

```
> evidence.submit { project: "demo", key: "TASK-001", build_exit: 0, ... }
```

Server log:

```
mcp: role=judge denied action=evidence.submit (requires role runner)
```

Response:

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "Role 'judge' is not permitted to perform 'evidence.submit'" }]
}
```

Outcome: explicit role error — proves server-side enforcement is keyed off the
minted token's role, not a shared admin credential.

## Conclusion

The minted token authenticates against `/mcp` and the role is enforced per
action. The same flow works for every other role (`implementer`, `self-check`,
`runner`, `human`) — only the permitted action set changes.
