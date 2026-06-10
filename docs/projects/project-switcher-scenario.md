# Project switcher — test scenarios (TASK-022)

## Prerequisites

```bash
pnpm install
pnpm build
cp -R server/src/db/migrations dist/db/    # tsc does not copy .sql files
ADMIN_TOKEN=my-secret PORT=3000 DB_PATH=/tmp/kanban.db node dev-server.mjs
```

`ADMIN_TOKEN` bootstraps a human bearer token whose secret is the value itself.

## Scenario A — API test (HTTP)

Run the scripted scenario (list → create → list → routing):

```bash
KANBAN_BASE_URL=http://localhost:3000 KANBAN_TOKEN=my-secret node scripts/test-projects.mjs
```

Expected: `Results: 7 passed, 0 failed`, covering:

| Step | Call | Expect |
|---|---|---|
| 1 | `GET /api/projects` | 200, array (notes empty case on a fresh DB) |
| 2 | `POST /api/projects {slug,name}` | 201, `project.slug` echoes |
| 3 | `GET /api/projects` | new project present, count +1 |
| 4 | `POST /api/projects` without token | 401 |
| 5 | `POST` missing slug / slug `a/b` | 400 |
| 6 | `POST` duplicate slug | 409 |
| 7 | `GET /<slug>/index.html` | 200 `text/html`, board markup |

Manual curl equivalents:

```bash
curl -s -X POST http://localhost:3000/api/projects \
  -H 'Authorization: Bearer my-secret' -H 'Content-Type: application/json' \
  -d '{"slug":"my-project","name":"My Project"}'
# -> 201 {"project":{...}}

curl -s http://localhost:3000/my-project/index.html | head -1
# -> <!doctype html>
```

## Scenario B — test with an agent (MCP)

An agent (MCP client) connects to `/mcp` over Streamable HTTP with the bearer
token and runs: `project.list` → `project.create` → `project.list` → board check.

```bash
KANBAN_URL=http://localhost:3000 KANBAN_TOKEN=my-secret node examples/projects/index.mjs
```

Expected output ends with `=== Example complete ===` (exit 0). The recorded run
of this scenario lives in `docs/projects/TASK-022/agent-transcript.md`.

Agent prompt sketch (for an LLM agent wired to this MCP server):

> You are connected to an Agentic Kanban MCP server. List the projects. If a
> project named "demo" does not exist, create it with `project.create`
> (slug `demo`). List projects again and report the board URL
> `/<slug>/index.html` for it.

The agent must observe: `project.list` result growing by one, and the server
serving the board at the project-prefixed URL.

## Scenario C — UI (Playwright)

```bash
pnpm build
pnpm exec playwright test tests/ui/project-switcher.spec.ts
```

The spec spawns its own server (port 4622, throwaway DB), seeds `proj-alpha` /
`proj-beta` with one task each, and asserts:

1. `/proj-alpha/index.html` shows only "Alpha only task".
2. The rail dropdown lists both projects, marks `proj-alpha` current.
3. Choosing `proj-beta` navigates to `/proj-beta/index.html` and the board now
   shows only "Beta only task".
4. Escape closes the dropdown (`aria-expanded` toggles).
5. With 0 projects (`/api/projects` mocked empty) the board redirects to
   `first-run.html`; creating a project via the form redirects to
   `/<slug>/index.html` with an empty board.

Screenshots land in `docs/ui/TASK-022/` (`01-board-proj-alpha.png`,
`02-dropdown-open.png`, `03-switch-proj-beta.png`, `04-empty-first-run.png`,
`05-create-first-project-redirect.png`).
