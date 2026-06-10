# TASK-016: Tăng font size UI tổng thể (floor 13px) + chuẩn output UI task

Repos: .
Branch: fix/TASK-016-increase-ui-font-size

## Purpose
UI hiện tại chữ quá nhỏ → mỏi mắt: trong `design-system/*.html` đang dùng dày đặc `text-[9px]` …
`text-[12px]` (kể cả `text-[12.5px]`) cho nav, label, meta, kbd. Nâng font size tổng thể "1 xíu" để dễ
đọc mà vẫn giữ layout/đậm-nhạt phân cấp hiện có. Task này đồng thời chuẩn hoá **bộ output bắt buộc cho
mọi task UI**: script test Playwright, ảnh chụp flow step-by-step, ảnh chụp các phần nhìn thấy được
(CTA / MENU / FONT), và tài liệu trong `docs/`.

## Scope
- In scope:
  - Scale font theo hướng **floor + bump nhẹ** trên toàn bộ `design-system/*.html`
    (index, projects, new-task, first-run, signin, evidence, tokens) + `design-system/theme.css` nếu cần:
    - Mọi cỡ ≤ 12px (gồm 9/10/11/12/12.5px) → **sàn 13px**.
    - Các bậc còn lại bump **+1px** giữ tỉ lệ phân cấp: 13→14, 14→15, 15→16, 16→17, 17→18, 18→19.
    - Chỉnh đồng bộ các chỗ đặt cỡ chữ qua JS template (nếu `design-system/*.js` render class).
  - Thêm test runner Playwright: `@playwright/test` (devDependencies) + script `test:ui` trong
    `package.json` (KHÔNG gộp vào `pnpm test`/vitest — vitest chỉ include `server/**` nên AC2 vẫn xanh).
  - Spec `tests/ui/font-size.spec.ts`: mở UI (qua dev-server hoặc file://), **assert computed
    `font-size` ≥ 13px** cho text hiển thị, và **chụp ảnh step-by-step** lưu vào `docs/ui/TASK-016/`.
  - Ảnh chụp bắt buộc trong `docs/ui/TASK-016/`: flow chạy ra kết quả + cận cảnh **CTA**, **MENU**,
    **FONT (before/after)**.
  - Tài liệu `docs/ui/font-size.md`: mô tả thang font mới, quy ước floor 13px, cách chạy `test:ui`,
    nhúng ảnh flow step-by-step; thêm mục "Output bắt buộc cho task UI" làm chuẩn dùng lại.
- Out of scope:
  - Đổi font family, đổi color tokens, đổi spacing/layout ngoài hệ quả tự nhiên của cỡ chữ.
  - Redesign component, thêm màn mới, đổi nội dung copy.
  - Thay đổi logic server / API.

## Acceptance Criteria

### Machine-verifiable (chấm bởi TASK-016.ac.sh + gate; build/test hard-required)
- [ ] AC1: project builds (`build.exit == 0`) — `pnpm build` (tsc).
- [ ] AC2: tests pass (`test.exit == 0`) — `pnpm test` (vitest; KHÔNG bị Playwright spec làm fail).
- [ ] AC3: floor 13px đạt — KHÔNG còn cỡ chữ ≤ 12px trong `design-system/*.html`: grep không match
      `text-[<n>px]` với n ∈ {9,10,11,12,12.5} (regex `text-\[(9|10|11|12)(\.5)?px\]`).
- [ ] AC4: runner Playwright tồn tại — `@playwright/test` có trong `package.json`, có script `test:ui`,
      và `tests/ui/font-size.spec.ts` tồn tại + có assert `font-size` / `>= 13`.
- [ ] AC5: ảnh bắt buộc tồn tại trong `docs/ui/TASK-016/` — ≥ 4 file `.png`, gồm các file tên chứa
      `menu`, `cta`, `font`.
- [ ] AC6: tài liệu core tồn tại — `docs/ui/font-size.md` tồn tại và tham chiếu `docs/ui/TASK-016/`.

### Human / semantic (Judge + Human)
- [ ] AC7: spec Playwright là **assert thật** computed `font-size` (không tautology, không
      `test.skip`, không chụp ảnh suông rồi pass); ảnh được render từ chính spec đã chạy.
- [ ] AC8: ảnh flow phản ánh đúng UI sau thay đổi (chữ lớn hơn, dễ đọc), phân cấp đậm/nhạt &
      layout không vỡ; ảnh CTA/MENU/FONT before-after thể hiện rõ cải thiện.
- [ ] AC9: thay đổi cỡ chữ nhất quán toàn bộ các màn `design-system/*.html` (không sót màn);
      a11y AA + reduced-motion sẵn có không bị phá.

## Definition of Done
Mọi machine-verifiable AC pass dưới evidence mới sinh, Judge `VERDICT: PASS`, và human
`.ai/scripts/gate.sh approve TASK-016`.

## Dependencies
TASK-009 (prototype UI trong `design-system/` đã wiring) — base để bump font.

## References
- .ai/WORKFLOW_DESIGN.md
- UI_DESIGN_BRIEF.md (8 màn) · design-system/ (UI hiện tại)
- design-system/theme.css (font setup gốc)
