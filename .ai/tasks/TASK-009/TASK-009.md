# TASK-009: P7: JSON read API + Web UI wiring + SSE

Repos: .
Branch: fix/TASK-009-p7-api-ui-wiring

## Purpose
Biến prototype `design-system/` thành app thật với dữ liệu sống: read JSON API + SSE + write-action cho
human, thay mock data bằng fetch. Một human operator review/approve qua UI. Giữ a11y AA + reduced-motion
sẵn có của prototype khi wiring data sống.

## Scope
- In scope:
  - Read endpoints (trên `node:http`): `GET /api/projects`, `/api/tasks?project&state`, `/api/tasks/:key`
    (spec + gitref + evidence summary + timeline), `/api/evidence/:key`, `/api/tokens`.
  - Write cho human (bearer role human): approve / reset / remove.
  - SSE `/api/stream` đẩy update (transition, lease tick); poll là fallback.
  - Token gate (màn S5 sign-in): nhận token, lưu trên device; deep-link `/p/<project>`, `/t/<KEY>`.
  - Wiring UI **tại chỗ** trong `design-system/` (HTML+JS): thay mock data bằng fetch + SSE; dùng lại
    loading/empty/error đã có trong prototype.
  - Module: `server/src/api/routes.ts`, `server/src/api/stream.ts`, `server/src/http/static.ts`,
    và `design-system/*.js`.
- Out of scope:
  - drag-to-change-state, agent chat/console, full diff viewer, auto-merge MR.

## Acceptance Criteria

### Machine-verifiable (chấm bởi TASK-009.ac.sh + gate; build/test hard-required, 'na' nếu repo chưa có project)
- [ ] AC1: project builds (`build.exit == 0`) — `pnpm build` (hoặc 'na' khi chưa có package.json).
- [ ] AC2: tests pass (`test.exit == 0`) — `pnpm test` (vitest).
- [ ] AC3: tồn tại `server/src/api/routes.ts` (read endpoints + write human actions) và
      `server/src/api/stream.ts` (SSE `/api/stream`) và `server/src/http/static.ts` (serve `design-system/`).
- [ ] AC4: `design-system/` có JS wiring fetch tới `/api/` (mock data đã thay bằng fetch).
- [ ] AC5: có test smoke endpoints + test approve persist `JUDGE_PASSED→DONE` + test SSE phát event +
      test endpoint thiếu token trả 401.

### Human / semantic (Judge + Human)
- [ ] AC6: approve human-only thật sự (bearer human) đẩy state về DONE và persist (reload thấy ở cột Done);
      không auto-merge MR; test không tautology / không skip / không xóa assertion.
- [ ] AC7: wiring giữ a11y AA + reduced-motion từ prototype; error path (thiếu/invalid token → 401) cover.
      Bám sát `TASK_HUB_DESIGN.md` §9 (human review + web UI), §8 (timeline), §6 (`task.approve`) và
      `UI_DESIGN_BRIEF.md`.

## Definition of Done
Mọi machine-verifiable AC pass dưới evidence mới sinh, Judge `VERDICT: PASS`, và human
`.ai/scripts/gate.sh approve TASK-009`.

## Dependencies
TASK-007 (P5 — API/service layer); prototype UI trong `design-system/` đã có. Song song được với P6 (TASK-008).

## References
- docs/phases/P7.md (content source of truth)
- docs/IMPLEMENTATION_PLAN.md §5 (P7), §9 (wiring UI tại chỗ), §3 (SSE + node:http)
- TASK_HUB_DESIGN.md §9 (Human review flow + Web UI), §8 (Comment & Verdict / timeline), §6 (`task.approve` human-only → DONE), §5 (state machine)
- UI_DESIGN_BRIEF.md (8 màn) · design-system/ (prototype UI đang được wiring)
