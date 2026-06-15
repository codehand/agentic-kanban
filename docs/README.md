# docs/

Documentation for **Agentic Kanban (Task Hub)**.

| Document | Description |
|----------|-------------|
| [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) | Implementation plan by phase (P0 → P9), architecture, technology decisions, AC for each phase. |
| [phases/](./phases/) | Detailed spec for each phase (`P0.md … P9.md`) — drill-down of `IMPLEMENTATION_PLAN.md` §5, following closely `TASK_HUB_DESIGN.md`. |

## Source documents (outside `docs/`, serve as source of truth)

| Document | Role |
|----------|------|
| [`./TASK_HUB_DESIGN.md`](./TASK_HUB_DESIGN.md) | **Source of truth for functionality** of the server: data model, state machine, MCP tools, auth/roles. |
| [`./UI_DESIGN_BRIEF.md`](./UI_DESIGN_BRIEF.md) | UI/UX brief for web mission-control (8 screens). |
| [`../.ai/WORKFLOW_DESIGN.md`](../.ai/WORKFLOW_DESIGN.md) | Original no-self-certification workflow (local version) centralized by Task Hub. |
| [`../design-system/`](../design-system/) | Built UI prototype (8 screens, HTML/Tailwind) — input for UI wiring phase. |
