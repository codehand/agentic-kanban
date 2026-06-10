# TASK-021: Add task attributes: tags, estimate, complexity, priority, link_document (PR from gitref)

Repos: .
Branch: fix/TASK-021-task-attributes

## Purpose
Task entity hiện chỉ có title/body_md/state/allow_no_code_change (`task` table, `0001_init.sql:19`).
Bổ sung 5 thuộc tính người dùng yêu cầu để quản lý tốt hơn: **tags, estimate_time, complexity,
priority, link_document**. "Link PR" **không thêm cột mới** — tái dùng `gitref.mr_url` (đã lưu PR/MR theo
repo) để hiển thị. Các thuộc tính đặt được **lúc tạo và sửa sau** (thêm `task.update` MCP + HTTP PATCH).

## Scope
- In scope:
  - **DB**: migration mới `server/src/db/migrations/0003_add_task_attributes.sql` — `ALTER TABLE task`
    thêm: `priority TEXT`, `complexity TEXT`, `estimate_hours REAL`, `tags TEXT NOT NULL DEFAULT '[]'`
    (JSON array), `link_document TEXT`. (KHÔNG thêm cột PR.)
  - **Repo** (`server/src/db/repositories/task.ts`): cập nhật `Task`/`NewTask` interface + `insertTask`
    (ghi field mới) + thêm `updateTaskAttributes(db, id, patch)` (chỉ field thuộc tính, không đụng state).
  - **Domain/validation**: enum — `priority ∈ {P0,P1,P2,P3}`, `complexity ∈ {XS,S,M,L,XL}`,
    `estimate_hours` number ≥ 0, `tags` string[], `link_document` URL. Dùng `zod`.
  - **MCP** (`server/src/mcp/tools/write.ts`): mở rộng `task.create` inputSchema nhận field mới; thêm tool
    **`task.update`** (human/author) cập nhật thuộc tính (không đổi state).
  - **HTTP** (`server/src/api/routes.ts`): create nhận field mới; thêm **`PATCH /api/tasks/:key`** qua
    handler **`handleUpdateTask`** (human-only) cập nhật thuộc tính; GET task detail + list trả field mới;
    PR link suy ra từ `gitref.mr_url` (đã có trong detail).
  - **UI**:
    - `new-task.html`: thêm field (id/name) cho priority (select P0–P3), complexity (select XS–XL),
      estimate_hours (number), tags (chips/CSV), link_document (URL).
    - `index.html` task detail drawer: hiển thị + cho **sửa** thuộc tính (gọi PATCH); hiện PR link từ gitref.
    - Board card: badge priority + tags (gọn).
    - `api.js`: `createTask` gửi field mới + thêm `updateTask(project,key,patch)` (PATCH).
  - **Output UI bắt buộc**: `tests/ui/task-attributes.spec.ts` (Playwright) — tạo task với thuộc tính,
    rồi sửa ở detail, assert hiển thị; ảnh flow step-by-step + ảnh form/detail/board badge vào
    `docs/ui/TASK-021/`.
  - **Output core feature/MCP bắt buộc**:
    - `docs/api/task-attributes.md`: tài liệu field, enum, create/update API.
    - `scripts/test-task-attributes.mjs`: **API test script** — create kèm thuộc tính → GET xác nhận →
      PATCH đổi → GET xác nhận.
    - `docs/api/task-attributes-scenario.md`: **kịch bản test API** + **kịch bản test với agent**.
    - `examples/task-attributes/`: **source example from scratch** (MCP client set thuộc tính qua
      task.create/task.update).
    - **Spawn sub-agent** kết nối MCP chạy kịch bản → transcript `docs/api/TASK-021/agent-transcript.md`.
- Out of scope:
  - Thêm cột PR riêng (dùng gitref.mr_url).
  - Filter/sort board theo thuộc tính mới (chỉ hiển thị + badge); sẽ là task sau.
  - Đổi state machine / lease / evidence.

## Acceptance Criteria

### Machine-verifiable (chấm bởi TASK-021.ac.sh + gate; build/test hard-required)
- [ ] AC1: project builds (`build.exit == 0`) — `pnpm build`.
- [ ] AC2: tests pass (`test.exit == 0`) — `pnpm test` (vitest, gồm test thuộc tính).
- [ ] AC3: migration thêm 5 cột — `server/src/db/migrations/0003_add_task_attributes.sql` `ALTER TABLE task`
      thêm `priority`, `complexity`, `estimate_hours`, `tags`, `link_document`.
- [ ] AC4: repo cập nhật — `task.ts` `Task` interface có field mới, `insertTask` ghi field mới, và có
      `updateTaskAttributes`.
- [ ] AC5: MCP — `write.ts` `task.create` schema có field mới và đăng ký tool `task.update`.
- [ ] AC6: HTTP — `routes.ts` có `handleUpdateTask` (định nghĩa + gọi) cho `PATCH /api/tasks/:key`.
- [ ] AC7: UI form — `new-task.html` có field cho `priority`, `complexity`, `estimate`/`estimate_hours`,
      `tags`, `link_document`; `api.js` có `updateTask`.
- [ ] AC8: UI detail — `index.html` tham chiếu hiển thị `priority` và `tags` (+ các field) trong detail.
- [ ] AC9: vitest cover — test create với thuộc tính persist **và** update đổi thuộc tính **và** reject
      enum sai (priority không hợp lệ).
- [ ] AC10: artifacts core — `docs/api/task-attributes.md`, `docs/api/task-attributes-scenario.md`,
      `scripts/test-task-attributes.mjs`, `examples/task-attributes/` (không rỗng),
      `docs/api/TASK-021/agent-transcript.md`.
- [ ] AC11: output UI — `tests/ui/task-attributes.spec.ts` (assert thuộc tính hiển thị) +
      `docs/ui/TASK-021/` ≥ 3 ảnh `.png` gồm tên chứa `form` và `detail`.

### Human / semantic (Judge + Human)
- [ ] AC12: end-to-end thật — tạo + sửa thuộc tính qua UI/MCP đều persist (ảnh + transcript chứng minh);
      PR link hiển thị từ gitref (không cột mới).
- [ ] AC13: validation thật — enum priority/complexity, estimate ≥ 0, link_document là URL, tags là mảng;
      input sai bị từ chối (400) — test không tautology / không skip.
- [ ] AC14: migration an toàn — chạy trên DB cũ không mất data (cột mới có default hợp lý); a11y AA cho
      field/badge mới; reduced-motion không vỡ.

## Definition of Done
Mọi machine-verifiable AC pass dưới evidence mới sinh, Judge `VERDICT: PASS`, và human
`.ai/scripts/gate.sh approve TASK-021`.

## Dependencies
TASK-019 (POST /api/tasks + create form) là base cho create UI/endpoint — rebase vì cùng chạm
`routes.ts`/`new-task.html`/`api.js`/`write.ts`. TASK-009 (API/UI). Liên quan TASK-016/017/018 nếu trùng file UI.

## References
- server/src/db/migrations/0001_init.sql:19 (task table) · 0002 (mẫu ALTER migration)
- server/src/db/repositories/task.ts (interface + insert) · server/src/mcp/tools/write.ts:95 (task.create)
- server/src/api/routes.ts (create/get/list; PATCH thêm mới) · gitref.mr_url (PR link nguồn sẵn)
- design-system/new-task.html · index.html (detail drawer) · api.js
- TASK_HUB_DESIGN.md §4 (data model) · §6 (tools) · UI_DESIGN_BRIEF.md
