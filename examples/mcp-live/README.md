# MCP Live Update — Example Client

Minimal example showing how to connect an MCP client to the Agentic
Kanban server, create a task, and observe live SSE updates.

## Prerequisites

- Node.js ≥ 20
- An Agentic Kanban server running (default `http://localhost:4545`)
- A bearer token with `implementer` or `human` role

## Setup

```bash
cd examples/mcp-live
npm install
export KANBAN_URL=http://localhost:4545
export KANBAN_TOKEN=<your-bearer-token>
export KANBAN_PROJECT=opf-hub
node index.mjs
```

## What it does

1. Connects to the MCP server via stdio transport (spawns the server).
2. Opens an SSE connection to `/api/stream`.
3. Calls `task.create` to create a new task.
4. Calls `task.transition` to move the task from TODO → IN_PROGRESS.
5. Prints the SSE events received, demonstrating live updates.

## Files

- `index.mjs` — the example client
- `package.json` — dependencies (`@modelcontextprotocol/sdk`)
