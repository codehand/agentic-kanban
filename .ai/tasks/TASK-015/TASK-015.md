# TASK-015: P3 gate: prevent state-write bypass and cover SELF_CHECK transitions

Repos: .
Branch: fix/TASK-015-p3-gate-state-bypass

## Purpose
Hai lỗ hổng trong P3 (TASK-005):
1. **Bypass gate:** `server/src/db/repositories/task.ts` export public `updateTaskState()` cho phép ghi thẳng `task.state` mà KHÔNG qua gate — trái nguyên tắc lõi "gate là entity duy nhất ghi state" (TASK_HUB_DESIGN.md §1.1). Hiện chưa bị khai thác vì P5 chưa có, nhưng MCP tools tương lai có thể gọi và vô hiệu hoá toàn bộ enforcement.
2. **Lỗ hổng test:** không có happy-path test cho `IMPLEMENTED → SELF_CHECK_PASSED` và `IMPLEMENTED → SELF_CHECK_FAILED` (role `self-check`), và checksum guard chưa được test trên nhánh SELF_CHECK.

## Scope
- In scope:
  - Đóng đường ghi state ngoài gate: bỏ export `updateTaskState` (hoặc chuyển thành hàm nội bộ chỉ gate gọi), sao cho con đường DUY NHẤT ghi `task.state` là qua `gate.propose()`.
  - Thêm test happy-path: `IMPLEMENTED → SELF_CHECK_PASSED` và `IMPLEMENTED → SELF_CHECK_FAILED` bởi role `self-check`.
  - Thêm test: checksum guard reject khi evidence thiếu/sai checksum trên nhánh SELF_CHECK.
- Out of scope: thay đổi transition table; các phase khác; refactor không liên quan.

## Acceptance Criteria

### Machine-verifiable (chấm bởi TASK-015.ac.sh + gate; build/test/ac hard-required)
- [ ] AC1: project builds (build.exit == 0).
- [ ] AC2: tests pass (test.exit == 0) — bao gồm test SELF_CHECK mới.
- [ ] AC3: `updateTaskState` không còn được export khỏi `task.ts`, VÀ `gate.test.ts` có test cho cả `SELF_CHECK_PASSED` và `SELF_CHECK_FAILED` (chấm bởi TASK-015.ac.sh).

### Human / semantic (Judge + Human)
- [ ] AC4: Con đường ghi `task.state` duy nhất là qua gate — không còn API public nào ghi state bỏ qua transition/role/guard.
- [ ] AC5: Test SELF_CHECK là thật (đúng role, có/không evidence, checksum đúng/sai), không tautology/skip.

## Definition of Done
Mọi machine-verifiable AC pass dưới evidence mới sinh, Judge `VERDICT: PASS`, và human `.ai/scripts/gate.sh approve TASK-015`.

## Dependencies
TASK-005 (P3 state machine & gate — sửa trên nền code này)

## References
- .ai/WORKFLOW_DESIGN.md
