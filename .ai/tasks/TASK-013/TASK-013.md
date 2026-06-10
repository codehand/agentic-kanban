# TASK-013: Remove misplaced TASK-006.ac.sh from project root

Repos: .
Branch: fix/TASK-013-remove-stray-task006-ac

## Purpose
File `TASK-006.ac.sh` đang nằm ở **thư mục gốc của project** và bị git track. Đây là bản sao lạc chỗ của AC script TASK-006 (đúng vị trí phải là `.ai/tasks/TASK-006/TASK-006.ac.sh`). File không thuộc về code sản phẩm và cần được gỡ khỏi root.

## Scope
- In scope: Xoá `TASK-006.ac.sh` ở root project (gỡ khỏi git: `git rm`).
- Out of scope: Bản chính `.ai/tasks/TASK-006/TASK-006.ac.sh` (giữ nguyên); mọi file/AC script khác; thay đổi code khác.

## Acceptance Criteria

### Machine-verifiable (chấm bởi TASK-013.ac.sh + gate; build/test/ac hard-required, 'na' nếu repo chưa có project)
- [ ] AC1: project builds (build.exit == 0) — lệnh từ .ai/config.yml (mặc định `pnpm build`).
- [ ] AC2: tests pass (test.exit == 0) — mặc định `pnpm test` (vitest).
- [ ] AC3: `TASK-006.ac.sh` không còn ở root **và** không còn được git track (chấm bởi TASK-013.ac.sh).

### Human / semantic (Judge + Human)
- [ ] AC4: Chỉ xoá đúng file lạc chỗ ở root; không động đến bản chính trong `.ai/tasks/TASK-006/` hay bất kỳ file nào khác.

## Definition of Done
Mọi machine-verifiable AC pass dưới evidence mới sinh, Judge `VERDICT: PASS`, và human `.ai/scripts/gate.sh approve TASK-013`.

## Dependencies
none

## References
- .ai/WORKFLOW_DESIGN.md
