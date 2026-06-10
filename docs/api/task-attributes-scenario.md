# Task Attributes — Test Scenarios

## API Test Scenarios

### Scenario 1: Create task with all attributes

1. POST `/api/tasks` with priority=P1, complexity=M, estimate_hours=8, tags=["backend"], link_document="https://docs.example.com"
2. Expect 201 with all fields persisted.
3. GET `/api/tasks/:key` — verify fields match.

### Scenario 2: Update attributes via PATCH

1. PATCH `/api/tasks/:key` with { priority: "P0", tags: ["urgent"] }
2. Expect 200 with updated priority and tags.
3. Verify unchanged fields (complexity, estimate_hours, link_document) remain.

### Scenario 3: Reject invalid priority

1. POST `/api/tasks` with priority="P9"
2. Expect 400 error.

### Scenario 4: Reject invalid complexity

1. POST `/api/tasks` with complexity="XXL"
2. Expect 400 error.

### Scenario 5: Reject negative estimate

1. POST `/api/tasks` with estimate_hours=-5
2. Expect 400 error.

### Scenario 6: Reject invalid link_document

1. POST `/api/tasks` with link_document="not-a-url"
2. Expect 400 error.

### Scenario 7: Reject invalid tags

1. POST `/api/tasks` with tags="not-an-array"
2. Expect 400 error.

## Agent Test Scenarios

### Agent Scenario 1: MCP task.create with attributes

1. Connect to MCP server.
2. Call `task.create` with project, key, title, priority="P2", complexity="S", tags=["docs"].
3. Verify returned task has the attributes set.

### Agent Scenario 2: MCP task.update

1. Call `task.update` with project, key, estimate_hours=2.
2. Verify returned task has updated estimate_hours.
3. Verify other attributes unchanged.

### Agent Scenario 3: PR link from gitref

1. Set gitref with mr_url for a task.
2. GET task detail — verify mr_url appears in gitrefs (no separate PR column).
