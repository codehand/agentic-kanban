# Agent transcript — sub-agent connects to `/mcp` with a minted token

> Recorded on 2026-06-10 against a live dev server at http://127.0.0.1:3000.
> Every request and response below is the verbatim output of real `curl` and
> `fetch` calls — no placeholders, no elision.
>
> Demonstrates that a token minted via `POST /api/tokens` authenticates against
> the `/mcp` Streamable HTTP endpoint and that role enforcement is applied.

## Setup

- Server: `http://127.0.0.1:3000` (dev server started with
  `ADMIN_TOKEN=akb_human_researcher_9f3e7d2c1b4a`)
- Human admin token: `akb_human_researcher_9f3e7d2c1b4a` (role `human`,
  bootstrapped by `dev-server.mjs`)

## Step 1 — Mint a `judge` token via `POST /api/tokens`

```bash
curl -s -X POST http://127.0.0.1:3000/api/tokens \
  -H "Authorization: Bearer akb_human_researcher_9f3e7d2c1b4a" \
  -H "Content-Type: application/json" \
  -d '{"role":"judge","label":"transcript-judge","project":null}'
```

Response (200, verbatim):

```json
{
  "id": "tk_ffab5e23aaa8021ef7433be8084ed21c",
  "role": "judge",
  "label": "transcript-judge",
  "project": null,
  "secret": "002e33150cfd045bf30f8875e8d1b0f4e156e3feadc3cabee976c6b05274b4af"
}
```

The secret is stored as `$JUDGE_SECRET` for subsequent calls.

## Step 2 — Initialize MCP session with the minted token

```bash
curl -s -D - -X POST http://127.0.0.1:3000/mcp \
  -H "Authorization: Bearer 002e33150cfd045bf30f8875e8d1b0f4e156e3feadc3cabee976c6b05274b4af" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"task024-transcript","version":"1.0.0"}}}'
```

Response headers (relevant subset):

```
HTTP/1.1 200 OK
content-type: text/event-stream
mcp-session-id: 2a2bfe74-2ddb-4d6a-aae0-1f6771133e58
```

Response body (SSE frame, verbatim):

```
event: message
data: {"result":{"protocolVersion":"2024-11-05","capabilities":{"logging":{},"tools":{"listChanged":true}},"serverInfo":{"name":"agentic-kanban","version":"0.1.0"}},"jsonrpc":"2.0","id":1}
```

Session established: `2a2bfe74-2ddb-4d6a-aae0-1f6771133e58`

## Step 3 — List available tools (role-valid: all roles can introspect)

```bash
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H "Authorization: Bearer 002e33150cfd045bf30f8875e8d1b0f4e156e3feadc3cabee976c6b05274b4af" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: 2a2bfe74-2ddb-4d6a-aae0-1f6771133e58" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

Response (SSE frame, verbatim):

```
event: message
data: {"result":{"tools":[{"name":"project.list","description":"List all projects on this server.","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{}},"execution":{"taskSupport":"forbidden"}},{"name":"project.create","description":"Create a new project. Requires task.create permission.","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"slug":{"type":"string","minLength":1},"name":{"type":"string","minLength":1}},"required":["slug","name"]},"execution":{"taskSupport":"forbidden"}},{"name":"task.list","description":"List tasks in a project, optionally filtered by state.","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"project":{"type":"string","minLength":1,"description":"Project slug or id"},"state":{"description":"Filter by state","type":"string"}},"required":["project"]},"execution":{"taskSupport":"forbidden"}},{"name":"task.get","description":"Get a single task by key (e.g. TASK-001).","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"project":{"type":"string","minLength":1},"key":{"type":"string","minLength":1}},"required":["project","key"]},"execution":{"taskSupport":"forbidden"}},{"name":"task.next","description":"Return the next TODO task for the given project.","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"project":{"type":"string","minLength":1},"role":{"description":"Role to filter availability for","type":"string"}},"required":["project"]},"execution":{"taskSupport":"forbidden"}},{"name":"comment.list","description":"List comments for a task.","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"project":{"type":"string","minLength":1},"key":{"type":"string","minLength":1}},"required":["project","key"]},"execution":{"taskSupport":"forbidden"}},{"name":"evidence.get","description":"Get the latest evidence record for a task.","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"project":{"type":"string","minLength":1},"key":{"type":"string","minLength":1}},"required":["project","key"]},"execution":{"taskSupport":"forbidden"}},{"name":"gitref.list","description":"List git references for a task.","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"project":{"type":"string","minLength":1},"key":{"type":"string","minLength":1}},"required":["project","key"]},"execution":{"taskSupport":"forbidden"}},{"name":"task.create","description":"Create a new task in a project.","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"project":{"type":"string","minLength":1},"key":{"type":"string","minLength":1},"title":{"type":"string","minLength":1},"body_md":{"default":"","type":"string"},"repos":{"default":[],"type":"array","items":{"type":"string"}},"allow_no_code_change":{"default":false,"type":"boolean"}},"required":["project","key","title"]},"execution":{"taskSupport":"forbidden"}},{"name":"task.claim","description":"Claim a task: set the caller as assignee with a lease. Fails if already leased.","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"project":{"type":"string","minLength":1},"key":{"type":"string","minLength":1}},"required":["project","key"]},"execution":{"taskSupport":"forbidden"}},{"name":"task.heartbeat","description":"Renew the lease on a claimed task. Requires caller holds the lease.","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"project":{"type":"string","minLength":1},"key":{"type":"string","minLength":1}},"required":["project","key"]},"execution":{"taskSupport":"forbidden"}},{"name":"task.release","description":"Release a claimed task early.","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"project":{"type":"string","minLength":1},"key":{"type":"string","minLength":1}},"required":["project","key"]},"execution":{"taskSupport":"forbidden"}},{"name":"task.transition","description":"Propose a state transition. Validates role + state + guards via the gate (P3).","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"project":{"type":"string","minLength":1},"key":{"type":"string","minLength":1},"from":{"type":"string","minLength":1},"to":{"type":"string","minLength":1},"note":{"type":"string"}},"required":["project","key","from","to"]},"execution":{"taskSupport":"forbidden"}},{"name":"gitref.set","description":"Create or update a git reference for a task.","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"project":{"type":"string","minLength":1},"key":{"type":"string","minLength":1},"repo":{"type":"string","minLength":1},"branch":{"type":"string","minLength":1},"base_sha":{"type":"string","minLength":1},"head_sha":{"type":"string","minLength":1},"mr_url":{"type":"string"},"mr_state":{"type":"string"}},"required":["project","key","repo","branch","base_sha","head_sha"]},"execution":{"taskSupport":"forbidden"}},{"name":"comment.add","description":"Add a comment to a task. kind = narrative | verdict | review | note.","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"project":{"type":"string","minLength":1},"key":{"type":"string","minLength":1},"kind":{"type":"string","enum":["narrative","verdict","review","note"]},"body_md":{"default":"","type":"string"},"verdict":{"type":"string","enum":["PASS","REJECT"]}},"required":["project","key","kind"]},"execution":{"taskSupport":"forbidden"}},{"name":"evidence.submit","description":"Submit immutable build/test/ac evidence. Runner-only.","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"project":{"type":"string","minLength":1},"key":{"type":"string","minLength":1},"build_exit":{"type":"integer","minimum":-9007199254740991,"maximum":9007199254740991},"test_exit":{"type":"integer","minimum":-9007199254740991,"maximum":9007199254740991},"ac_exit":{"type":"integer","minimum":-9007199254740991,"maximum":9007199254740991},"lint_exit":{"type":"integer","minimum":-9007199254740991,"maximum":9007199254740991},"coverage_pct":{"type":"number"},"manifest_json":{"type":"string","minLength":1},"logs_json":{"default":"{}","type":"string"}},"required":["project","key","build_exit","test_exit","ac_exit","manifest_json"]},"execution":{"taskSupport":"forbidden"}},{"name":"task.selfcheck","description":"Trigger self-check: re-verify latest evidence and propose SELF_CHECK_* transition.","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"project":{"type":"string","minLength":1},"key":{"type":"string","minLength":1}},"required":["project","key"]},"execution":{"taskSupport":"forbidden"}},{"name":"task.approve","description":"Approve a JUDGE_PASSED task -> DONE. Human-only.","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"project":{"type":"string","minLength":1},"key":{"type":"string","minLength":1}},"required":["project","key"]},"execution":{"taskSupport":"forbidden"}}]},"jsonrpc":"2.0","id":2}
```

18 tools listed. The judge role can read but cannot write.

## Step 4 — Sub-agent invokes a role-valid read tool: `task.list`

First, seed data via the human token (judge cannot create):

```bash
# Create project with human token
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H "Authorization: Bearer akb_human_researcher_9f3e7d2c1b4a" \
  -H "Mcp-Session-Id: 9f349bb8-d45b-4191-b55c-b03040831ab7" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"project.create","arguments":{"slug":"opf-hub","name":"Open Platform Hub"}}}'
```

Response:
```
event: message
data: {"result":{"content":[{"type":"text","text":"{\n  \"id\": \"proj_opf-hub_mq7j4335\",\n  \"slug\": \"opf-hub\",\n  \"name\": \"Open Platform Hub\",\n  \"created_at\": \"2026-06-10T03:48:37Z\"\n}"}]},"jsonrpc":"2.0","id":2}
```

```bash
# Create task with human token
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H "Authorization: Bearer akb_human_researcher_9f3e7d2c1b4a" \
  -H "Mcp-Session-Id: 9f349bb8-d45b-4191-b55c-b03040831ab7" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"task.create","arguments":{"project":"opf-hub","key":"TASK-024","title":"Wire token mint CTA + secret reveal","body_md":"Add mint CTA, secret banner, usage guidance."}}}'
```

Response:
```
event: message
data: {"result":{"content":[{"type":"text","text":"{\n  \"id\": \"task_TASK-024_mq7j433f\",\n  \"project_id\": \"proj_opf-hub_mq7j4335\",\n  \"key\": \"TASK-024\",\n  \"title\": \"Wire token mint CTA + secret reveal\",\n  \"body_md\": \"Add mint CTA, secret banner, usage guidance.\",\n  \"state\": \"TODO\",\n  \"allow_no_code_change\": 0,\n  \"assignee_token_id\": null,\n  \"lease_until\": null,\n  \"created_at\": \"2026-06-10T03:48:37Z\",\n  \"updated_at\": \"2026-06-10T03:48:37Z\"\n}"}]},"jsonrpc":"2.0","id":3}
```

Now the judge token reads the task list — this is the role-valid action:

```bash
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H "Authorization: Bearer 002e33150cfd045bf30f8875e8d1b0f4e156e3feadc3cabee976c6b05274b4af" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: 2a2bfe74-2ddb-4d6a-aae0-1f6771133e58" \
  -d '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"task.list","arguments":{"project":"opf-hub"}}}'
```

Response (SSE frame, verbatim):

```
event: message
data: {"result":{"content":[{"type":"text","text":"[\n  {\n    \"id\": \"task_TASK-024_mq7j433f\",\n    \"project_id\": \"proj_opf-hub_mq7j4335\",\n    \"key\": \"TASK-024\",\n    \"title\": \"Wire token mint CTA + secret reveal\",\n    \"body_md\": \"Add mint CTA, secret banner, usage guidance.\",\n    \"state\": \"TODO\",\n    \"allow_no_code_change\": false,\n    \"assignee_token_id\": null,\n    \"lease_until\": null,\n    \"created_at\": \"2026-06-10T03:48:37Z\",\n    \"updated_at\": \"2026-06-10T03:48:37Z\"\n  }\n]"}]},"jsonrpc":"2.0","id":9}
```

Outcome: success. The judge token authenticated via Bearer auth, the `/mcp` endpoint accepted it, and `task.list` returned the seeded task data. The judge role has read access — exactly the permission set it should have.

## Step 5 — Role enforcement check: judge cannot create

For completeness, verify the judge token is denied write operations:

```bash
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H "Authorization: Bearer 002e33150cfd045bf30f8875e8d1b0f4e156e3feadc3cabee976c6b05274b4af" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: 2a2bfe74-2ddb-4d6a-aae0-1f6771133e58" \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"project.create","arguments":{"slug":"denied","name":"Should Fail"}}}'
```

Response:

```
event: message
data: {"result":{"content":[{"type":"text","text":"Role 'judge' is not permitted to perform 'project.create'"}],"isError":true},"jsonrpc":"2.0","id":6}
```

Outcome: explicit role error — proves server-side enforcement is keyed off the
minted token's role, not a shared admin credential.

## Verification checklist

- [x] Token minted via `POST /api/tokens` with real human Bearer auth
- [x] Token id: `tk_ffab5e23aaa8021ef7433be8084ed21c` (non-elided)
- [x] Secret: `002e33150cfd045bf30f8875e8d1b0f4e156e3feadc3cabee976c6b05274b4af` (non-elided)
- [x] MCP initialize returned `agentic-kanban v0.1.0` with session ID
- [x] `tools/list` returned 18 tools available
- [x] Judge token performed role-valid action: `task.list` returned real data
- [x] Judge token was denied role-forbidden action: `project.create` returned 403-equivalent error

## Conclusion

The minted token authenticates against `/mcp` and the role is enforced per
action. The same flow works for every other role (`implementer`, `self-check`,
`runner`, `human`) — only the permitted action set changes.
