# TASK-012: Translate docs/README.md to English

Repos: .
Branch: fix/TASK-012-translate-readme-english

## Purpose
`docs/README.md` hiện viết bằng tiếng Việt. Dịch sang tiếng Anh để tài liệu dự án dễ tiếp cận với người đọc/cộng tác viên quốc tế.

## Scope
- In scope: Dịch toàn bộ nội dung `docs/README.md` từ tiếng Việt sang tiếng Anh, **thay thế tại chỗ** (English ghi đè Việt trong cùng file). Giữ nguyên cấu trúc markdown: heading, list, bảng, code block, link, đường dẫn file.
- Out of scope: `docs/phases/README.md`; `.ai/README.md` (đã gitignore); mọi thay đổi code/cấu hình; thêm file ngôn ngữ song song.

## Acceptance Criteria

### Machine-verifiable (chấm bởi TASK-012.ac.sh + gate; build/test/ac hard-required, 'na' nếu repo chưa có project)
- [ ] AC1: project builds (build.exit == 0) — lệnh từ .ai/config.yml (mặc định `pnpm build`).
- [ ] AC2: tests pass (test.exit == 0) — mặc định `pnpm test` (vitest).
- [ ] AC3: `docs/README.md` tồn tại và không rỗng (chấm bởi TASK-012.ac.sh).

### Human / semantic (Judge + Human)
- [ ] AC4: Bản dịch trung thực, đầy đủ — **không còn văn bản tiếng Việt** (kể cả từ tiếng Việt không dấu); thuật ngữ kỹ thuật dịch nhất quán.
- [ ] AC5: Cấu trúc markdown được giữ nguyên — heading/list/bảng/link/code block không bị mất, thêm, hay sai nghĩa; nội dung không bị lược bỏ.

## Definition of Done
Mọi machine-verifiable AC pass dưới evidence mới sinh, Judge `VERDICT: PASS`, và human `.ai/scripts/gate.sh approve TASK-012`.

## Dependencies
none

## References
- .ai/WORKFLOW_DESIGN.md
