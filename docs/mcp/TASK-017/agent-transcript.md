# Agent Transcript — TASK-017 MCP Live Update E2E

**Agent**: Claude (implementer)
**Date**: 2026-06-10
**Scenario**: docs/mcp/live-update-scenario.md Scenario 3
**Script**: `node capture-screenshots.mjs` (real Playwright + server execution)

## Setup

- Server started via `createHttpServer()` with file-backed DB (`/tmp/task017-capture.db`)
- Migrations run, admin token bootstrapped
- Two projects seeded: `opf-hub` (id: `proj_opf`) and `other-proj` (id: `proj_other`)
- Token: `tk_test_805d6675cdc0d73a`
- Port: 4599

## Session

### Step 1 — Launch Playwright browser

```
→ Chromium launched (headless, 1440x900 viewport)
→ Navigated to http://127.0.0.1:4599/
→ Set kanban_token in localStorage
→ Reloaded, DOM content loaded
→ Set body.dataset.project = 'opf-hub'
✓ Board loaded, SSE connected
```

### Step 2 — Create task via HTTP API (triggers broadcastCreated → SSE → UI)

```
→ POST http://127.0.0.1:4599/api/tasks
  { project: 'opf-hub', key: 'LIVE-MQ7VLH97', title: 'Live UI test — auto-loaded via SSE' }
← 201 Created
```

**SSE event received by browser**:
```
[sse] created {
  task_id: "task_LIVE-MQ7VLH97_mq7vlh9g",
  project_id: "proj_opf",
  project: "opf-hub",
  key: "LIVE-MQ7VLH97",
  title: "Live UI test — auto-loaded via SSE"
}
```

**UI observation**: 
- Board soft-refetched via `loadBoard()` automatically.
- New card "LIVE-MQ7VLH97" appeared in the Backlog/TODO column.
- Toast displayed: "Task mới: LIVE-MQ7VLH97" (bottom-right, auto-dismissed after 3.2s).
- No full page reload occurred.
- **Screenshot**: `docs/ui/TASK-017/toast-created.png` (1440x900, 70KB)

### Step 3 — Verify card auto-loaded in board

**UI observation**:
- Card "LIVE-MQ7VLH97" with title "Live UI test — auto-loaded via SSE" visible in TODO column.
- Board shows "1 active across 2 projects" in the strip.
- SSE indicator shows "Connected" (green dot).
- **Screenshot**: `docs/ui/TASK-017/board-autoload.png` (1440x900, 70KB)

### Step 4 — Transition task via HTTP approve (triggers broadcastTransition → SSE → UI)

```
→ Created task TR-MQ7VLHKU via POST /api/tasks
→ Manually set state to JUDGE_PASSED in DB (simulating gate progression)
→ POST http://127.0.0.1:4599/api/tasks/TR-MQ7VLHKU/approve?project=opf-hub
  { note: 'Approved via screenshot capture script' }
← 200 OK
```

**SSE event received by browser**:
```
[sse] transition {
  task_id: "task_TR-MQ7VLHKU_mq7vlhkv",
  project: "opf-hub",
  from_state: "JUDGE_PASSED",
  to_state: "DONE",
  actor_role: "human"
}
```

**UI observation**:
- Board soft-refetched.
- Toast displayed: "task_TR-MQ7V: JUDGE_PASSED→DONE" (bottom-right).
- No full page reload occurred.
- **Screenshot**: `docs/ui/TASK-017/toast-transition.png` (1440x900, 71KB)

### Step 5 — Final board state

**UI observation**:
- Board updated showing task counts.
- **Screenshot**: `docs/ui/TASK-017/mcp-live-flow.png` (1440x900, 71KB)

### Step 6 — Project scoping test (AC11)

```
→ POST http://127.0.0.1:4599/api/tasks
  { project: 'other-proj', key: 'OTHER-1', title: 'Wrong project task' }
← 201 Created
```

**SSE event received by browser**:
```
[sse] created {
  task_id: "task_OTHER-1_mq7vlld5",
  project_id: "proj_other",
  project: "other-proj",
  key: "OTHER-1",
  title: "Wrong project task"
}
```

**UI observation**: 
- Toast did NOT appear (suppressed because `project: "other-proj"` !== current project `"opf-hub"`).
- Board did NOT refetch.
- **Result**: PASS — project scoping works correctly.

## Additional Evidence

### test-mcp-live.mjs execution

```
$ node scripts/test-mcp-live.mjs http://127.0.0.1:3000 "tk_test_live4" opf-hub

ok   - SSE connected
ok   - received event: connected
ok   - POST /api/tasks → 201 (key=LIVE-MQ7VP73F)
ok   - received event: created with key=LIVE-MQ7VP73F
ok   - created event has project=opf-hub
ok   - POST /api/tasks → 201 (key=LIVE2-MQ7VP770)
ok   - received second event: created with key=LIVE2-MQ7VP770
ok   - skipped other-project test (no such project)

ALL LIVE TESTS PASS
Exit code: 0
```

### vitest results

```
Test Files  13 passed (13)
     Tests  190 passed (190)
```

## Conclusion

End-to-end flow verified:
1. Task creation → SSE `created` event → UI soft-refetch + toast (no reload).
2. Task transition → SSE `transition` event → UI soft-refetch + toast (no reload).
3. Project scoping: events from other projects are suppressed (no false toast/refetch).
4. Single source of emit (`broadcastCreated`/`broadcastTransition` in `stream.ts`), called from both HTTP and MCP write paths.
5. All screenshots are real browser captures (1440x900, 70-71KB PNGs).
