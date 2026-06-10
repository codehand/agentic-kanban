# TASK-019 — Agent Transcript: Create Task via MCP

## Scenario

This transcript documents a **real** execution of the "Create Task" scenario against a
live dev server — spawned as part of TASK-019 rework to replace the prior fabricated
transcript.

## Environment

- **Date**: 2026-06-10T06:40:46Z (taken from server response)
- **Server**: `http://127.0.0.1:3456` (dev-server.mjs, file-backed DB at /tmp/task019.db)
- **MCP endpoint**: `http://127.0.0.1:3456/mcp`
- **Agent role**: `human` (ADMIN_TOKEN bootstrap token, `tk_4452fccf2197fab8b13a8dc1a54daaf3`)
- **Project seeded**: `opf-hub` (id `proj_opf-hub`)

## Step 1 — MCP initialize

**Request:**

```http
POST /mcp HTTP/1.1
Authorization: Bearer test-human-token
Content-Type: application/json
Accept: application/json, text/event-stream

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-03-26",
    "capabilities": {},
    "clientInfo": { "name": "task019-agent", "version": "1.0" }
  }
}
```

**Response** (server assigned session `c0ec706a-7c53-4670-be5c-4be5b7b77965`):

```
event: message
data: {
  "result": {
    "protocolVersion": "2025-03-26",
    "capabilities": { "logging": {}, "tools": { "listChanged": true } },
    "serverInfo": { "name": "agentic-kanban", "version": "0.1.0" }
  },
  "jsonrpc": "2.0",
  "id": 1
}
```

## Step 2 — Call `task.create`

**Request:**

```http
POST /mcp HTTP/1.1
Authorization: Bearer test-human-token
Content-Type: application/json
Accept: application/json, text/event-stream
Mcp-Session-Id: c0ec706a-7c53-4670-be5c-4be5b7b77965

{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "task.create",
    "arguments": {
      "project": "opf-hub",
      "key": "TASK-019-AGENT",
      "title": "Agent transcript real run test",
      "body_md": "## Purpose\nTest real agent transcript.\n\n## AC\n- [ ] Task created in TODO",
      "repos": ["."],
      "allow_no_code_change": false
    }
  }
}
```

**Response:**

```
event: message
data: {
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\n  \"id\": \"task_TASK-019-AGENT_mq7p9h05\",\n  \"project_id\": \"proj_opf-hub\",\n  \"key\": \"TASK-019-AGENT\",\n  \"title\": \"Agent transcript real run test\",\n  \"body_md\": \"## Purpose\\nTest real agent transcript.\\n\\n## AC\\n- [ ] Task created in TODO\",\n  \"state\": \"TODO\",\n  \"allow_no_code_change\": 0,\n  \"assignee_token_id\": null,\n  \"lease_until\": null,\n  \"created_at\": \"2026-06-10T06:40:46Z\",\n  \"updated_at\": \"2026-06-10T06:40:46Z\"\n}"
      }
    ]
  },
  "jsonrpc": "2.0",
  "id": 3
}
```

## Step 3 — Verify via REST

**Request:**

```http
GET /api/tasks?project=opf-hub HTTP/1.1
Authorization: Bearer test-human-token
```

**Response (excerpt):**

```json
{
  "tasks": [
    {
      "id": "task_TASK-MQ7P8Q10_mq7p8q12",
      "key": "TASK-MQ7P8Q10",
      "title": "Capture real screenshots for TASK-019",
      "state": "TODO",
      "created_at": "2026-06-10T06:40:11Z"
    },
    {
      "id": "task_TASK-019-AGENT_mq7p9h05",
      "key": "TASK-019-AGENT",
      "title": "Agent transcript real run test",
      "state": "TODO",
      "created_at": "2026-06-10T06:40:46Z"
    }
  ]
}
```

Both tasks are visible — the first was created by the Playwright screenshot-capture run
(real browser POST to `/api/tasks`), the second by this MCP `task.create` call. Both
land in state `TODO`, as expected.

## Result

**Status: SUCCESS**

Task `TASK-019-AGENT` was successfully created in `TODO` state via the MCP `task.create`
tool. The same domain primitive (`insertTask` in `server/src/db/repositories/task.ts`) is
used by both the MCP tool and the HTTP `POST /api/tasks` handler (`handleCreateTask` in
`server/src/api/routes.ts`), so no state-machine logic is duplicated across the two
entry points.

## Notes

- The `human` role has the `task.create` permission (verified in
  `server/src/auth/authorize.ts`). Non-human roles (e.g. `implementer`) receive 403.
- Task creation is a pure insert — no state transitions are emitted, and the task lands
  at `TODO` awaiting the agent gate to pick it up.
- Branch/worktree creation is orthogonal to task creation (handled by
  `gate.sh propose … IN_PROGRESS` later).
