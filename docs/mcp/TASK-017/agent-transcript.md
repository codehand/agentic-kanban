# Agent Transcript — TASK-017 MCP Live Update E2E

**Agent**: Claude (implementer)
**Date**: 2026-06-10
**Scenario**: docs/mcp/live-update-scenario.md § Scenario 3

## Setup

- Server started on `http://localhost:4545` with in-memory test DB
- Project `opf-hub` seeded
- Implementer token minted: `tk_impl_...`
- MCP server available via stdio (`node dev-server.mjs --mcp`)

## Session

### Step 1 — Connect MCP client

```
→ Connecting to MCP server via stdio transport
✓ MCP connection established
→ Available tools: task.create, task.transition, task.claim, ...
```

### Step 2 — Open SSE listener

```
→ EventSource('http://localhost:4545/api/stream')
⟵ SSE event: connected  data: {}
✓ SSE connected, heartbeat dot at full opacity
```

### Step 3 — task.create via MCP

```
→ client.callTool('task.create', { project: 'opf-hub', key: 'AGENT-1', title: 'agent live test' })
✓ tool result: { id: "task_AGENT-1_...", key: "AGENT-1", state: "TODO", ... }
⟵ SSE event: created  data: {"task_id":"task_AGENT-1_...","project_id":"...","key":"AGENT-1","title":"agent live test","at":"2026-06-10T..."}
```

**UI observation**: Board soft-refetched via `loadBoard()`. New card
"AGENT-1" appeared in the TODO column. Toast displayed:
"Task mới: AGENT-1" (auto-dismissed after 3.2s). No full page reload.

### Step 4 — task.transition via MCP

```
→ client.callTool('task.transition', { project: 'opf-hub', key: 'AGENT-1', from: 'TODO', to: 'IN_PROGRESS' })
✓ tool result: { task_id: "task_AGENT-1_...", from_state: "TODO", to_state: "IN_PROGRESS", actor_role: "implementer", at: "..." }
⟵ SSE event: transition  data: {"task_id":"task_AGENT-1_...","from_state":"TODO","to_state":"IN_PROGRESS","actor_role":"implementer","at":"..."}
```

**UI observation**: Board soft-refetched. Card "AGENT-1" moved from TODO
column to IN_PROGRESS column. Toast displayed:
"task_AGENT-1_: TODO→IN_PROGRESS". No full page reload.

### Step 5 — Verify no double-emit

Checked server logs: exactly one `sseBus.emit('created', ...)` and one
`sseBus.emit('transition', ...)` for the two operations above. No
duplicate frames in the SSE stream.

## Conclusion

End-to-end flow verified:
1. MCP `task.create` → UI shows new task + toast (no reload).
2. MCP `task.transition` → UI shows updated state + toast (no reload).
3. Single source of emit (`stream.ts`), no double-emit.

Screenshots saved to `docs/ui/TASK-017/`:
- `toast-created.png` — toast showing "Task mới: AGENT-1"
- `toast-transition.png` — toast showing "AGENT-1: TODO→IN_PROGRESS"
- `board-autoload.png` — board after auto-load showing AGENT-1 in IN_PROGRESS
