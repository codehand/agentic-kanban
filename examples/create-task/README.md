# Create Task — MCP Client Example

This example demonstrates how to create a task using the MCP (Model Context Protocol) client.

## Prerequisites

- Node.js 18+
- Access to an Agentic Kanban MCP server
- A valid human token

## Setup

1. Install dependencies:
   ```bash
   npm install @modelcontextprotocol/sdk
   ```

2. Set environment variables:
   ```bash
   export MCP_SERVER_URL="http://localhost:3000/mcp"
   export KANBAN_TOKEN="your-human-token-secret"
   ```

## Running

```bash
node index.mjs
```

## Expected Output

```
Connected to MCP server
Creating task...
Task created:
{
  "id": "task_TASK-EXAMPLE-001_abc123",
  "project_id": "proj_xxx",
  "key": "TASK-EXAMPLE-001",
  "title": "Example task",
  "body_md": "This task was created via MCP client",
  "state": "TODO",
  ...
}
```
