# TASK-001: Detail specs for each of the 9 implementation phases

Repos: .
Branch: fix/TASK-001-phase-detail-specs

## Purpose
`docs/IMPLEMENTATION_PLAN.md` đã định nghĩa 9 phase ở mức tổng quan (P0–P9). Trước khi bắt đầu code,
cần drill-down mỗi phase thành **spec chi tiết** để: (a) sau này sinh các task triển khai chạy qua
workflow gate với AC machine-verifiable rõ ràng, (b) đảm bảo logic mỗi phase **bám sát**
`TASK_HUB_DESIGN.md` (data model, state machine, MCP tools, auth/role) và brief UI. Đây là task **tài
liệu**, không implement code server.

## Scope
- In scope:
  - Tạo `docs/phases/` với **10 file**: `P0.md … P9.md`, mỗi file theo cấu trúc thống nhất (comprehensive).
  - Mỗi file đủ 7 section: `## Mục tiêu`, `## Phạm vi`, `## Module & file`, `## Task checklist`,
    `## Acceptance criteria`, `## Ánh xạ design`, `## Phụ thuộc & rủi ro`.
  - `## Ánh xạ design` trỏ rõ phần liên quan trong `TASK_HUB_DESIGN.md` (bảng/state/tool) và/hoặc
    `IMPLEMENTATION_PLAN.md` cho phase đó.
  - Tạo `docs/phases/README.md` (index) và cập nhật `docs/README.md` trỏ tới `phases/`.
- Out of scope:
  - KHÔNG implement code server (đó là nội dung các phase sau).
  - KHÔNG sửa `TASK_HUB_DESIGN.md` / `UI_DESIGN_BRIEF.md` / `.ai/WORKFLOW_DESIGN.md` (nguồn sự thật — chỉ tham chiếu).
  - KHÔNG rebuild UI; KHÔNG đổi quyết định tech stack đã chốt (`node:http`, pnpm, wiring UI tại chỗ).

## Acceptance Criteria

### Machine-verifiable (chấm bởi TASK-001.ac.sh + gate)
> Repo không có Go code → `run-evidence.sh` **skip** build/test (`build.exit`/`test.exit` = 0). Chấm chính qua `ac.sh`.
- [ ] AC1: `docs/phases/` tồn tại đủ 10 file `P0.md … P9.md`.
- [ ] AC2: mỗi file chứa đủ 7 section bắt buộc (đúng tiêu đề ở Scope).
- [ ] AC3: mỗi file tham chiếu nguồn design (`TASK_HUB_DESIGN` hoặc `IMPLEMENTATION_PLAN`) và **không** còn placeholder `<…>`.
- [ ] AC4: `docs/phases/README.md` (index) tồn tại.

### Human / semantic (Judge + Human)
- [ ] AC5: nội dung mỗi phase bám đúng logic design — data model / state machine / MCP tools / role / guard
  tham chiếu **khớp** `TASK_HUB_DESIGN.md`; không bịa requirement ngoài design.
- [ ] AC6: task breakdown & AC mỗi phase khả thi và nhất quán với `IMPLEMENTATION_PLAN.md` (thứ tự phụ
  thuộc P0→…→P9, standalone-first, Gate là trụ test nặng nhất).
- [ ] AC7: thuật ngữ/ràng buộc nhất quán (`node:http`, pnpm, wiring UI tại chỗ, single-process) và không
  mâu thuẫn giới hạn v1 (no TLS/RBAC đa-human, no auto-merge MR).

## Definition of Done
Mọi machine-verifiable AC pass dưới evidence mới sinh, Judge `VERDICT: PASS`, và human
`.ai/scripts/gate.sh approve TASK-001`.

## Dependencies
none — đã có `docs/IMPLEMENTATION_PLAN.md` + `TASK_HUB_DESIGN.md` làm nguồn.

## References
- docs/IMPLEMENTATION_PLAN.md (nguồn 9 phase + tech stack đã chốt)
- TASK_HUB_DESIGN.md (data model §4, state machine §5, MCP tools §6, auth/role §3)
- UI_DESIGN_BRIEF.md (8 màn) · design-system/ (prototype đã build)
- .ai/WORKFLOW_DESIGN.md
