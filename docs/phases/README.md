# docs/phases/ — Spec chi tiết 10 phase (P0 → P9)

Drill-down từng phase của [`../IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md) §5 thành spec chi tiết
để sinh task triển khai chạy qua workflow gate với AC machine-verifiable. Nguồn sự thật chức năng:
[`../../TASK_HUB_DESIGN.md`](../../TASK_HUB_DESIGN.md).

Mỗi file `P<n>.md` có 7 section thống nhất: **Mục tiêu · Phạm vi · Module & file · Task checklist ·
Acceptance criteria · Ánh xạ design · Phụ thuộc & rủi ro**.

| Phase | Spec | Mục tiêu (tóm tắt) | Phụ thuộc |
|-------|------|--------------------|-----------|
| P0 | [P0.md](./P0.md) | Scaffold & toolchain + adapt engine `.ai/` cho Node | — |
| P1 | [P1.md](./P1.md) | Data layer (SQLite 7 bảng + repositories, append-only) | P0 |
| P2 | [P2.md](./P2.md) | Auth & roles (token theo role, chống self-certify) | P1 |
| P3 | [P3.md](./P3.md) | State machine & Gate (lõi cưỡng chế) | P1, P2 |
| P4 | [P4.md](./P4.md) | Evidence subsystem (runner-only, immutable, checksum) | P1, P2, P3 |
| P5 | [P5.md](./P5.md) | MCP server (tool surface, Streamable HTTP) | P2–P4 |
| P6 | [P6.md](./P6.md) | Concurrency: claim / lease / heartbeat | P5 |
| P7 | [P7.md](./P7.md) | JSON read API + Web UI wiring + SSE | P5 (+ prototype UI) |
| P8 | [P8.md](./P8.md) | Tích hợp engine `.ai/` (thin client) | P5, P6 |
| P9 | [P9.md](./P9.md) | Hardening, docs, deploy (v1 polish) | P7 (, P8) |

## Sequencing

```
P0 ─▶ P1 ─▶ P2 ─▶ P3 ─▶ P4 ─▶ P5 ─┬─▶ P6 ──┐
                                   └─▶ P7 ──┼─▶ P8 ─▶ P9
                                            │
   (UI prototype đã xong, P7 chủ yếu wiring)┘
```

- **Critical path tin cậy:** P1→P2→P3→P4 (data → auth → gate → evidence) — lõi chống gian lận, test nặng nhất.
- **Standalone trước** (P0–P7), tích hợp `.ai/` (P8) sau (`IMPLEMENTATION_PLAN.md` §1, §4.1).
- **Gate (P3) là trụ test nặng nhất**: mọi luật transition phải có test cả nhánh hợp lệ lẫn bị từ chối.

Ràng buộc xuyên suốt (đã chốt): `node:http` tối giản, **pnpm**, wiring UI **tại chỗ** trong
`design-system/`, một-process; giới hạn v1: **không** TLS/RBAC đa-human, **không** auto-merge MR
(`IMPLEMENTATION_PLAN.md` §9–§10, `TASK_HUB_DESIGN.md` §13).
