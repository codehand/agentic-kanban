# TASK-019: Fix CTA New Task: end-to-end create (POST /api/tasks + wire form + nav)

Repos: .
Branch: fix/TASK-019-cta-new-task-create

## Purpose
Bug: CTA "New Task" không hoạt động — hỏng theo cả chuỗi (đã xác minh):
1. Nút "New Task" trên board (`design-system/index.html:49`) **không có id/onclick/link** → bấm không mở
   được màn tạo task.
2. Form `new-task.html` **không có `<form>`**, nút "Create task" (`:122`) **không có id/handler**; phần lớn
   field thiếu `id`/`name` (chỉ có `#title`) → submit không làm gì.
3. `design-system/api.js` **không có `createTask`** (chỉ list/get/approve/reset/remove).
4. Server **không có route POST tạo task** — `routes.ts` POST chỉ approve/reset/remove; chỉ có
   `GET /api/tasks`. Tạo task hiện chỉ tồn tại trên **MCP path** (`mcp/tools/write.ts` task.create).

Mục tiêu: tạo task qua Web UI **chạy thật end-to-end** — bấm New Task → màn tạo → điền → Create →
task được tạo ở `TODO` → quay về board thấy task (toast). `human` role đã có quyền `task.create`
(`authorize.ts`), nên expose qua HTTP là nhất quán; tái dùng domain logic của MCP `task.create`.

## Scope
- In scope:
  - **Server**: thêm `POST /api/tasks` (human-only) qua handler đặt tên **`handleCreateTask`** trong
    `routes.ts` (đặt tên rõ để phân biệt nhánh GET list) → tạo task ở `TODO`, tái dùng đúng domain/service
    mà MCP `task.create` dùng (không nhân bản logic state machine). Validate input (project, title, …),
    trả 401 khi thiếu/invalid token, 403 nếu role không có `task.create`, 400 nếu thiếu field.
  - **Client**: thêm `api.createTask(payload)` trong `design-system/api.js` (POST `/tasks`).
  - **UI new-task.html**: bọc field trong `<form>`, thêm `id`/`name` cho các field (project, title, branch,
    repos, description, allow-no-code-change); nút "Create task" có `id` + handler → gọi `api.createTask`
    → thành công thì redirect `index.html` (+ toast "Task <key> created"), lỗi thì hiện message.
  - **UI index.html**: nút "New Task" có `id` + điều hướng sang `new-task.html`.
  - **Tests (vitest)**: `POST /api/tasks` tạo task ở TODO + reload thấy qua `GET /api/tasks`; 401 thiếu
    token; 403 role không hợp lệ; 400 thiếu field.
  - **Output UI bắt buộc**: `tests/ui/new-task.spec.ts` (Playwright) — bấm New Task → điền → Create →
    assert quay về board và task mới xuất hiện + toast; ảnh flow step-by-step + **ảnh CTA** vào
    `docs/ui/TASK-019/` (CTA New Task, form, board-sau-tạo).
  - **Output core API bắt buộc**:
    - `docs/api/create-task.md`: tài liệu endpoint (request/response, auth, lỗi).
    - `scripts/test-create-task.mjs`: **API test script** — POST tạo task rồi GET xác nhận.
    - `docs/api/create-task-scenario.md`: **kịch bản test API** + **kịch bản test với agent**.
    - `examples/create-task/`: **source example set up from scratch** (MCP client tối thiểu gọi
      `task.create`).
    - **Spawn sub-agent** kết nối MCP chạy kịch bản tạo task → transcript
      `docs/api/TASK-019/agent-transcript.md`.
- Out of scope:
  - Edit/clone task, bulk create, drag-to-state.
  - Đổi font/màu/theme (TASK-016/018) & live-update SSE (TASK-017) — chỉ chạm nếu cần redirect/toast.
  - Tạo branch/worktree (vẫn chỉ tạo task ở TODO; branch tạo lúc IN_PROGRESS như hiện tại).

## Acceptance Criteria

### Machine-verifiable (chấm bởi TASK-019.ac.sh + gate; build/test hard-required)
- [ ] AC1: project builds (`build.exit == 0`) — `pnpm build`.
- [ ] AC2: tests pass (`test.exit == 0`) — `pnpm test` (vitest, gồm test create).
- [ ] AC3: New Task CTA wired — nút "New Task" trong `index.html` có `id` và trỏ tới `new-task.html`.
- [ ] AC4: server có create route — `server/src/api/routes.ts` có handler `handleCreateTask` (định nghĩa
      + gọi trong nhánh `POST`) xử lý `POST /api/tasks`.
- [ ] AC5: client có createTask — `design-system/api.js` có `createTask` gọi `POST` `/tasks`.
- [ ] AC6: form wired — `new-task.html` có `<form>`, nút "Create task" có `id`, và có gọi `createTask`.
- [ ] AC7: vitest cover create — có test cho `POST /api/tasks` (tạo @TODO) **và** 401 khi thiếu token.
- [ ] AC8: artifacts core API — `docs/api/create-task.md`, `docs/api/create-task-scenario.md`,
      `scripts/test-create-task.mjs`, `examples/create-task/` (không rỗng),
      `docs/api/TASK-019/agent-transcript.md`.
- [ ] AC9: output UI — `tests/ui/new-task.spec.ts` (assert task/toast) + `docs/ui/TASK-019/` ≥ 3 ảnh `.png`
      gồm tên chứa `cta` và `created`.

### Human / semantic (Judge + Human)
- [ ] AC10: end-to-end thật — bấm New Task → tạo → task xuất hiện ở board (ảnh + transcript chứng minh),
      tái dùng domain logic MCP (không nhân bản state machine).
- [ ] AC11: error path cover thật — 401 thiếu token, 403 sai role, 400 thiếu field; không auto chạy code
      (task chỉ ở TODO).
- [ ] AC12: test/spec assert thật (không tautology/`skip`/xoá assertion); kịch bản agent + example
      from-scratch chạy được; transcript khớp kịch bản.

## Definition of Done
Mọi machine-verifiable AC pass dưới evidence mới sinh, Judge `VERDICT: PASS`, và human
`.ai/scripts/gate.sh approve TASK-019`.

## Dependencies
TASK-009 (API/UI wiring) là base. Liên quan TASK-017 (toast/SSE) — nếu redirect dùng toast/live thì rebase.

## References
- design-system/index.html:49 (New Task CTA — chưa wire)
- design-system/new-task.html:122 (Create task — chưa wire; thiếu <form>/id)
- design-system/api.js (chưa có createTask)
- server/src/api/routes.ts:393 (POST block — chỉ approve/reset/remove)
- server/src/mcp/tools/write.ts (task.create domain logic để tái dùng) · server/src/auth/authorize.ts:47 (human có task.create)
- TASK_HUB_DESIGN.md §6 (task.create) · UI_DESIGN_BRIEF.md (màn New Task)
