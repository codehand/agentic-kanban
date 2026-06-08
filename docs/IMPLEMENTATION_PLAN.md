# Agentic Kanban (Task Hub) — Implementation Plan

> Trạng thái: **PLAN — chờ chốt để bắt đầu P0**
> Cập nhật: 2026-06-08
> Nguồn sự thật chức năng: [`../TASK_HUB_DESIGN.md`](../TASK_HUB_DESIGN.md) · UI: [`../UI_DESIGN_BRIEF.md`](../UI_DESIGN_BRIEF.md)

---

## 1. Bối cảnh & mục tiêu

Xây **MCP server tập trung** đóng vai *gate có thẩm quyền* + *kho kanban* cho workflow
no-self-certification: agent (đa-device, qua MCP) nhận/chuyển task + nộp evidence; **server cưỡng chế
luật theo role**; một human operator review + approve qua web UI. Server **không chạy code**, chỉ điều
phối + lưu trữ + cưỡng chế.

**Đã có sẵn (đầu vào):**
- Thiết kế chức năng chốt: `TASK_HUB_DESIGN.md` (data model, state machine, MCP tools, auth).
- Brief UI + **prototype UI 8 màn đã build** ở `design-system/` (board, drawer, projects, create-task,
  evidence, tokens, sign-in, first-run).
- Engine workflow gốc `.ai/` (gate.sh / run-evidence.sh) đang chạy cho repo Go.

**Cần làm (phạm vi plan này):** hiện thực server + wiring UI thật + tích hợp lại engine `.ai/`.

**Lộ trình tổng:** **standalone trước** (server + MCP + UI tự chạy, test bằng MCP client) → **sau đó**
mới sửa `.ai/` thành thin client gọi server (đúng §2 của `TASK_HUB_DESIGN.md`).

---

## 2. Kiến trúc tổng thể

Một **process Node duy nhất** phục vụ 3 mặt: (a) MCP endpoint (Streamable HTTP), (b) JSON read API +
write-action cho UI, (c) static web UI.

```
                ┌─────────────────────────── Task Hub (1 Node process) ───────────────────────────┐
   AI agents    │  HTTP server                                                                     │
  (MCP client) ─┼─▶ /mcp   (Streamable HTTP)  ─┐                                                    │
                │  /api/*  (JSON + SSE)        ─┼─▶ Auth (bearer→role) ─▶ Tool/Route handlers       │
   Human (UI)  ─┼─▶ /      (static design-system)│                              │                   │
                │                                 │            ┌─────────────────┴───────────────┐   │
                │                                 │            ▼                ▼                ▼   │
                │                              Services:    Gate          Evidence            Lease  │
                │                            (state machine, (immutable,   (claim/heartbeat)        │
                │                             role+guard      checksum)                              │
                │                             enforcement)        │                                  │
                │                                 └──────────────┬┴──────────────┘                  │
                │                                          Data layer (repositories)                │
                │                                          better-sqlite3  ──▶  tasks.db             │
                └──────────────────────────────────────────────────────────────────────────────────┘
```

**Lớp & ranh giới (quan trọng cho tính chống gian lận):**
- **Transport/HTTP**: parse request, route. Không chứa business rule.
- **Auth**: bearer token → `{role, project_scope, token_id}`; từ chối token thiếu/sai/revoked.
- **Handlers** (MCP tool + API route): validate input (zod), gọi service. Không tự ghi state.
- **Gate (service)**: thực thể **duy nhất** quyết định chuyển state + ghi `transition` (append-only).
  Cưỡng chế bảng transition + role + guard + checksum. Đây là trụ chống false-positive completion.
- **Evidence (service)**: chỉ nhận từ role `runner`, ghi immutable + manifest checksum; `selfcheck`
  đọc evidence mới nhất và để **gate** đổi state.
- **Lease (service)**: claim/heartbeat/release/expiry.
- **Data**: repository functions trên SQLite. `evidence` + `transition` append-only (không UPDATE/DELETE).

> **Bất biến nền:** Handler/agent chỉ *đề xuất*; chỉ **Gate** ghi `state`/`transition`, chỉ **Evidence
> service** ghi `evidence`. Mọi quyền do **role của token** quyết định, cưỡng chế phía server.

---

## 3. Quyết định công nghệ

Khuyến nghị mặc định; mục có (⚠️ chốt) cần xác nhận trước P0.

| Hạng mục | Lựa chọn | Ghi chú |
|----------|----------|---------|
| Ngôn ngữ/runtime | **TypeScript**, Node ≥ 20, ESM | đúng `TASK_HUB_DESIGN.md` §2 |
| MCP | `@modelcontextprotocol/sdk` | transport **Streamable HTTP** (remote-capable) |
| DB | `better-sqlite3` | đồng bộ, đơn process, không cần ORM nặng |
| Migrations | SQL đánh số + runner nhỏ tự viết | tránh ORM; schema cố định, ít thay đổi |
| HTTP/JSON API + static | **`node:http` tối giản** (chốt) | tự viết router nhỏ + static handler + SSE; không thêm web framework |
| Validation schema | **zod** | dùng chung cho MCP tool input + API body |
| Token hashing | SHA-256 + salt, so sánh constant-time | bearer ngẫu nhiên entropy cao; lưu **chỉ hash** |
| Live UI updates | **SSE** (`/api/stream`) | tự viết trên `node:http` (`text/event-stream`); poll là fallback |
| Test | **vitest** + temp SQLite; MCP client của SDK cho integration | gate/evidence phủ test cao nhất |
| Lint/format | eslint + prettier (hoặc Biome) | |
| Logger | pino | structured logs |
| Package manager | **pnpm** (chốt) | cài pnpm trên máy chạy |

**Cấu trúc thư mục đề xuất:**
```
server/                      # mã nguồn server (TypeScript)
  src/
    config/        # load env + config.yml (checks, thresholds, lease TTL)
    db/            # connection, migrations/, repositories/
    auth/          # bearer parse, role resolve, authorize(role, action)
    domain/
      statemachine.ts   # bảng transition + role (pure)
      gate.ts           # validate + guard + checksum + ghi transition
      evidence.ts       # submit (runner-only) + selfcheck
      lease.ts          # claim/heartbeat/release/expiry
    mcp/           # đăng ký MCP tools, map sang services
    api/           # JSON routes + SSE cho UI
    http/          # bootstrap server, static serving
  test/
web/                         # = design-system/ wiring thành app thật (hoặc build ra đây)
docs/                        # tài liệu (file này)
```

---

## 4. Nguyên tắc thực thi

1. **Standalone trước**, `.ai/` integration sau (P8). Không trộn 2 việc.
2. **AC ưu tiên machine-verifiable** (exit code, test) — đúng triết lý repo (`CLAUDE.md`, `WORKFLOW_DESIGN`).
3. **Gate là trụ tin cậy** → coverage + test cao nhất; mọi luật transition phải có test cả nhánh
   hợp lệ lẫn bị từ chối (role sai, nhảy cóc, thiếu evidence/verdict, checksum lệch).
4. **Surgical, simple** (`CLAUDE.md`): không thêm abstraction/feature ngoài `TASK_HUB_DESIGN.md` v1.
5. **Dùng chính workflow của repo để build server** — P0 adapt `.ai/` cho stack Node để các task triển
   khai (P1+) đi qua đủ pipeline gate/judge.

---

## 5. Các phase

Mỗi phase: **Mục tiêu · Phạm vi · Deliverables · Acceptance (machine-verifiable) · Phụ thuộc · Rủi ro**.

### P0 — Scaffold & toolchain (+ adapt engine `.ai/` cho Node)
- **Mục tiêu:** dự án build/test/boot được; có thể chạy task qua workflow gate của chính repo.
- **Phạm vi:** init pnpm + tsconfig (ESM) + eslint/prettier + vitest; cấu trúc `server/src` (mục 3);
  config loader (env: `PORT`, `ADMIN_TOKEN`, `DB_PATH`; + `config.yml`: check modes/thresholds, lease TTL);
  logger; `GET /healthz` (trên `node:http`). Adapt `.ai/config.yml` (`commands.build/test`→`pnpm build`/
  `pnpm test`) + `run-evidence.sh` (build/test Node, coverage qua `vitest --coverage`, ghi `*.exit` + `manifest.json`).
- **Deliverables:** repo build được, server rỗng chạy, engine `.ai/` chạy được cho task Node.
- **Acceptance:**
  - `pnpm install && pnpm build` → exit 0.
  - `pnpm test` → exit 0 (kể cả 0 test).
  - `curl /healthz` → `200 {"status":"ok"}`.
  - `.ai/scripts/run-evidence.sh <TASK>` sinh `evidence/<TASK>/{build.exit,test.exit,manifest.json}` cho repo Node.
- **Phụ thuộc:** —. **Rủi ro:** adapt `run-evidence.sh` đa-repo cho Node (giữ contract export `AI_WT_<REPO>`).

### P1 — Data layer (SQLite schema + repositories)
- **Mục tiêu:** persistence trung thực với data model `TASK_HUB_DESIGN.md` §4.
- **Phạm vi:** migration tạo 7 bảng (`project, task, transition, comment, evidence, gitref, token`);
  runner idempotent; repository functions typed; **append-only** cho `evidence`/`transition` (chặn
  UPDATE/DELETE bằng SQLite trigger + guard ở repo); index theo `task.project_id`, `task.state`.
- **Acceptance:**
  - Migration tạo đủ bảng; chạy lại không lỗi (idempotent) — test.
  - CRUD cơ bản từng bảng — unit test pass.
  - UPDATE/DELETE một dòng `evidence` hoặc `transition` → **bị từ chối** — test.
- **Phụ thuộc:** P0. **Rủi ro:** thiết kế `manifest_json`/`logs_json` (TEXT JSON) đủ cho checksum sau.

### P2 — Auth & roles (token theo role)
- **Mục tiêu:** lớp chống self-certify trung tâm: quyền = role của token, cưỡng chế phía server.
- **Phạm vi:** bearer parse middleware; resolve `{role, project_scope, token_id}`; bootstrap
  `ADMIN_TOKEN`→token `human` (idempotent); `token.mint(role, project?)` trả secret **một lần**, lưu hash;
  `token.revoke`; helper `authorize(role, action)` map role→quyền (bảng §3 của design).
- **Acceptance:**
  - Lần chạy đầu với `ADMIN_TOKEN` tạo đúng 1 token `human` (chạy lại không nhân đôi) — test.
  - `mint` lưu **chỉ hash** (secret không có plaintext trong DB) — test.
  - Request thiếu/sai/revoked token → 401/403 — test.
  - `authorize`: `runner` không được transition; `implementer` không được approve/JUDGE_* — test.
- **Phụ thuộc:** P1. **Rủi ro:** rò secret qua log (đảm bảo không log token).

### P3 — State machine & Gate (lõi cưỡng chế)
- **Mục tiêu:** thực thể duy nhất ghi state; tái lập đúng `gate.sh`.
- **Phạm vi:** bảng `ALLOWED` (`FROM>TO:role`) đúng §5 design; `gate.propose` validate (state thực tế ==
  from, transition hợp lệ, role đúng, không nhảy cóc); guards: **IMPLEMENTED** (mỗi `gitref` có
  `head_sha != base_sha`, hoặc `allow_no_code_change`), **→JUDGE_PASSED/REJECTED** đòi comment
  `kind=verdict` tương ứng tồn tại, **→JUDGE_PASSED/selfcheck** re-verify checksum evidence, **DONE** chỉ
  `human`; ghi `transition` (append-only, kèm actor/at/note/evidence_ref).
- **Acceptance:**
  - Nhảy cóc (vd `IMPLEMENTED→JUDGE_PASSED`) → reject — test.
  - Sai role → reject — test.
  - `→IMPLEMENTED` khi không repo nào đổi & không `allow_no_code_change` → reject; có flag → pass — test.
  - `→JUDGE_PASSED` thiếu comment verdict=PASS → reject — test.
  - `→DONE` bởi non-human → reject — test.
- **Phụ thuộc:** P1, P2. **Rủi ro:** đồng bộ guard với mô hình multi-repo (`gitref` nhiều dòng/task).

### P4 — Evidence subsystem
- **Mục tiêu:** "evidence là sự thật do máy đo, immutable" — chống bịa.
- **Phạm vi:** `evidence.submit(...)` **runner-only** → ghi row immutable + `manifest_json` (file→sha256)
  + exit codes + coverage + `logs_json`; `task.selfcheck`: đọc evidence **mới nhất**, verify checksum,
  build/test/ac **hard-required**, lint/coverage theo `config` (optional→warn / required→block) → gọi
  **gate** set `SELF_CHECK_PASSED|FAILED`; re-verify checksum ở transition judge.
- **Acceptance:**
  - Submit bởi role ≠ runner → reject — test.
  - Evidence không sửa được sau khi ghi (no update path) — test.
  - `selfcheck`: build/test/ac=0 → PASSED; bất kỳ ≠0 → FAILED — test.
  - Manifest checksum lệch (giả lập tamper) → selfcheck/judge reject — test.
  - lint/coverage: optional→warn không chặn; đổi config required→chặn — test.
- **Phụ thuộc:** P1, P2, P3. **Rủi ro:** định nghĩa "latest evidence" rõ ràng (theo `created_at`/id).

### P5 — MCP server (tool surface, Streamable HTTP)
- **Mục tiêu:** agent kết nối qua MCP, thao tác đủ vòng đời.
- **Phạm vi:** mount SDK server + Streamable HTTP vào process; đăng ký tools §6 design với zod schema:
  *đọc* `project.list/create`, `task.list/get/next`, `comment.list`, `evidence.get`, `gitref.list`;
  *ghi* `task.create/claim/heartbeat/release/transition`, `gitref.set`, `comment.add`,
  `evidence.submit`, `task.selfcheck`, `task.approve`. Mỗi tool ghi đi qua auth(role)+gate/service; map
  lỗi domain → MCP error.
- **Acceptance:**
  - MCP client (SDK) kết nối Streamable HTTP kèm bearer — integration test.
  - Happy path đầy đủ `TODO→IN_PROGRESS→IMPLEMENTED→SELF_CHECK_PASSED→JUDGE_PASSED` qua tools, mỗi role
    dùng token riêng — integration test.
  - `implementer` token gọi `evidence.submit` → tool trả lỗi role — integration test.
- **Phụ thuộc:** P2–P4. **Rủi ro:** tương thích phiên bản SDK + auth trên Streamable HTTP.

### P6 — Concurrency: claim / lease / heartbeat
- **Mục tiêu:** nhiều agent đa-device không giành 1 task.
- **Phạm vi:** `task.claim` (set `assignee_token_id`+`lease_until`, chỉ khi chưa lease/lease hết hạn);
  `heartbeat` gia hạn; `release` nhả; lease hết hạn → tự mở claim lại; transition đòi caller giữ lease
  (trừ `human`/`gate`). TTL 15m, heartbeat 5m (config).
- **Acceptance:**
  - claim khi task tự do → ok; token khác claim khi đang lease → reject — test.
  - Sau khi lease hết hạn, token khác claim được — test.
  - Transition bởi token không giữ lease (non-human) → reject — test.
- **Phụ thuộc:** P5. **Rủi ro:** clock/expiry; đua claim đồng thời (dùng transaction SQLite).

### P7 — JSON read API + Web UI wiring + SSE
- **Mục tiêu:** biến prototype `design-system/` thành app thật, dữ liệu sống.
- **Phạm vi:** endpoints cho UI: `GET /api/projects`, `/api/tasks?project&state`, `/api/tasks/:key`
  (spec+gitref+evidence summary+timeline), `/api/evidence/:key`, `/api/tokens`; write cho human:
  approve/reset/remove (bearer human); **SSE** `/api/stream` đẩy update (transition, lease tick); token
  gate (S5) nhận token, lưu trên device; deep-link `/p/<project>`, `/t/<KEY>`; thay mock data trong UI
  bằng fetch; trạng thái loading/empty/error đã có sẵn trong prototype.
- **Acceptance:**
  - UI load board thật từ API (smoke test gọi endpoints + 1 e2e nhẹ).
  - Approve từ UI: `JUDGE_PASSED→DONE` persist, reload thấy ở cột Done — test.
  - SSE phát event khi có transition — integration test.
  - Endpoint đòi token hợp lệ; thiếu → 401 — test.
- **Phụ thuộc:** P5 (API), prototype UI (đã có). **Rủi ro:** giữ a11y AA + reduced-motion từ prototype.

### P8 — Tích hợp engine `.ai/` (thin client)
- **Mục tiêu:** CLI quen thuộc chạy trên server (đúng §12 design).
- **Phạm vi:** `gate.sh` `propose/selfcheck/approve` → gọi MCP tool tương ứng; `run-evidence.sh` vẫn
  build/test **local trong worktree** nhưng `evidence.submit` lên server bằng token `runner`;
  `new-task.sh`/`/newtask` → `task.create`. Giữ fallback file cho offline (tuỳ chọn).
- **Acceptance:**
  - `gate.sh propose` đẩy 1 transition trên server — integration.
  - `run-evidence.sh` submit evidence (runner) và server ghi nhận — integration.
  - Flow worktree đơn-repo & đa-repo vẫn chạy với server.
- **Phụ thuộc:** P5, P6. **Rủi ro:** ánh xạ worktree/gitref local ↔ `gitref.set` trên server.

### P9 — Hardening, docs, deploy (v1 polish)
- **Mục tiêu:** chạy được ổn định trên LAN cho 1 operator.
- **Phạm vi:** error response nhất quán, giới hạn input, structured logs, README/runbook, backup SQLite,
  graceful shutdown (đóng DB), systemd unit / container, basic metrics.
- **Acceptance:**
  - README quickstart chạy end-to-end trên máy sạch.
  - Graceful shutdown đóng DB không hỏng file — test/manual.
  - UI a11y AA pass (kế thừa prototype) — Lighthouse.
- **Phụ thuộc:** P7 (, P8). **Rủi ro:** —.

---

## 6. Sequencing & milestones

```
P0 ─▶ P1 ─▶ P2 ─▶ P3 ─▶ P4 ─▶ P5 ─┬─▶ P6 ──┐
                                   └─▶ P7 ──┼─▶ P8 ─▶ P9
                                            │
   (UI prototype đã xong, P7 chủ yếu wiring)┘
```

- **Critical path tin cậy:** P1→P2→P3→P4 (data → auth → gate → evidence) là lõi chống gian lận, làm tuần tự, test nặng.
- **Milestone A (server lõi):** hết P5 — agent thao tác đủ vòng đời qua MCP.
- **Milestone B (operator dùng được):** hết P7 — human review/approve trên UI thật.
- **Milestone C (tích hợp + v1):** hết P9 — CLI `.ai/` chạy trên server, deploy LAN.
- **Song song được:** P6 và P7 sau khi xong P5 (khác vùng: concurrency vs API/UI).

---

## 7. Cross-cutting concerns

- **Security (v1):** single-user, localhost/LAN, **không TLS/RBAC đa-human** (đúng giới hạn design §13).
  Bearer entropy cao, lưu hash, không log secret.
- **Immutability defense-in-depth:** checksum (`manifest_json`) **và** chặn UPDATE/DELETE ở DB layer
  (trigger) — không chỉ dựa một lớp.
- **Error handling:** lỗi domain (reject) tách lỗi hệ thống; map nhất quán sang MCP error / HTTP status.
- **Testing strategy:** unit cho `domain/*` (pure: statemachine, gate guards, selfcheck) phủ cao nhất;
  integration cho MCP/API trên temp SQLite; e2e nhẹ cho UI happy path. Mọi luật reject phải có test.
- **Observability:** pino structured logs cho mỗi transition (actor, from→to, evidence_ref).

---

## 8. Mapping phase → Success Criteria (`TASK_HUB_DESIGN.md` §14)

| Success Criteria (design) | Phase đảm bảo |
|---------------------------|---------------|
| Agent đa-device connect 1 server, nhận/chuyển task qua MCP | P5 |
| Role cưỡng chế server: implementer không submit evidence / không set JUDGE_*/DONE | P2, P3, P4 |
| Evidence immutable + checksum; chỉ runner ghi | P1, P4 |
| Verdict structured; transition đòi đúng evidence + verdict | P3, P4 |
| Human approve qua UI (chỉ human set DONE); UI show MR/ref/evidence | P3, P7 |
| Lease chống 2 agent giành 1 task | P6 |
| Standalone chạy được trước khi đụng `.ai/` | P0–P7 trước P8 |

---

## 9. Rủi ro & giả định

- **Tin `runner` về tính trung thực build/test** (server không re-run). Bảo vệ = tách credential
  (implementer không có token runner) + checksum. Cùng tác nhân nắm 2 token vẫn bịa được → kỷ luật cấp
  token là trách nhiệm human (đúng design §13).
- **"Code trong worktree, main sạch"** không cưỡng chế được từ xa → hạ xuống "branch push remote,
  head>base" (verify hoặc tin attestation runner).
- **Giả định:** không yêu cầu gọi git host API ở v1 (implementer tự tạo MR, server lưu URL+sha).

**Quyết định đã chốt (2026-06-08):**
1. HTTP: **`node:http` tối giản** — tự viết router + static + SSE, không thêm web framework.
2. Package manager: **pnpm**.
3. UI thật: **wiring tại chỗ** trong `design-system/` (HTML+JS), thay mock data bằng fetch + SSE (P7 nhẹ).

---

## 10. Out of scope (v1 — KHÔNG làm)

- TLS, RBAC/đa-human, public-internet auth.
- Gọi git host API / auto-merge MR (approve chỉ set DONE).
- Sửa workflow/state machine từ UI, drag-to-change-state, agent chat/console, full diff viewer.
- Server tự chạy build/test của repo đích.
