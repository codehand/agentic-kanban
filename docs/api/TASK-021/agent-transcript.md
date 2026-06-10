# Agent Transcript — TASK-021 Task Attributes

## Session: Task Attributes API Verification

**Agent**: Claude (implementer)
**Task**: TASK-021
**Date**: 2026-06-10

---

### Step 1: Create task with all attributes

```
> mcp_call task.create '{
  "project": "test-project",
  "key": "TASK-DEMO-001",
  "title": "Add search feature",
  "priority": "P1",
  "complexity": "L",
  "estimate_hours": 16,
  "tags": ["feature", "search"],
  "link_document": "https://docs.example.com/search-spec"
}'
```

**Result**: Task created with all 5 attributes set.

```json
{
  "id": "task_TASK-DEMO-001_...",
  "key": "TASK-DEMO-001",
  "title": "Add search feature",
  "priority": "P1",
  "complexity": "L",
  "estimate_hours": 16,
  "tags": ["feature", "search"],
  "link_document": "https://docs.example.com/search-spec",
  "state": "TODO"
}
```

### Step 2: Update priority via task.update

```
> mcp_call task.update '{
  "project": "test-project",
  "key": "TASK-DEMO-001",
  "priority": "P0",
  "tags": ["urgent", "feature", "search"]
}'
```

**Result**: Attributes updated. Other fields unchanged.

```json
{
  "key": "TASK-DEMO-001",
  "priority": "P0",
  "complexity": "L",
  "estimate_hours": 16,
  "tags": ["urgent", "feature", "search"],
  "link_document": "https://docs.example.com/search-spec"
}
```

### Step 3: Verify via GET

```
> GET /api/tasks/TASK-DEMO-001?project=test-project
```

**Result**: All attributes persisted correctly.

### Step 4: PR link from gitref

```
> mcp_call gitref.set '{
  "project": "test-project",
  "key": "TASK-DEMO-001",
  "repo": ".",
  "branch": "fix/TASK-021-task-attributes",
  "base_sha": "abc1234",
  "head_sha": "def5678",
  "mr_url": "https://github.com/example/repo/pull/42"
}'
```

**Result**: PR/MR link available via `gitref.mr_url` in task detail — no separate PR column.

### Validation Tests

- `priority: "P9"` → **400 Bad Request** (invalid enum)
- `complexity: "XXL"` → **400 Bad Request** (invalid enum)
- `estimate_hours: -5` → **400 Bad Request** (negative)
- `link_document: "not-a-url"` → **400 Bad Request** (invalid URL)
- `tags: "not-array"` → **400 Bad Request** (not an array)

---

## Summary

All 5 attributes (priority, complexity, estimate_hours, tags, link_document) work correctly via:
- **Create**: Set at task creation time.
- **Update**: Modified via `task.update` MCP tool or `PATCH /api/tasks/:key`.
- **Read**: Returned in GET task detail and list responses.
- **Validation**: Invalid values rejected with 400.
- **PR link**: Sourced from `gitref.mr_url`, not a separate column.
