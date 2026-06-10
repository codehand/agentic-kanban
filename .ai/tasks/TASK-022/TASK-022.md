# TASK-022: Project switcher: working dropdown + per-project URL routing + empty-state create guide

Repos: .
Branch: fix/TASK-022-project-switcher

## Purpose
Dropdown chọn project không hoạt động — luôn hiển thị `opf-hub`. Nguyên nhân gốc (đã xác minh):
1. Nút project ở rail (`design-system/shell.js:31-38`) **tĩnh**: chỉ render `${project}` lấy từ
   `data-project="opf-hub"` hardcode trong `<body>` mọi trang; **không menu, không fetch, không onClick**.
2. Board (`index.html` loadBoard) **gộp task của TẤT CẢ project**, không lọc theo project chọn.
3. Không có routing theo project: `static.ts` serve file trực tiếp → `/opf-hub/index.html` 404 (fall-through).
4. Chưa có project thì không guide tạo: `project.create` chỉ có ở **MCP** (`read.ts:72`), HTTP chỉ
   `GET /api/projects`; nút "Create first project" ở `first-run.html` chưa wire.

Mục tiêu: dropdown chọn project chạy thật (đổi project → đổi board), URL đi theo project
(`/<project-id>/index.html`), và khi chưa có project thì ưu tiên guide người dùng tạo project rồi mới load.

## Scope
- In scope:
  - **Routing path-based** (`server/src/http/static.ts`): rewrite `'/<project-id>/<file>'` → serve
    `design-system/<file>` (strip segment đầu khi không phải file thật). Trang đọc project từ path.
  - **Asset tuyệt đối**: đổi link `theme.css`/`theme.js`/`shell.js`/`api.js`/icon trong các `*.html` sang
    đường dẫn tuyệt đối (`/theme.css`…) để URL có prefix project không làm lệch asset.
  - **Dropdown thật** (`shell.js`): nút project là menu — `api.listProjects()` để render danh sách; project
    hiện tại đọc từ **URL path** qua helper **`projectFromPath()`** (không từ data-project hardcode); chọn
    project → điều hướng `/<project-id>/index.html`. Đánh dấu project đang chọn.
  - **Lọc board theo project** (`index.html`): chỉ load task của project trong URL (không gộp tất cả).
  - **Empty-state guide**: khi `GET /api/projects` trả rỗng → điều hướng/hiển thị `first-run.html`.
  - **Tạo project qua UI**: thêm HTTP **`POST /api/projects`** (human) qua handler **`handleCreateProject`**
    (tái dùng `insertProject` như MCP `project.create`); `api.js` thêm `createProject`; wire
    `first-run.html` "Create first project" → `createProject` → redirect `/<id>/index.html`.
  - **Output UI bắt buộc**: `tests/ui/project-switcher.spec.ts` (Playwright) — mở dropdown, chọn project
    khác → assert URL đổi + board đổi; case rỗng → first-run. Ảnh flow step-by-step + ảnh dropdown/menu
    + ảnh empty/first-run vào `docs/ui/TASK-022/`.
  - **Output core feature/MCP bắt buộc**:
    - `docs/projects/project-switcher.md`: tài liệu routing path-based, dropdown, empty-state, create API.
    - `scripts/test-projects.mjs`: **API test script** — list (rỗng) → create → list (có) → đảm bảo routing.
    - `docs/projects/project-switcher-scenario.md`: **kịch bản test API** + **kịch bản test với agent**.
    - `examples/projects/`: **source example from scratch** (MCP client gọi `project.create` + list).
    - **Spawn sub-agent** kết nối MCP chạy kịch bản tạo/list project → transcript
      `docs/projects/TASK-022/agent-transcript.md`.
- Out of scope:
  - Sửa/xoá/rename project; per-project token scoping (đã có ở token layer).
  - Đổi state machine; filter task nâng cao.
  - Đổi font/theme (TASK-016/018).

## Acceptance Criteria

### Machine-verifiable (chấm bởi TASK-022.ac.sh + gate; build/test hard-required)
- [ ] AC1: project builds (`build.exit == 0`) — `pnpm build`.
- [ ] AC2: tests pass (`test.exit == 0`) — `pnpm test` (vitest, gồm test routing + create).
- [ ] AC3: routing path-based — `server/src/http/static.ts` xử lý URL có prefix project; có test
      `server/src/http/static.test.ts` assert `'/<project>/index.html'` trả nội dung `index.html`.
- [ ] AC4: HTTP create project — `routes.ts` có `handleCreateProject` (định nghĩa + gọi) cho
      `POST /api/projects`.
- [ ] AC5: dropdown thật — `shell.js` gọi `listProjects` và có helper `projectFromPath()` đọc project từ
      URL path (không chỉ `data-project`); chọn project điều hướng `/<project-id>/`.
- [ ] AC6: client — `design-system/api.js` có `createProject` (POST `/projects`).
- [ ] AC7: empty-state — `index.html` điều hướng/hiển thị `first-run` khi 0 project; `first-run.html` gọi
      `createProject`.
- [ ] AC8: asset tuyệt đối — `index.html` nạp `theme.css` & `shell.js` bằng đường dẫn tuyệt đối (`/`).
- [ ] AC9: vitest cover — test `POST /api/projects` tạo project **và** 401 thiếu token; test routing
      (AC3) assert thật.
- [ ] AC10: artifacts core — `docs/projects/project-switcher.md`, `docs/projects/project-switcher-scenario.md`,
      `scripts/test-projects.mjs`, `examples/projects/` (không rỗng),
      `docs/projects/TASK-022/agent-transcript.md`.
- [ ] AC11: output UI — `tests/ui/project-switcher.spec.ts` (assert URL/board đổi) + `docs/ui/TASK-022/`
      ≥ 3 ảnh `.png` gồm tên chứa `dropdown` và `switch`.

### Human / semantic (Judge + Human)
- [ ] AC12: chọn project khác → URL `/<project-id>/index.html` đổi và board hiển thị đúng task project đó
      (ảnh + transcript chứng minh); không còn cứng `opf-hub`.
- [ ] AC13: 0 project → guide first-run; tạo project qua UI → redirect vào `/<id>/index.html` và board
      trống đúng; error path 401/400 cho create cover thật (không tautology/skip).
- [ ] AC14: routing không phá deep-link/asset (CSS/JS/icon vẫn nạp), a11y AA cho dropdown (keyboard,
      aria), reduced-motion không vỡ.

## Definition of Done
Mọi machine-verifiable AC pass dưới evidence mới sinh, Judge `VERDICT: PASS`, và human
`.ai/scripts/gate.sh approve TASK-022`.

## Dependencies
TASK-009 (API/UI). Liên quan TASK-019 (POST create pattern — handler tương tự) & TASK-021 (form project
select). Chạm `static.ts`/`routes.ts`/`shell.js`/`index.html`/`first-run.html`/`api.js` — rebase nếu trùng.

## References
- design-system/shell.js:31-38 (nút project tĩnh) · index.html loadBoard (gộp mọi project) ·
  first-run.html:33 (CTA chưa wire) · signin.html:78-83 (deep-link hash hiện có)
- server/src/http/static.ts (serve trực tiếp — cần rewrite) · server/src/api/routes.ts:372 (GET /api/projects)
- server/src/mcp/tools/read.ts:72 (project.create MCP — tái dùng insertProject)
- TASK_HUB_DESIGN.md §9 (web UI) · UI_DESIGN_BRIEF.md (S3 Projects, S8 first-run)
