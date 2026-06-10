# POST /api/tasks — Create Task

Creates a new task in a project at `TODO` state.

## Authentication

- **Required**: Bearer token in `Authorization` header
- **Role**: `human` (other roles receive 403)

## Request

```http
POST /api/tasks
Authorization: Bearer <token>
Content-Type: application/json

{
  "project": "opf-hub",
  "key": "TASK-123",
  "title": "Implement feature X",
  "body_md": "## Purpose\n...",
  "allow_no_code_change": false
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `project` | string | yes | Project slug or ID |
| `key` | string | yes | Unique task key (e.g., `TASK-123`) |
| `title` | string | yes | Task title |
| `body_md` | string | no | Task specification in markdown |
| `allow_no_code_change` | boolean | no | Allow task with no code changes (default: `false`) |

## Response

### 201 Created

```json
{
  "task": {
    "id": "task_TASK-123_abc123",
    "project_id": "proj_xxx",
    "key": "TASK-123",
    "title": "Implement feature X",
    "body_md": "## Purpose\n...",
    "state": "TODO",
    "allow_no_code_change": false,
    "assignee_token_id": null,
    "lease_until": null,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z"
  }
}
```

### Error Responses

| Status | Description |
|--------|-------------|
| 400 | Missing required fields (`project`, `key`, `title`) |
| 401 | Missing or invalid Authorization header |
| 403 | Role does not have `task.create` permission |
| 404 | Project not found |
| 409 | Task with same key already exists in project |

## Example

```bash
curl -X POST http://localhost:3000/api/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "project": "opf-hub",
    "key": "TASK-123",
    "title": "Implement feature X",
    "body_md": "## Purpose\nImplement feature X"
  }'
```
