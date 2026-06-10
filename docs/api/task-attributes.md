# Task Attributes API Documentation

## Overview

TASK-021 adds 5 new attributes to the Task entity:

| Field            | Type          | Enum / Constraint            | Default | Description              |
|------------------|---------------|------------------------------|---------|--------------------------|
| `priority`       | `TEXT`        | `P0`, `P1`, `P2`, `P3`       | `NULL`  | Urgency level            |
| `complexity`     | `TEXT`        | `XS`, `S`, `M`, `L`, `XL`    | `NULL`  | Effort sizing            |
| `estimate_hours` | `REAL`        | `≥ 0`                        | `NULL`  | Estimated hours to complete |
| `tags`           | `TEXT` (JSON) | string[]                     | `'[]'`  | Comma-separated tags     |
| `link_document`  | `TEXT`        | valid URL                    | `NULL`  | Link to spec/doc         |

**Note**: PR/MR links are NOT stored as a new column. They are accessed via `gitref.mr_url`.

## Create Task with Attributes

### HTTP

```
POST /api/tasks
Authorization: Bearer <token>
Content-Type: application/json

{
  "project": "my-project",
  "key": "TASK-042",
  "title": "Implement feature X",
  "priority": "P1",
  "complexity": "M",
  "estimate_hours": 8,
  "tags": ["backend", "api"],
  "link_document": "https://docs.example.com/feature-x"
}
```

### MCP Tool

```
task.create({
  project: "my-project",
  key: "TASK-042",
  title: "Implement feature X",
  priority: "P1",
  complexity: "M",
  estimate_hours: 8,
  tags: ["backend", "api"],
  link_document: "https://docs.example.com/feature-x"
})
```

## Update Task Attributes

### HTTP

```
PATCH /api/tasks/:key?project=<project>
Authorization: Bearer <token>
Content-Type: application/json

{
  "priority": "P0",
  "tags": ["urgent", "critical"]
}
```

Only the fields provided are updated. Omitted fields are left unchanged.

### MCP Tool

```
task.update({
  project: "my-project",
  key: "TASK-042",
  priority: "P0",
  tags: ["urgent", "critical"]
})
```

## GET Response

Task list and detail endpoints return the new fields:

```json
{
  "task": {
    "id": "task_...",
    "key": "TASK-042",
    "title": "Implement feature X",
    "priority": "P1",
    "complexity": "M",
    "estimate_hours": 8,
    "tags": ["backend", "api"],
    "link_document": "https://docs.example.com/feature-x",
    ...
  }
}
```

## Validation Rules

- `priority` — must be one of `P0`, `P1`, `P2`, `P3` (or null/omitted).
- `complexity` — must be one of `XS`, `S`, `M`, `L`, `XL` (or null/omitted).
- `estimate_hours` — must be a non-negative number (or null/omitted).
- `tags` — must be an array of strings.
- `link_document` — must be a valid URL string (or null/omitted).

Invalid values result in a `400 Bad Request` response.

## Authorization

- `task.create` — requires `task.create` permission (human role).
- `task.update` — requires `task.update` permission (human + implementer roles).
- Both MCP and HTTP share the same authorization model.

## Migration Safety

The migration `0003_add_task_attributes.sql` uses `ALTER TABLE` with safe defaults:
- All columns are nullable except `tags` (which defaults to `'[]'`).
- Existing tasks are unaffected.
