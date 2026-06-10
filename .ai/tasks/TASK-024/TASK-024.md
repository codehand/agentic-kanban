# TASK-024: Wire token mint CTA + secret reveal & copy + usage guidance (POST /api/tokens)

Repos: .
Branch: fix/TASK-024-mint-token

## Purpose
Màn Tokens (`design-system/tokens.html`) chưa dùng được. Nguyên nhân gốc (đã xác minh):
1. Banner "Minted judge token 'opus-judge'. Copy it now." (`:31-39`) là **mockup hardcode** — luôn hiện,
   secret giả `akb_live_judge_3d9f7b1a8c64e02f`, không phụ thuộc có mint thật hay không.
2. Nút **copy** (`:37`) không có handler — không copy gì.
3. Nút **"Mint & reveal once"** (`:69`) không handler, không `<form>`, field role/scope/label thiếu id/name.
4. `design-system/api.js` **không có mint**; server **không có HTTP mint endpoint** (`routes.ts` chỉ
   `GET /api/tokens`) dù `mintToken()` đã có ở `server/src/auth/mint.ts`. `human` được phép mint/revoke.
5. **Thiếu hướng dẫn sử dụng**: banner lộ secret nhưng không chỉ cách dùng (Bearer header / endpoint /mcp /
   cấu hình MCP client).

Mục tiêu: CTA mint hoạt động thật (human mint → secret shown-once + copy được), và **hướng dẫn cách dùng
token ngay tại chỗ** (Bearer + /mcp + snippet `.mcp.json`, có copy, link `docs/CONNECT_MCP.md`).

## Scope
- In scope:
  - **Server**: thêm `POST /api/tokens` (human-only) qua handler **`handleMintToken`** trong `routes.ts`,
    tái dùng `mintToken()` (`auth/mint.ts`). Trả `{ id, role, label, project, secret }` — **secret CHỈ trả
    trong response mint này (shown-once)**, KHÔNG bao giờ nằm trong `GET /api/tokens`, KHÔNG log secret.
    401 thiếu token, 403 nếu không phải human, 400 nếu role không hợp lệ.
  - **Client**: `api.js` thêm `mintToken({ role, project, label })` (POST `/tokens`).
  - **UI `tokens.html`**:
    - Bọc mint panel trong `<form>`; field role/scope/label có `id`/`name`; nút "Mint & reveal once" có
      handler → `api.mintToken` → hiển thị banner với **secret thật** (shown-once) + reload bảng tokens.
    - **Bỏ secret hardcode**; banner ẩn mặc định, chỉ hiện sau khi mint với giá trị thật.
    - **Copy** hoạt động (`navigator.clipboard`) cho secret + cho từng snippet hướng dẫn.
    - **Hướng dẫn sử dụng** trong banner: `Authorization: Bearer <token>`, endpoint `/mcp`, snippet cấu
      hình MCP client (`.mcp.json` / `claude mcp add`), mỗi mục có nút copy; link `docs/CONNECT_MCP.md`.
  - **Output UI bắt buộc**: `tests/ui/mint-token.spec.ts` (Playwright) — mở mint, điền, mint → assert banner
    hiện secret + hướng dẫn + copy; ảnh flow step-by-step + ảnh **CTA mint** + **banner secret/guidance**
    vào `docs/ui/TASK-024/`.
  - **Output core/security feature bắt buộc**:
    - `docs/api/mint-token.md`: tài liệu endpoint (request/response, shown-once, security, lỗi).
    - `scripts/test-mint-token.mjs`: **API test script** — mint qua API → kiểm tra secret trả về →
      kiểm tra `GET /api/tokens` KHÔNG lộ secret.
    - `docs/api/mint-token-scenario.md`: **kịch bản test API** + **kịch bản test với agent**.
    - `examples/mint-token/`: **source example from scratch** (mint rồi cấu hình MCP client bằng token đó).
    - **Spawn sub-agent** kết nối `/mcp` **bằng token vừa mint** thực hiện 1 action hợp lệ với role →
      transcript `docs/api/TASK-024/agent-transcript.md` (chứng minh token mint dùng được).
- Out of scope:
  - Revoke token (giữ nguyên; chỉ sửa nếu cần reload bảng).
  - Đổi token model/schema; rotation/expiry.
  - Đổi font/theme (TASK-016/018).

## Acceptance Criteria

### Machine-verifiable (chấm bởi TASK-024.ac.sh + gate; build/test hard-required)
- [ ] AC1: project builds (`build.exit == 0`) — `pnpm build`.
- [ ] AC2: tests pass (`test.exit == 0`) — `pnpm test` (vitest, gồm test mint + non-leak).
- [ ] AC3: HTTP mint — `routes.ts` có `handleMintToken` (định nghĩa + gọi) cho `POST /api/tokens`, tái
      dùng `mintToken` từ `auth/mint.ts`.
- [ ] AC4: client — `design-system/api.js` có `mintToken` gọi `POST` `/tokens`.
- [ ] AC5: UI wired — `tokens.html` có `<form>` mint, nút mint có handler gọi `mintToken`, **không còn**
      secret hardcode `akb_live_judge_3d9f7b1a8c64e02f`, và copy dùng `navigator.clipboard`.
- [ ] AC6: hướng dẫn sử dụng — `tokens.html` có `Bearer`, `/mcp`, và link `CONNECT_MCP.md`.
- [ ] AC7: vitest cover — mint trả secret **và** `GET /api/tokens` KHÔNG chứa secret **và** 401 thiếu token
      / 403 không phải human.
- [ ] AC8: artifacts core — `docs/api/mint-token.md`, `docs/api/mint-token-scenario.md`,
      `scripts/test-mint-token.mjs`, `examples/mint-token/` (không rỗng),
      `docs/api/TASK-024/agent-transcript.md`.
- [ ] AC9: output UI — `tests/ui/mint-token.spec.ts` (assert banner secret/guidance) + `docs/ui/TASK-024/`
      ≥ 3 ảnh `.png` gồm tên chứa `cta` và `banner`.

### Human / semantic (Judge + Human)
- [ ] AC10: mint thật end-to-end — human mint → secret thật shown-once + copy được + hướng dẫn dùng hiện rõ
      (ảnh chứng minh); sub-agent kết nối /mcp bằng token mint chạy được (transcript).
- [ ] AC11: security thật — secret chỉ xuất hiện ở response mint, không ở list/log; non-human bị 403; input
      sai 400 — test không tautology / không skip / không xoá assertion.
- [ ] AC12: a11y AA (form, nút copy có nhãn/aria, feedback "copied"), reduced-motion không vỡ; không
      regress bảng tokens list.

## Definition of Done
Mọi machine-verifiable AC pass dưới evidence mới sinh, Judge `VERDICT: PASS`, và human
`.ai/scripts/gate.sh approve TASK-024`.

## Dependencies
TASK-009 (API/UI + `listTokens`). Liên quan TASK-019 (mẫu POST handler human-only). Chạm
`routes.ts`/`api.js`/`tokens.html` — rebase nếu trùng.

## References
- design-system/tokens.html:31-39 (banner mockup hardcode) · :42-71 (mint form chưa wire) · :99-133 (tokens.js list)
- server/src/api/routes.ts:378 (GET /api/tokens; thêm POST) · server/src/auth/mint.ts (mintToken/MintResult)
- server/src/auth/authorize.ts (human mint/revoke) · server/src/db/repositories/token.ts (insertToken/secret_hash)
- docs/CONNECT_MCP.md (hướng dẫn kết nối MCP — nguồn snippet) · TASK_HUB_DESIGN.md §? (token/role) · UI_DESIGN_BRIEF.md (S7 Token Management)
