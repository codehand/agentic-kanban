# TASK-020: Remove prototype 'Screens' screen-switcher (floating bottom-right)

Repos: .
Branch: fix/TASK-020-remove-screens-switcher

## Purpose
Nút "Screens" nổi ở góc dưới-phải màn hình là **prototype screen-switcher** do `design-system/shell.js`
(dòng 71–100) tự inject vào mọi trang (đều load `shell.js`). Đây là tiện ích điều hướng thời prototype,
không thuộc sản phẩm thật → cần gỡ bỏ. Giữ nguyên left rail (cũng do `shell.js` inject).

## Scope
- In scope:
  - Gỡ toàn bộ khối screen-switcher trong `design-system/shell.js`: mảng `screens`, phần tử `sw`
    (`#sw-btn` + `#sw-panel`), `body.appendChild(sw)` và 2 listener click liên quan. Dọn biến trở thành
    orphan do chính việc gỡ này (vd `screens`, `here`, `sw`, `panel`).
  - Giữ nguyên việc inject left rail và mọi hành vi khác của `shell.js`.
- Out of scope:
  - Thay đổi left rail / nav / theme / font.
  - Thêm cơ chế điều hướng thay thế.

## Acceptance Criteria

### Machine-verifiable (chấm bởi TASK-020.ac.sh + gate; build/test hard-required)
- [ ] AC1: project builds (`build.exit == 0`) — `pnpm build`.
- [ ] AC2: tests pass (`test.exit == 0`) — `pnpm test` (vitest).
- [ ] AC3: đã gỡ switcher khỏi `design-system/shell.js` — KHÔNG còn `sw-btn`, `sw-panel`,
      `Prototype screens`, và chuỗi nút `Screens` của switcher.
- [ ] AC4: left rail còn nguyên — `shell.js` vẫn còn `getElementById('rail')` (không xoá nhầm).
- [ ] AC5: Playwright spec `tests/ui/remove-screens.spec.ts` tồn tại và assert **không** còn `#sw-btn`
      / nút "Screens" trên trang.
- [ ] AC6: screenshots — `docs/ui/TASK-020/` ≥ 2 ảnh `.png` gồm tên chứa `before` và `after`
      (góc dưới-phải trước/sau khi gỡ).

### Human / semantic (Judge + Human)
- [ ] AC7: nút "Screens" biến mất trên tất cả các trang (ảnh after chứng minh), không còn panel switcher;
      không phát sinh lỗi console do biến orphan.
- [ ] AC8: spec là assert thật (không tautology/`skip`); không xoá nhầm rail/nav; layout còn lại không vỡ.

## Definition of Done
Mọi machine-verifiable AC pass dưới evidence mới sinh, Judge `VERDICT: PASS`, và human
`.ai/scripts/gate.sh approve TASK-020`.

## Dependencies
none (độc lập). Chạm `design-system/shell.js` — rebase nếu task khác cũng sửa file này.

## References
- design-system/shell.js:71-100 (khối screen-switcher cần gỡ) · :18-69 (left rail giữ lại)
