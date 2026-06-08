# docs/

Tài liệu của **Agentic Kanban (Task Hub)**.

| Tài liệu | Mô tả |
|----------|-------|
| [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) | Kế hoạch triển khai theo phase (P0 → P9), kiến trúc, quyết định công nghệ, AC từng phase. |
| [phases/](./phases/) | Spec chi tiết từng phase (`P0.md … P9.md`) — drill-down của `IMPLEMENTATION_PLAN.md` §5, bám sát `TASK_HUB_DESIGN.md`. |

## Tài liệu nguồn (nằm ngoài `docs/`, là nguồn sự thật)

| Tài liệu | Vai trò |
|----------|---------|
| [`../TASK_HUB_DESIGN.md`](../TASK_HUB_DESIGN.md) | **Nguồn sự thật về chức năng** server: data model, state machine, MCP tools, auth/roles. |
| [`../UI_DESIGN_BRIEF.md`](../UI_DESIGN_BRIEF.md) | Brief UI/UX cho web mission-control (8 màn). |
| [`../.ai/WORKFLOW_DESIGN.md`](../.ai/WORKFLOW_DESIGN.md) | Workflow no-self-certification gốc (bản local) mà Task Hub centralize hoá. |
| [`../design-system/`](../design-system/) | Prototype UI đã build (8 màn, HTML/Tailwind) — đầu vào cho phase wiring UI. |
