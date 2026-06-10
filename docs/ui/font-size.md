# Font Size System — TASK-016

> Quy ước thang font chữ cho toàn bộ UI `design-system/`, áp dụng sàn 13px và bump nhẹ +1px cho các bậc lớn hơn.

## Thang font mới

| Bậc cũ (px) | Bậc mới (px) | Ghi chú |
|---|---|---|
| 9 / 9.5 | **13** | floor |
| 10 / 10.5 | **13** | floor |
| 11 / 11.5 | **13** | floor |
| 12 / 12.5 | **13** | floor |
| 13 | **14** | bump +1 |
| 14 | **15** | bump +1 |
| 15 | **16** | bump +1 |
| 16 | **17** | bump +1 |
| 17 | **18** | bump +1 |
| 18 | **19** | bump +1 |
| 19 | **20** | bump +1 |
| 20+ | **+1** | bump +1, giữ phân cấp |

**Nguyên tắc:**

- **Floor 13px** — mọi cỡ chữ ≤ 12px (kể cả `12.5px`) đều được nâng lên 13px. Đây là kích thước nhỏ nhất xuất hiện trong UI, đảm bảo đọc được trên màn hình thường mà không mỏi mắt.
- **Bump +1px** — các bậc còn lại (≥ 13px) tăng 1px để duy trì tỉ lệ phân cấp đậm/nhạt. Component quan trọng (heading, CTA) vẫn lớn hơn label/meta.
- **Không đổi** — font family, color tokens, spacing/layout. Chỉ cỡ chữ thay đổi.

## Áp dụng

Thay đổi được thực hiện trên toàn bộ:

- `design-system/*.html` (index, projects, new-task, first-run, signin, evidence, tokens)
- `design-system/*.js` (shell.js, api.js, theme.js — các template render class `text-[Npx]`)

Kiểm tra nhanh:

```bash
# Không còn cỡ ≤ 12px
grep -rhoE 'text-\[(9|10|11|12)(\.5)?px\]' design-system/*.html
# (kết quả rỗng = pass)
```

## Chạy test UI (Playwright)

```bash
# Cài đặt lần đầu
pnpm install
npx playwright install chromium

# Chạy test
pnpm test:ui
```

Script `test:ui` chạy riêng qua Playwright, **không** gộp vào `pnpm test` (vitest). Vitest chỉ include `server/**` nên không bị ảnh hưởng.

Spec: `tests/ui/font-size.spec.ts`

- Mở từng màn hình HTML qua `file://`
- Đợi Tailwind CDN xử lý class
- Assert computed `font-size` ≥ 13px cho mọi phần tử có class `text-[Npx]`
- Chụp ảnh màn hình lưu vào `docs/ui/TASK-016/`

## Ảnh chụp (screenshots)

Xem đầy đủ tại [`docs/ui/TASK-016/`](./TASK-016/).

| File | Mô tả |
|---|---|
| `flow-index.png` | Màn hình board (index) — toàn trang |
| `flow-first-run.png` | Màn hình welcome (first-run) — toàn trang |
| `menu-sidebar.png` | Cận cảnh sidebar menu |
| `cta-create-task.png` | Cận cảnh nút CTA "Create task" |
| `cta-full.png` | Màn hình new-task — toàn trang (CTA) |
| `font-after.png` | UI **sau** khi tăng font (hiện tại) |
| `font-before.png` | UI **trước** khi tăng font (mô phỏng bằng CSS override) |

Ảnh `font-before.png` được tạo bằng cách inject CSS override revert các class `text-[Npx]` mới về 13px, cho thấy rõ sự khác biệt về kích thước chữ trước/sau thay đổi.

---

## Output bắt buộc cho task UI (chuẩn dùng lại)

Mọi task thay đổi UI trong tương lai **bắt buộc** phải sinh:

1. **Spec Playwright** (`tests/ui/<task>.spec.ts`) — assert thật (computed style, DOM check), không tautology, không `test.skip`.
2. **Ảnh chụp step-by-step** — mở các màn hình liên quan, chụp trong chính spec đã chạy.
3. **Ảnh cận cảnh** — các thành phần quan trọng (CTA, MENU, FONT before/after).
4. **Tài liệu** (`docs/ui/<topic>.md`) — mô tả thay đổi, cách chạy test, nhúng ảnh.

Template spec Playwright: xem `tests/ui/font-size.spec.ts`.
