# Tasks List View

The **Tasks** page (`design-system/tasks.html`) is a flat, searchable list view of every task across the current project — distinct from the Board kanban (which groups tasks by state columns).

## How to open

- Click **Tasks** in the left rail from any page. The rail highlights the Tasks item (`data-active="tasks"`) and navigates to `tasks.html`.

## What it shows

A table with one row per task:

| Key | Title | State | Updated |
|-----|-------|-------|---------|
| `TASK-023` | Tasks list view | TODO | 2h ago |

States are rendered as colored badges consistent with the board (TODO, IN_PROGRESS, IMPLEMENTED, EVIDENCE, SELF_CHECK_PASSED, SELF_CHECK_FAILED, JUDGE_REJECTED, JUDGE_PASSED, DONE).

## Filtering

- **State dropdown** (top-right): narrow to a single state. Defaults to "All states".
- **Search input**: live-filters rows by key or title substring.

## Opening a task

- Click any row (or focus it with Tab and press Enter/Space) → the task detail drawer opens on the right, showing spec, gitrefs, and evidence.
- Deep-link via hash: `tasks.html#task=TASK-023` opens that task's drawer on load.
- Press `Esc` to close the drawer.

## Data source

Uses the existing `GET /api/tasks?project=<slug>` endpoint via `api.listTasks` — no new backend or MCP calls.

## Accessibility

- Semantic `<table>` with `role="grid"` and `aria-label`.
- Rows are focusable (`tabindex="0"`) and activate on Enter/Space.
- Drawer has `aria-label="Task detail"` and a visible close button.
- Reduced-motion: uses existing `theme.css` tokens — no new animations.

## Screenshots

See `docs/ui/TASK-023/tasks-menu-active.png` (rail with Tasks highlighted) and `docs/ui/TASK-023/tasks-list-view.png` (populated table).
