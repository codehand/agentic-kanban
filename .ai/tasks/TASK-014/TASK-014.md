# TASK-014: Fix P4 evidence checksum tamper-detection

Repos: .
Branch: fix/TASK-014-p4-evidence-checksum-tamper

## Purpose
Cơ chế chống‑giả‑mạo evidence của P4 (TASK-006) hiện **không hoạt động**: `server/src/domain/evidence.ts` tính checksum **từ chính `manifest_json`** rồi verify lại chính nó (`verifyManifestChecksum(m, validateAndChecksumManifest(m))`) → luôn pass, không phát hiện được manifest bị sửa. Lúc `submit` checksum được tính nhưng **vứt đi**; schema **không có cột** lưu checksum tham chiếu. Điều này vô hiệu hoá lời hứa lõi "evidence = sự thật máy đo, bất biến" (TASK_HUB_DESIGN.md §7).

## Scope
- In scope:
  - Lưu checksum tham chiếu **tại thời điểm submit**: thêm cột (vd `manifest_checksum`) vào bảng `evidence` qua migration mới; `insertEvidence` ghi checksum tính từ manifest lúc ghi.
  - `task.selfcheck` và guard của gate verify bằng cách so **checksum đã lưu trong DB** với checksum tính lại từ manifest hiện tại; lệch → reject.
  - Thêm test mô phỏng **sửa `manifest_json` đã lưu trong DB** rồi gọi selfcheck/verify → phải REJECT.
- Out of scope: thay đổi thuật toán scoring; các phase khác; đổi format manifest.

## Acceptance Criteria

### Machine-verifiable (chấm bởi TASK-014.ac.sh + gate; build/test/ac hard-required)
- [ ] AC1: project builds (build.exit == 0).
- [ ] AC2: tests pass (test.exit == 0) — bao gồm test tamper mới.
- [ ] AC3: schema `evidence` có cột lưu checksum tham chiếu (migration), và `evidence.test.ts` có test sửa manifest đã lưu → selfcheck/verify reject (chấm bởi TASK-014.ac.sh).

### Human / semantic (Judge + Human)
- [ ] AC4: Verify so checksum **đã lưu** vs manifest hiện tại — KHÔNG còn tautology (không tính lại checksum từ chính manifest để so với chính nó).
- [ ] AC5: Test tamper là thật (thực sự mutate manifest_json trong DB và assert reject), không skip, không assertion giả.

## Definition of Done
Mọi machine-verifiable AC pass dưới evidence mới sinh, Judge `VERDICT: PASS`, và human `.ai/scripts/gate.sh approve TASK-014`.

## Dependencies
TASK-006 (P4 evidence subsystem — sửa trên nền code này)

## References
- .ai/WORKFLOW_DESIGN.md
