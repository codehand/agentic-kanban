# Live Update Architecture — SSE from MCP write path

TASK-017 closes the gap where tasks created or transitioned via the MCP
tool path did not propagate to the live UI. The UI already subscribed to
`/api/stream` (SSE) and listened for `transition` events, but the MCP
write path (`server/src/mcp/tools/write.ts`) mutated the DB directly
without emitting anything.

## Event bus (single source)

All SSE emissions flow through one module:

```
server/src/api/stream.ts
├── sseBus               — EventEmitter singleton (test-friendly)
├── broadcastCreated()   — emit "event: created"   + sseBus.emit('created', ...)
└── broadcastTransition()— emit "event: transition" + sseBus.emit('transition', ...)
```

Both the HTTP route layer (`server/src/api/routes.ts`) and the MCP write
layer (`server/src/mcp/tools/write.ts`) import from `stream.ts`. There
is no other place that writes SSE frames, so a given DB change produces
exactly one event — no double-emit is possible for the same mutation.

## Event types

| Event       | Trigger                                  | Payload fields                                        |
|-------------|------------------------------------------|-------------------------------------------------------|
| `created`   | `POST /api/tasks` or MCP `task.create`   | `task_id`, `project_id`, `key`, `title`, `at`         |
| `transition`| approve / reset / MCP `task.transition` / MCP `task.approve` / MCP `task.selfcheck` | `task_id`, `from_state`, `to_state`, `actor_role`, `at` |

## UI handling (`design-system/api.js` + `index.html`)

1. `api.js` opens `EventSource('/api/stream')` and dispatches
   `CustomEvent('kanban:created', ...)` and `CustomEvent('kanban:transition', ...)`.
2. `index.html` listens for both custom events and:
   - calls `loadBoard()` (soft-refetch — no `location.reload()`)
   - calls `showToast(type, msg)` to display a transient notification
3. Reconnect behaviour is unchanged: `EventSource` auto-reconnects on
   error; the heartbeat dot fades while disconnected.

## Flow — MCP task.create

```
MCP client → task.create tool → write.ts
                                ├── insertTask(db, ...)
                                └── broadcastCreated({...})
                                        ├── writes SSE frame to all clients
                                        └── sseBus.emit('created', {...})
                                                └── UI: kanban:created → loadBoard() + showToast
```

## Flow — MCP task.transition

```
MCP client → task.transition tool → write.ts
                                    ├── propose(...) (gate)
                                    └── broadcastTransition({...})
                                            ├── writes SSE frame to all clients
                                            └── sseBus.emit('transition', {...})
                                                    └── UI: kanban:transition → loadBoard() + showToast
```

## Testing

- Unit: `server/src/api/stream.test.ts` — asserts `sseBus` emits both
  event types and SSE clients receive the correct frames.
- E2E (Playwright): `tests/ui/live-update.spec.ts` — creates a task via
  the API and asserts the new card appears in the TODO column and a
  toast is shown.
- Live script: `scripts/test-mcp-live.mjs` — opens SSE and creates a
  task via HTTP, asserts `created` frame received.
