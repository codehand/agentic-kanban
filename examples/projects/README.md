# Projects MCP example (TASK-022)

Minimal MCP client built from scratch that exercises the project tools over the
server's Streamable HTTP `/mcp` endpoint:

1. `project.list` — list existing projects.
2. `project.create` — create a unique project (`proj-mcp-<ts>`).
3. `project.list` — verify the new project is visible.
4. `GET /<slug>/index.html` — verify path-based routing serves the new project's board.

## Run

Start the server (from the repo root):

```bash
pnpm build
cp -R server/src/db/migrations dist/db/migrations   # tsc does not copy .sql files
ADMIN_TOKEN=my-secret PORT=3000 DB_PATH=/tmp/kanban.db node dev-server.mjs
```

Then run the example:

```bash
KANBAN_URL=http://localhost:3000 KANBAN_TOKEN=my-secret node examples/projects/index.mjs
```

Expected output ends with `=== Example complete ===` and exit code 0.
The token must have `task.create` permission (human role) — `project.create`
requires it, mirroring the HTTP `POST /api/projects` endpoint.
