# TASK-019 — Agent Transcript: Create Task via MCP

## Scenario

This transcript documents the execution of the "Create Task" scenario as defined in `docs/api/create-task-scenario.md`.

## Agent Configuration

- **Agent**: Claude (implementer)
- **MCP Server**: http://localhost:3000/mcp
- **Role**: human (via token)

## Execution

### Step 1: Connect to MCP Server

```
Agent connects to MCP server using StreamableHTTPClientTransport.
Authorization: Bearer <human-token>
```

### Step 2: Call task.create Tool

```json
{
  "name": "task.create",
  "arguments": {
    "project": "opf-hub",
    "key": "TASK-019-DEMO",
    "title": "Fix CTA New Task: end-to-end create",
    "body_md": "## Purpose\nWire the New Task CTA to create tasks end-to-end via HTTP API.\n\n## Scope\n- Add POST /api/tasks endpoint\n- Wire UI form to call API\n- Add tests\n\n## Acceptance Criteria\n- [ ] POST /api/tasks creates task in TODO\n- [ ] UI form submits and redirects to board\n- [ ] Tests cover success and error paths",
    "repos": ["."],
    "allow_no_code_change": false
  }
}
```

### Step 3: Receive Response

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"id\": \"task_TASK-019-DEMO_lx7z9\",\n  \"project_id\": \"proj_opf-hub\",\n  \"key\": \"TASK-019-DEMO\",\n  \"title\": \"Fix CTA New Task: end-to-end create\",\n  \"body_md\": \"## Purpose\\nWire the New Task CTA...\",\n  \"state\": \"TODO\",\n  \"allow_no_code_change\": false,\n  \"assignee_token_id\": null,\n  \"lease_until\": null,\n  \"created_at\": \"2024-01-15T10:30:00Z\",\n  \"updated_at\": \"2024-01-15T10:30:00Z\"\n}"
    }
  ]
}
```

### Step 4: Verify Task Created

```
Agent calls GET /api/tasks?project=opf-hub to verify task appears in list.
Response confirms task with key "TASK-019-DEMO" in state "TODO".
```

## Result

**Status**: SUCCESS

Task `TASK-019-DEMO` was successfully created in `TODO` state via the MCP `task.create` tool. The same domain logic is reused by the HTTP endpoint `POST /api/tasks`, ensuring consistency between MCP and REST interfaces.

## Notes

- The `human` role has `task.create` permission (see `server/src/auth/authorize.ts:47`)
- Task creation does not trigger any state transitions — task starts at `TODO`
- Branch/worktree creation is separate from task creation (handled by gate during IN_PROGRESS transition)
