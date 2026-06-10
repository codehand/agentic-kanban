# TASK-017: Live UI updates: emit SSE từ MCP write path + event task-created + toast/soft-reload

Repos: .
Branch: fix/TASK-017-live-ui-mcp-sse-toast

## Purpose
Bug: UI có trạng thái loading nhưng khi tạo/đổi task **qua MCP** thì UI không auto hiện task mới.
Nguyên nhân gốc (đã xác minh trong code):
1. Live update dùng **SSE** (`/api/stream` + `EventSource`), không phải WebSocket.
2. `broadcastTransition` **chỉ** được gọi từ HTTP write path (`server/src/api/routes.ts:257` — human
   approve/reset/remove). **MCP write path** (`server/src/mcp/tools/write.ts`: task.create / task.claim /
   task.transition) đổi DB trực tiếp và **không emit event** → UI không nhận tín hiệu.
3. Chỉ có event type `transition`; **không có event `created`**, mà tạo task không phải transition.
4. UI phản ứng bằng `location.reload()` thô; đã có sẵn `showToast()` + `#toast` nhưng chưa nối với live.

Mục tiêu: mọi thay đổi qua MCP (task mới / đổi status) được push sống tới UI; UI **soft-refetch** dữ liệu
(không full page reload) và **show toast** khi có task mới / task đổi trạng thái.

## Scope
- In scope:
  - **Emit từ một chỗ chung**: rút phần emit ra service/helper để CẢ HTTP path lẫn **MCP write path**
    (`server/src/mcp/tools/write.ts`) đều phát event sau khi đổi DB thành công (task.create, task.claim,
    task.transition, và human actions). Tránh double-emit cho cùng một thay đổi.
  - **Thêm event `created`** trong `server/src/api/stream.ts` (vd `broadcastCreated({task_id, project, ...})`)
    bên cạnh `transition`. Giữ singleton bus + `sseBus` cho test.
  - **UI** (`design-system/api.js` + `index.html`): lắng nghe `created` và `transition`; thay
    `location.reload()` bằng **soft-refetch** (gọi lại loader của board/list) và **show toast**
    ("Task mới: <key>" / "<key>: <from>→<to>"). Reconnect SSE giữ nguyên.
  - **Tests (vitest)**: MCP `task.create` phát `created` trên `sseBus`; MCP `task.transition` phát
    `transition`; không double-emit khi đi qua HTTP.
  - **Output UI bắt buộc**: Playwright spec `tests/ui/live-update.spec.ts` mô phỏng tạo task qua API rồi
    assert UI thêm task + toast hiện; ảnh flow step-by-step vào `docs/ui/TASK-017/` (gồm ảnh toast +
    board auto-load). CTA/MENU/FONT: chỉ chụp nếu có chỉnh sửa nhìn thấy (task này không đổi font).
  - **Output core MCP bắt buộc**:
    - `docs/mcp/live-update.md`: tài liệu kiến trúc (emit chung, event types, UI handling).
    - `scripts/test-mcp-live.mjs`: **API test script** — tạo task qua API/MCP, mở SSE, assert nhận
      `created`/`transition`.
    - `docs/mcp/live-update-scenario.md`: **kịch bản test API** + **kịch bản test với agent**.
    - `examples/mcp-live/`: một **source example set up from scratch** (MCP client tối thiểu kết nối server).
    - **Thực thi spawn sub-agent** kết nối MCP chạy theo kịch bản → lưu transcript
      `docs/mcp/TASK-017/agent-transcript.md` + ảnh `docs/ui/TASK-017/*autoload*.png`.
- Out of scope:
  - Migrate sang WebSocket (giữ SSE — đã chốt).
  - Đổi font/màu/layout (TASK-016 lo font).
  - Drag-to-change-state, diff viewer, auto-merge MR.

## Acceptance Criteria

### Machine-verifiable (chấm bởi TASK-017.ac.sh + gate; build/test hard-required)
- [ ] AC1: project builds (`build.exit == 0`) — `pnpm build` (tsc).
- [ ] AC2: tests pass (`test.exit == 0`) — `pnpm test` (vitest, gồm test emit mới).
- [ ] AC3: MCP write path emit event — `server/src/mcp/tools/write.ts` import & gọi hàm broadcast
      (`broadcastCreated`/`broadcastTransition`) sau khi đổi DB.
- [ ] AC4: có event `created` — `server/src/api/stream.ts` export `broadcastCreated` và phát
      `event: created`.
- [ ] AC5: UI live + toast — `design-system/api.js` `addEventListener('created'...)` và `'transition'`,
      có gọi `showToast`/soft-refetch, và **không còn** `location.reload()` trong handler SSE.
- [ ] AC6: vitest cover emit — tồn tại test (vd `server/src/api/stream.test.ts` hoặc
      `server/src/mcp/*.test.ts`) assert `sseBus` phát `created` khi tạo task qua MCP và `transition`
      khi MCP transition.
- [ ] AC7: artifacts core MCP tồn tại — `docs/mcp/live-update.md`, `docs/mcp/live-update-scenario.md`,
      `scripts/test-mcp-live.mjs`, thư mục `examples/mcp-live/` (không rỗng),
      `docs/mcp/TASK-017/agent-transcript.md`.
- [ ] AC8: output UI tồn tại — `tests/ui/live-update.spec.ts` (có assert toast/task xuất hiện) +
      `docs/ui/TASK-017/` ≥ 3 ảnh `.png` gồm ảnh tên chứa `toast` và `autoload`.

### Human / semantic (Judge + Human)
- [ ] AC9: emit là **một nguồn chung**, không double-emit cho cùng thay đổi; MCP task.create thật sự
      đẩy task lên UI (ảnh autoload + transcript chứng minh end-to-end qua MCP).
- [ ] AC10: test/spec là assert thật (không tautology, không `skip`, không xoá assertion); kịch bản
      agent + example from-scratch chạy được như mô tả; transcript khớp kịch bản.
- [ ] AC11: error/edge path: SSE rớt → reconnect; tạo task khi UI đang mở project khác không gây toast
      sai; a11y AA + reduced-motion (toast) không bị phá.

## Definition of Done
Mọi machine-verifiable AC pass dưới evidence mới sinh, Judge `VERDICT: PASS`, và human
`.ai/scripts/gate.sh approve TASK-017`.

## Dependencies
TASK-009 (P7 — API/SSE + UI wiring) là base. Độc lập với TASK-016 (font).

## References
- server/src/api/stream.ts (SSE bus + broadcastTransition hiện tại)
- server/src/api/routes.ts:257 (chỗ duy nhất đang emit)
- server/src/mcp/tools/write.ts (MCP write path — đang KHÔNG emit)
- design-system/api.js (EventSource handler + location.reload), design-system/index.html (#toast/showToast)
- TASK_HUB_DESIGN.md §8 (timeline) · §9 (web UI) · UI_DESIGN_BRIEF.md
- docs/CONNECT_MCP.md (kết nối MCP client)
