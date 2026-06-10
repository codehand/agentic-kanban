# TASK-018: Fix CTA toggle theme light/dark: CSS-var token + wire + persist

Repos: .
Branch: fix/TASK-018-theme-toggle-light-dark

## Purpose
Bug: CTA "Toggle theme" không hoạt động. Nguyên nhân gốc (đã xác minh):
1. Nút toggle (`design-system/index.html:45`) **không có id, không click handler, không JS** — bấm không
   làm gì. Toggle chỉ xuất hiện ở `index.html`.
2. `theme.js` chỉ khai báo **một palette dark hardcode** (`bg:#0E0F13`, `text:#E6E8EC`…) dùng làm class
   nền (`bg-bg`, `text-text`) khắp 7 trang. **Không có palette light** → kể cả khi bỏ `.dark` cũng không
   đổi gì (Tailwind `darkMode:'class'` chỉ ảnh hưởng biến thể `dark:`, không có ở đây).
3. Cả 7 trang hardcode `<html class="dark">`, không đọc lựa chọn đã lưu; không persist; không theo OS.

Mục tiêu: light/dark **chạy thật** — bấm CTA đổi theme toàn bộ UI, nhớ lựa chọn, lần đầu theo OS, không
nhấp nháy (no flash) khi tải.

## Scope
- In scope:
  - **CSS variable tokens**: định nghĩa bộ giá trị **light** ở `:root` và **dark** ở `html.dark`
    (trong `design-system/theme.css`); đổi color token trong `theme.js` sang `var(--…)` (bg, panel,
    panel2, border, borderlt, text, muted, accent, st_*, ev_*). Toggle `.dark` ⇒ re-theme thật mọi trang.
  - `theme.css`: `html,body background` dùng `var(--bg)` thay `#0E0F13` cứng.
  - **Wire CTA**: thêm `id` cho nút toggle + handler trong `theme.js`: `html.classList.toggle('dark')`,
    đổi icon moon/sun, **persist `localStorage`** (key vd `ak-theme`).
  - **Apply-before-paint**: script nhỏ chạy sớm (đầu `<head>`, trước render) đặt class theo
    `localStorage ?? prefers-color-scheme ?? 'dark'` để tránh flash. Áp dụng trên **cả 7 trang**
    (đều load `theme.js`), không chỉ index.
  - **Output UI bắt buộc**: `tests/ui/theme-toggle.spec.ts` (Playwright) — bấm CTA, assert `html` đổi
    class `dark` và `background-color` máy-tính đổi giữa 2 giá trị khác nhau, và **persist qua reload**;
    ảnh flow step-by-step + **ảnh CTA** vào `docs/ui/TASK-018/` (light + dark + cận cảnh CTA).
  - **Document core feature**: `docs/ui/theme.md` mô tả token CSS-var, cách thêm màu, persist + OS, no-flash.
- Out of scope:
  - Redesign màu cho đẹp hơn (chỉ cần một light palette dùng được, tương phản AA).
  - Đổi font/layout/spacing (TASK-016 lo font).
  - Thêm theme thứ 3 / theme picker tuỳ biến.

## Acceptance Criteria

### Machine-verifiable (chấm bởi TASK-018.ac.sh + gate; build/test hard-required)
- [ ] AC1: project builds (`build.exit == 0`) — `pnpm build`.
- [ ] AC2: tests pass (`test.exit == 0`) — `pnpm test` (vitest).
- [ ] AC3: CTA được wire — nút toggle trong `design-system/index.html` có `id` và `theme.js` có handler
      `classList` đổi `dark` + `localStorage`.
- [ ] AC4: hai palette qua CSS var — `design-system/theme.css` định nghĩa biến ở `:root` **và** ở
      `html.dark`/`.dark` (vd `--bg`), và `theme.js` color token dùng `var(--`.
- [ ] AC5: không còn nền dark hardcode trong theme.css — `html,body` không còn `#0E0F13` cứng (dùng
      `var(--bg)`).
- [ ] AC6: apply-before-paint + theo OS — có tham chiếu `prefers-color-scheme` và đọc `localStorage`
      trong `theme.js` (hoặc script inline ở head) để set theme lúc tải.
- [ ] AC7: Playwright spec tồn tại — `tests/ui/theme-toggle.spec.ts` có assert đổi class/`background-color`
      và kiểm tra persist (reload/`localStorage`).
- [ ] AC8: screenshots — `docs/ui/TASK-018/` ≥ 3 ảnh `.png` gồm tên chứa `light`, `dark`, `cta`.
- [ ] AC9: document core — `docs/ui/theme.md` tồn tại.

### Human / semantic (Judge + Human)
- [ ] AC10: bấm CTA đổi theme **thấy được** trên ảnh (light vs dark khác biệt rõ), persist sau reload,
      lần đầu theo OS; không nhấp nháy khi tải.
- [ ] AC11: light theme đạt tương phản a11y AA (text/nền/heading đọc được), áp dụng nhất quán cả 7 trang;
      reduced-motion không bị phá.
- [ ] AC12: spec là assert thật (không tautology, không `skip`, không xoá assertion); icon moon/sun phản
      ánh đúng trạng thái.

## Definition of Done
Mọi machine-verifiable AC pass dưới evidence mới sinh, Judge `VERDICT: PASS`, và human
`.ai/scripts/gate.sh approve TASK-018`.

## Dependencies
TASK-009 (UI prototype). Độc lập TASK-016 (font) & TASK-017 (live update) — nên rebase nếu trùng theme.css/theme.js.

## References
- design-system/theme.js (tailwind config — palette dark-only hardcode)
- design-system/theme.css (html,body background #0E0F13 cứng)
- design-system/index.html:45 (CTA Toggle theme — chưa wire) · các *.html khác `<html class="dark">`
- UI_DESIGN_BRIEF.md
