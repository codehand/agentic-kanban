# TASK-008: P6: Concurrency - claim, lease, heartbeat

Repos: .
Branch: fix/TASK-008-p6-concurrency-lease

## Purpose
Nhiều agent đa-device không được phép cùng giành một task. Triển khai claim gắn assignee + lease, heartbeat
gia hạn lease, release/expiry mở lại task để token khác claim. Transition (non-human / không phải gate) đòi
caller đang giữ lease. Mục tiêu: hoàn thiện semantics lease an toàn dưới truy cập đồng thời.

## Scope
- In scope:
  - `task.claim(key)`: set `assignee_token_id` + `lease_until`, **chỉ khi** task chưa có lease hoặc lease đã
    hết hạn; dùng transaction SQLite để chống đua claim đồng thời.
  - `task.heartbeat(key)`: gia hạn `lease_until` (agent đang chạy gọi định kỳ).
  - `task.release(key)`: nhả lease sớm. Lease hết hạn → task tự mở claim lại.
  - Transition đòi caller **đang giữ lease** (trừ role `human` và transition `gate`).
  - TTL lease **15 phút**, heartbeat mỗi **5 phút**, cấu hình qua `config.yml`.
  - Module: `server/src/domain/lease.ts`; cập nhật guard trong `server/src/domain/gate.ts`; thêm cấu hình
    lease TTL + heartbeat interval vào `server/src/config/index.ts`.
- Out of scope:
  - Định nghĩa / mount lại tool surface (đã làm ở P5) — task này chỉ hoàn thiện semantics lease.
  - SSE lease-tick / UI hiển thị lease (thuộc P7).

## Acceptance Criteria

### Machine-verifiable (chấm bởi TASK-008.ac.sh + gate; build/test hard-required, 'na' nếu repo chưa có project)
- [ ] AC1: project builds (`build.exit == 0`) — `pnpm build` (hoặc 'na' khi chưa có package.json).
- [ ] AC2: tests pass (`test.exit == 0`) — `pnpm test` (vitest).
- [ ] AC3: tồn tại `server/src/domain/lease.ts` export claim/heartbeat/release.
- [ ] AC4: `server/src/config/index.ts` có cấu hình lease TTL + heartbeat interval, đọc từ `config.yml`.
- [ ] AC5: `server/src/domain/gate.ts` chứa guard "caller giữ lease" cho transition non-human/non-gate.
- [ ] AC6: có file test lease cover 4 trường hợp: claim free ok, claim khi đang lease reject, claim sau
      expiry ok, transition bởi token không giữ lease (non-human) reject.

### Human / semantic (Judge + Human)
- [ ] AC7: claim dùng transaction SQLite thật (atomic check-and-set), không phải check-then-write có race;
      test không tautology, không skip, không xóa assertion để qua.
- [ ] AC8: expiry/clock xử lý đúng (lease hết hạn mở claim lại; heartbeat gia hạn), error path (claim task
      đang bị lease bởi token khác) trả lỗi rõ. Bám sát `TASK_HUB_DESIGN.md` §11 và cột §4
      (`assignee_token_id`, `lease_until`).

## Definition of Done
Mọi machine-verifiable AC pass dưới evidence mới sinh, Judge `VERDICT: PASS`, và human
`.ai/scripts/gate.sh approve TASK-008`.

## Dependencies
TASK-007 (P5 — tool surface đã mount; service + repo layer sẵn sàng). Song song được với P7 (TASK-009).

## References
- docs/phases/P6.md (content source of truth)
- docs/IMPLEMENTATION_PLAN.md §5 (P6), §6 (song song P6/P7)
- TASK_HUB_DESIGN.md §11 (Concurrency: claim / lease / heartbeat, TTL 15m / heartbeat 5m, transition đòi lease)
- TASK_HUB_DESIGN.md §4 (Data model: cột `assignee_token_id`, `lease_until`)
