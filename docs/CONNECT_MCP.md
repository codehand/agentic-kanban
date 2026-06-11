# Kết nối Claude Code tới Agentic Kanban (aka-mcp) server

Agentic Kanban (gọi tắt **aka-mcp**) expose một MCP endpoint **Streamable HTTP** tại `POST/GET/DELETE /mcp`, xác thực bằng
`Authorization: Bearer <token>`. Tài liệu này hướng dẫn nối Claude Code (hoặc bất kỳ MCP client nào)
tới một server **đang chạy**.

> Tạo task **không** có trên Web UI (nút "New Task" hiện chưa wire). Cách tạo task/chạy vòng đời v1 là
> qua MCP tool dưới đây, hoặc qua engine `.ai/` (P8, chưa làm).

## 1. Chạy server

Server cần một entry point để boot (`server/src/main.ts`) và phục vụ trên `PORT` (mặc định 3000):

```bash
cd <repo>
pnpm install
pnpm build
ADMIN_TOKEN=my-secret-token PORT=3000 DB_PATH=tasks.db node dist/main.js
```

`ADMIN_TOKEN` được bootstrap thành **một token role `human`** — dùng chính nó làm bearer.
Kiểm tra: `curl -s http://127.0.0.1:3000/healthz` → `{"status":"ok"}`.

> Nếu `pnpm build` chưa copy file `.sql` vào `dist/db/migrations/`, chạy thêm:
> `mkdir -p dist/db/migrations && cp server/src/db/migrations/*.sql dist/db/migrations/`

## 2. Đăng ký MCP server vào Claude Code

```bash
claude mcp add --transport http taskhub http://127.0.0.1:3000/mcp \
  --header "Authorization: Bearer my-secret-token"
```

- `taskhub` = tên server (tùy đặt). `--transport http` = Streamable HTTP.
- Scope: thêm `-s user` (toàn máy) hoặc `-s project` (chia sẻ qua `.mcp.json`); mặc định `local`.
- Kiểm tra: `claude mcp list` → thấy `taskhub` ✓ connected. Trong phiên Claude Code, gõ `/mcp` để xem
  trạng thái + danh sách tool.

Gỡ: `claude mcp remove taskhub`.

## 3. Token theo role (chạy đủ vòng đời cần nhiều token)

Quyền = **role của token**, server cưỡng chế. Một token chỉ làm được việc của role đó:

| Role | Làm được |
|------|----------|
| `human` | `task.create`, `task.approve`→DONE, reset/remove, mint/revoke token, đọc tất cả |
| `implementer` | `task.claim`, `TODO→IN_PROGRESS→IMPLEMENTED`, comment narrative, `gitref.set` |
| `self-check` | trigger `task.selfcheck`, `IMPLEMENTED→SELF_CHECK_*` |
| `judge` | `SELF_CHECK_PASSED→JUDGE_*`, comment verdict |
| `runner` | `evidence.submit` (chỉ vậy) |

Token `human` (từ `ADMIN_TOKEN`) tạo được project + task. Để chạy hết pipeline, **mint thêm** token các
role khác qua JSON API `POST /api/tokens` (human-only — không có MCP tool cho việc mint/revoke token),
rồi đăng ký mỗi role như một MCP server riêng với bearer tương ứng (hoặc đổi header khi cần).

## 4. Tool surface (tên tool)

Đọc: `project.list` · `project.create` · `task.list` · `task.get` · `task.next` · `comment.list` ·
`evidence.get` · `gitref.list`
Ghi: `task.create` · `task.claim` · `task.heartbeat` · `task.release` · `task.transition` · `gitref.set` ·
`comment.add` · `evidence.submit` · `task.selfcheck` · `task.approve`

Trong Claude Code tool hiện dưới dạng `mcp__taskhub__<tên>`.

## 5. Ví dụ: tạo project + task (qua human token)

Sau khi `claude mcp add`, yêu cầu Claude Code (hoặc gọi tool trực tiếp):

```
project.create  { slug: "demo", name: "Demo Project" }
task.create     { project: "demo", key: "TASK-001", title: "First task", body_md: "## Spec\n..." }
task.list       { project: "demo" }
```

Mở Web UI `http://127.0.0.1:3000/` (đăng nhập bằng cùng token ở `signin.html`) sẽ thấy task vừa tạo
trên board.

## Troubleshooting

- **401 từ /mcp** → thiếu/sai header `Authorization: Bearer`. Kiểm tra token còn active (chưa revoke).
- **Server không nghe** → đảm bảo chạy từ thư mục repo (UI tĩnh + MR resolve theo `process.cwd()`), và
  `ADMIN_TOKEN` đã set để có token đăng nhập.
- **Tool báo lỗi role** → token sai role cho hành động đó (xem bảng §3); dùng token đúng role.
