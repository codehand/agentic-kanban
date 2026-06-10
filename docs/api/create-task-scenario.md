# Create Task — Test Scenarios

## API Test Scenarios

### Scenario 1: Successful Task Creation

**Preconditions**:
- Server running on `localhost:3000`
- Valid human token available

**Steps**:
1. POST `/api/tasks` with valid payload:
   ```json
   {
     "project": "opf-hub",
     "key": "TASK-TEST-001",
     "title": "Test task creation",
     "body_md": "Test body"
   }
   ```
2. Verify response status is `201`
3. Verify response contains `task` object with `state: "TODO"`
4. GET `/api/tasks?project=opf-hub` and verify task appears in list

**Expected**: Task created in TODO state, visible via GET.

### Scenario 2: Missing Authentication

**Steps**:
1. POST `/api/tasks` without `Authorization` header

**Expected**: `401 Unauthorized`

### Scenario 3: Insufficient Permissions

**Preconditions**: Valid token with `implementer` role

**Steps**:
1. POST `/api/tasks` with implementer token

**Expected**: `403 Forbidden`

### Scenario 4: Missing Required Fields

**Steps**:
1. POST `/api/tasks` with body `{ "project": "opf-hub" }` (missing key, title)

**Expected**: `400 Bad Request`

### Scenario 5: Duplicate Task Key

**Preconditions**: Task with key `TASK-001` already exists

**Steps**:
1. POST `/api/tasks` with `key: "TASK-001"`

**Expected**: `409 Conflict`

## Agent Test Scenario

### Scenario: MCP Client Creates Task via task.create

**Preconditions**:
- MCP server running
- MCP client configured with human token

**Steps**:
1. Connect MCP client to server
2. Call `task.create` tool:
   ```json
   {
     "project": "opf-hub",
     "key": "TASK-AGENT-001",
     "title": "Agent-created task",
     "body_md": "Created via MCP",
     "repos": ["."],
     "allow_no_code_change": false
   }
   ```
3. Verify task returned with `state: "TODO"`

**Expected**: Task created via MCP, same as HTTP endpoint.

## Running the Tests

### API Test Script

```bash
# Set your token
export KANBAN_TOKEN="your-human-token-secret"

# Run the test script
node scripts/test-create-task.mjs
```

### Playwright UI Test

```bash
# Run UI tests
pnpm exec playwright test tests/ui/new-task.spec.ts
```
