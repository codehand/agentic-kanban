# Project switcher — routing, dropdown, empty-state, create API (TASK-022)

## Path-based project routing

`server/src/http/static.ts` resolves URLs in two passes:

1. **Direct file** — `/index.html`, `/theme.css`, … serve straight from `design-system/`.
2. **Project prefix** — if the first path segment is not a real file and has no
   extension, it is treated as the project id and stripped:
   - `/<project-id>/index.html` → `design-system/index.html`
   - `/<project-id>` and `/<project-id>/` → `design-system/index.html`
   - `/<project-id>/tasks.html`, `/<project-id>/theme.css`, … → the named file

Reserved paths are never rewritten: `/api/*`, `/mcp*`, `/healthz`. Unknown deep
paths (`/a/b/c`) and traversal attempts (`..`) fall through to the 404 router.

Pages read the current project from the URL via `projectFromPath()` (defined in
`design-system/shell.js`, exported as `window.projectFromPath`):

```js
// '/<project-id>/index.html' -> '<project-id>'; '/index.html' -> ''
function projectFromPath() {
  const seg = location.pathname.split('/').filter(Boolean)[0] || '';
  if (!seg || seg.indexOf('.') !== -1) return '';
  return decodeURIComponent(seg);
}
```

Because project ids may not contain dots (enforced by the create API), any
first segment with an extension is a page file, not a project.

## Absolute assets

All pages load shared assets with absolute paths (`/theme.css`, `/theme.js`,
`/api.js`, `/shell.js`, `/tasks.js`) so a project-prefixed URL does not skew
relative asset resolution. (Relative page links like `tasks.html` are kept on
purpose: they preserve the `/<project-id>/` prefix when navigating.)

## Dropdown (shell.js)

The rail's project button (`#project-switcher`) is a real menu:

- `api.listProjects()` populates `#project-menu` with one item per project.
- The current project (from `projectFromPath()`, **not** a hardcoded
  `data-project`) is marked with `aria-current="true"` and a check icon.
- Selecting a project navigates to `/<project-id>/index.html`.
- A11y: `aria-haspopup="menu"` / `aria-expanded` on the button, `role="menu"` /
  `role="menuitem"` on the list, focus moves to the first item on open,
  Escape and outside-click close the menu.
- With 0 projects the menu shows a single "Create first project" link to
  `/first-run.html`.

## Board filtered by project (index.html)

`loadBoard()` no longer aggregates every project:

1. `GET /api/projects` — `0` projects → `location.replace('/first-run.html')`
   (empty-state guide).
2. No project prefix in the URL → redirect to the first project's board.
3. Otherwise resolve the path segment against the project list (slug or id),
   show its slug in the top bar, and load **only** `GET /api/tasks?project=<slug>`.

The SSE handlers (`kanban:created` / `kanban:transition`) filter events with the
same resolved slug, so live toasts and card refreshes work for whichever project
is selected (previously they compared against a hardcoded `data-project="opf-hub"`).

## Create project API

- **HTTP** — `POST /api/projects` (`handleCreateProject` in
  `server/src/api/routes.ts`), same permission as MCP `project.create`
  (`task.create`, human role). Body: `{ "slug": "...", "name": "..." }`
  (`name` defaults to `slug`). Responses: `201 { project }`,
  `400` missing/path-unsafe slug (`^[a-zA-Z0-9][a-zA-Z0-9_-]*$`),
  `401` missing/invalid token, `403` role without permission, `409` duplicate slug.
- **Client** — `design-system/api.js` exposes
  `__kanban_api.createProject({ slug, name })`.
- **UI** — `first-run.html`'s "Create first project" button opens an inline
  form, calls `createProject`, and on success redirects to
  `/<slug>/index.html` (a fresh board in the new project).

## Tests

- `server/src/http/static.test.ts` — routing matrix incl. `/<project>/index.html`.
- `server/src/api/create-project.test.ts` — create + 401/403/400/409 paths.
- `tests/ui/project-switcher.spec.ts` — Playwright E2E against a real server:
  dropdown, URL+board switch, empty-state → first-run, UI create → redirect.
- `scripts/test-projects.mjs` — live API scenario (list → create → list → routing).

See `docs/projects/project-switcher-scenario.md` for runnable scenarios and
`docs/projects/TASK-022/agent-transcript.md` for the recorded MCP agent run.
