# Live Update — Test Scenarios (TASK-017)

## Scenario 1 — API test (automated, `scripts/test-mcp-live.mjs`)

Preconditions:
- Server running on `http://localhost:4545`
- At least one project exists (e.g. slug `opf-hub`)
- A valid human bearer token (minted via `POST /api/tokens`)

Steps:
1. Open `EventSource('http://localhost:4545/api/stream')`.
2. Wait for `event: connected`.
3. `POST /api/tasks` with `{ project: 'opf-hub', key: 'LIVE-1', title: 'live test' }`.
4. Assert an `event: created` frame arrives within 3s whose `data.key === 'LIVE-1'`.
5. `POST /api/tasks/:key/approve?project=opf-hub` after advancing through states,
   or call MCP `task.transition` to move a task.
6. Assert an `event: transition` frame arrives whose payload contains `from_state`
   and `to_state`.
7. Close `EventSource`.

Expected exit: 0 on success, non-zero on failure.

## Scenario 2 — UI end-to-end (Playwright, `tests/ui/live-update.spec.ts`)

Preconditions:
- Server started with test DB
- Playwright browser context

Steps:
1. Sign in (set token in localStorage).
2. Navigate to board.
3. Create a task via `fetch('/api/tasks', ...)` from the page context.
4. Assert the new card appears in the TODO column within 5s.
5. Assert the toast is visible with text containing the task key.

## Scenario 3 — Agent end-to-end via MCP

Preconditions:
- MCP server running on stdio
- Agent (Claude) connected as MCP client with an `implementer` role token

Steps:
1. Agent calls `task.create` tool with `{ project: 'opf-hub', key: 'AGENT-1', title: 'agent test' }`.
2. Agent observes tool result → task created with state `TODO`.
3. Agent calls `task.transition` with `{ project: 'opf-hub', key: 'AGENT-1', from: 'TODO', to: 'IN_PROGRESS' }`.
4. Agent observes tool result → transition record returned.
5. Simultaneously, the UI (open in a browser) should:
   - Show a toast "Task mới: AGENT-1" after step 1.
   - Show a toast "AGENT-1: TODO→IN_PROGRESS" after step 3.
   - Display the task in the In Progress column without page reload.

Transcript: `docs/mcp/TASK-017/agent-transcript.md`.
Screenshots: `docs/ui/TASK-017/*autoload*.png`, `docs/ui/TASK-017/*toast*.png`.

## Scenario 4 — Edge cases

- **SSE disconnect + reconnect**: kill server briefly, restart; UI's
  `EventSource` auto-reconnects; heartbeat dot returns to full opacity.
- **Task created in different project**: UI shows toast with key but
  `loadBoard()` refetches all projects, so the task appears (board is
  cross-project).
- **Reduced motion**: CSS `@media (prefers-reduced-motion: reduce)` is
  not affected — toast uses class toggle, not animation.
- **a11y**: toast has `role="status"` semantics via its position in the
  DOM and text content; screen readers announce the text change.
