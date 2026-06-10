# TASK-023: Fix sidebar Tasks menu: dedicated tasks.html list view + active highlight

Repos: .
Branch: fix/TASK-023-tasks-list-view

## Purpose
Menu "Tasks" ở sidebar trái không hoạt động. Nguyên nhân gốc (đã xác minh):
- Rail nav (`design-system/shell.js:42`) `nav('tasks', 'index.html', …)` — **trỏ cùng `index.html`** như
  "Board" → bấm Tasks chỉ hiện lại board (kanban), không có view riêng.
- Không trang nào set `data-active="tasks"` → mục Tasks **không bao giờ highlight**.
- Không tồn tại `tasks.html` / Tasks view nào.

Mục tiêu: "Tasks" là một **view danh sách (list/table) phẳng** các task (mọi state) — khác với board
kanban — bấm Tasks mở `tasks.html`, highlight đúng, click một dòng mở chi tiết task. Dùng lại
`GET /api/tasks` hiện có (không đổi backend/MCP).

## Scope
- In scope:
  - `design-system/shell.js`: đổi `nav('tasks', 'index.html', …)` → `nav('tasks', 'tasks.html', …)`.
  - Tạo `design-system/tasks.html`: cùng app-shell (mount `<aside id="rail">`), `data-active="tasks"`,
    nạp `theme.js`/`theme.css`/`shell.js`/`api.js`. Nội dung: **danh sách phẳng** các task (mọi project
    của board hiện tại) dạng list/table — cột: key, title, state (badge), updated; **lọc theo state**;
    click một dòng → mở chi tiết task (deep-link `index.html#task=<KEY>` mở drawer, hoặc drawer dùng lại).
    Có loading / empty / error như board.
  - Script render (inline hoặc `design-system/tasks.js`): gọi `api.listTasks` cho project hiện tại, render
    rows, xử lý filter + click.
  - Giữ a11y AA + reduced-motion; cùng style hệ thống.
  - **Output UI bắt buộc**: `tests/ui/tasks-view.spec.ts` (Playwright) — từ board bấm menu "Tasks" →
    điều hướng `tasks.html`, assert list render + mục Tasks **active** + click dòng mở detail; ảnh flow
    step-by-step + ảnh **menu** (rail có Tasks active) + ảnh **list view** vào `docs/ui/TASK-023/`.
  - **Document feature**: `docs/ui/tasks-view.md` mô tả view Tasks (khác board), filter, điều hướng.
- Out of scope:
  - Thêm cột API/MCP mới (dùng lại `GET /api/tasks`); sort/column nâng cao, bulk action.
  - Đổi board kanban; đổi font/theme/dropdown project (TASK-016/018/022).
  - Tạo/sửa task (TASK-019/021).

## Acceptance Criteria

### Machine-verifiable (chấm bởi TASK-023.ac.sh + gate; build/test hard-required)
- [ ] AC1: project builds (`build.exit == 0`) — `pnpm build`.
- [ ] AC2: tests pass (`test.exit == 0`) — `pnpm test` (vitest).
- [ ] AC3: rail trỏ đúng — `shell.js` có `nav('tasks', 'tasks.html'` (không còn `nav('tasks', 'index.html'`).
- [ ] AC4: trang tồn tại — `design-system/tasks.html` tồn tại, có `data-active="tasks"`, có
      `<aside id="rail">` và nạp `api.js`.
- [ ] AC5: list view thật — `tasks.html` (hoặc `tasks.js`) gọi `listTasks` và render danh sách + có lọc
      theo state + click dòng mở chi tiết (`#task=` hoặc openDrawer).
- [ ] AC6: Playwright spec — `tests/ui/tasks-view.spec.ts` tồn tại, assert điều hướng tới `tasks.html` và
      mục Tasks active / list hiển thị.
- [ ] AC7: screenshots — `docs/ui/TASK-023/` ≥ 2 ảnh `.png` gồm tên chứa `menu` và `list`.
- [ ] AC8: document — `docs/ui/tasks-view.md` tồn tại.

### Human / semantic (Judge + Human)
- [ ] AC9: bấm "Tasks" mở list view khác board, mục Tasks highlight đúng (ảnh chứng minh); click dòng mở
      đúng chi tiết task.
- [ ] AC10: list phản ánh đúng dữ liệu (mọi state, filter chạy), loading/empty/error cover; spec assert
      thật (không tautology/skip).
- [ ] AC11: a11y AA (nav keyboard/aria, bảng/list có cấu trúc đọc được), reduced-motion không vỡ; không
      regress board.

## Definition of Done
Mọi machine-verifiable AC pass dưới evidence mới sinh, Judge `VERDICT: PASS`, và human
`.ai/scripts/gate.sh approve TASK-023`.

## Dependencies
TASK-009 (API/UI + `listTasks`). Chạm `shell.js` → rebase nếu trùng TASK-020 (gỡ switcher) / TASK-022
(dropdown + routing project: tasks.html nên theo cùng cơ chế project nếu TASK-022 đã merge).

## References
- design-system/shell.js:42 (nav Tasks trỏ index.html — sửa) · :11-16 (helper nav + active)
- design-system/index.html (board kanban + drawer detail để dùng lại) · api.js:60 (`listTasks`)
- design-system/projects.html / tokens.html (mẫu trang phụ cùng shell)
- UI_DESIGN_BRIEF.md (S1 Board / list) · TASK_HUB_DESIGN.md §9 (web UI)
