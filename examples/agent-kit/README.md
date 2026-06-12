# agent-kit — bộ skill/command copy vào project target

Bộ `.claude/` portable để các Claude session trong **project target** (repo demo mà
agent sẽ sửa code) biết cách vận hành lifecycle của aka-mcp qua MCP. Hub server và
token mint vẫn theo `docs/CONNECT_MCP.md`.

## Nội dung

```
.claude/
  skills/aka-kanban/SKILL.md      # tham chiếu chung: state machine, guard, lease, evidence
  commands/aka-impl.md            # 1 vòng implementer   → /aka-impl <slug>
  commands/aka-selfcheck.md       # 1 vòng self-check    → /aka-selfcheck <slug>
  commands/aka-judge.md           # 1 vòng judge         → /aka-judge <slug>
  commands/aka-human.md           # 1 vòng human approve → /aka-human <slug>
  scripts/wait-for-work.sh        # watcher 0-token cho watch mode (curl + jq)
```

## Cách dùng

1. Copy nguyên thư mục `.claude/` này vào **từng clone** của project target
   (`work-impl`, `work-selfcheck`, `work-judge`, `work-human`):

   ```bash
   for r in impl selfcheck judge human; do
     cp -R examples/agent-kit/.claude ~/ws/demo/work-$r/
   done
   ```

2. Trong mỗi clone, đăng ký MCP server `taskhub` với bearer token đúng role
   (clone self-check đăng ký thêm `taskhub-runner` với token role `runner`).
   Chạy trong Docker thì dùng `http://host.docker.internal:3000/mcp`.

3. Mở `claude` trong từng clone và chạy theo một trong hai chế độ:

   **Watch mode (khuyên dùng — idle 0 token):** gõ command MỘT lần, không cần /loop:

   | Terminal | Lệnh |
   |---|---|
   | work-impl | `/aka-impl demo` |
   | work-selfcheck | `/aka-selfcheck demo` |
   | work-judge | `/aka-judge demo` |
   | work-human | `/aka-human demo` |

   Khi hết việc, agent tự thả `.claude/scripts/wait-for-work.sh` chạy nền (poll hub
   bằng curl mỗi 30s — không tốn token). Có task đúng state → script thoát → session
   tự thức dậy xử lý → lại gác. Session để mở vĩnh viễn trong terminal; LLM chỉ
   chạy khi có việc thật. Script cần `jq` + `curl`, tự đọc URL/token từ `.mcp.json`
   của clone (override bằng env `AKA_HUB_URL` / `AKA_TOKEN`; đổi nhịp poll bằng
   `AKA_POLL_INTERVAL`).

   **Loop mode (cũ):** `/loop 5m /aka-impl demo` … — agent bị đánh thức đều mỗi 5
   phút kể cả khi board rỗng. Dùng khi không muốn dựa vào background task.

   `demo` = project slug trên hub; bỏ trống thì command mặc định dùng `demo`.

   Context của session vẫn dài dần theo số task đã xử lý (không theo thời gian
   idle nữa). Lúc board vắng, thi thoảng gõ `/compact` — kit vốn stateless
   (mọi context rebuild từ hub + origin) nên nén/clear không mất gì.

Mỗi command tự chứa quy tắc "đang thao tác thì skip": mỗi vòng tối đa 1 task, vòng
trước còn dở thì làm tiếp thay vì pick task mới. Watch mode gác waker cuối **mọi**
turn (watcher thoát tức thì nếu queue còn task → backlog tự rút từng task một;
trường hợp chủ động để việc lại — blocked/infra fail — dùng timer `sleep` để
tránh spin).

Kit giả định session chạy trong môi trường ephemeral (Docker/sandbox), nên **git
server (origin) là source of truth**: implementer push nhánh trước mọi lần update
state lên hub; self-check/judge/human chỉ fetch từ origin và fail/reject nếu
`head_sha` đã đăng ký không tồn tại trên origin. Vì vậy origin phải được mount/route
tới được từ trong container (bare repo mount volume, hoặc remote thật như GitHub).
