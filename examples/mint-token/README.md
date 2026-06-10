# Mint token — end-to-end example

This example walks through minting a fresh `judge` token via the HTTP API and
then configuring a Claude Code session to use it against the `/mcp` endpoint.

## 1. Prerequisites

- Agentic Kanban server running on `http://127.0.0.1:3000`.
- A human bearer token (`ADMIN_TOKEN`).

## 2. Mint a token

```bash
curl -sS -X POST http://127.0.0.1:3000/api/tokens \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role":"judge","label":"example-judge","project":null}'
```

Example response (secret truncated):

```json
{
  "id": "tk_9f8e7d6c5b4a3...",
  "role": "judge",
  "label": "example-judge",
  "project": null,
  "secret": "akb_live_judge_..."
}
```

> **Save the secret immediately.** It is returned exactly once.

## 3. Register with Claude Code

```bash
SECRET="akb_live_judge_..."   # paste the full secret from step 2
claude mcp add --transport http taskhub-judge http://127.0.0.1:3000/mcp \
  --header "Authorization: Bearer $SECRET"
```

Or, for a project-scoped config, add to `.mcp.json`:

```json
{
  "mcpServers": {
    "taskhub-judge": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:3000/mcp",
      "headers": { "Authorization": "Bearer akb_live_judge_..." }
    }
  }
}
```

## 4. Verify

In Claude Code, type `/mcp` — you should see `taskhub-judge` listed with a
`connected` status and the tools available to the `judge` role.

Try:

```
project.list
```

`judge` has `read`, so this succeeds. Try `evidence.submit` — it should fail
with a role error (only `runner` may submit evidence).

## 5. Revoke

If the secret leaks, revoke via the Web UI (Tokens → revoke) or, when the
endpoint is added, via `DELETE /api/tokens/:id`. Then mint a new one.

## Further reading

- `docs/api/mint-token.md` — endpoint reference.
- `docs/CONNECT_MCP.md` — full MCP connection guide.
- `docs/api/mint-token-scenario.md` — test scenarios.
