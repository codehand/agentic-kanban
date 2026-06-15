# Template: Multi-agent (per-role subagent) lifecycle E2E

> **Mục đích.** Kịch bản tái dùng để chứng minh **N subagent Claude độc lập** (mỗi role 1 bearer token
> riêng) phối hợp **chỉ qua server** đưa một task đi hết vòng đời no-self-certification
> `TODO → IN_PROGRESS → IMPLEMENTED → SELF_CHECK_PASSED → JUDGE_PASSED → DONE`, và xác minh bằng dữ liệu
> server đóng dấu (không giả được). Dùng làm khung cho mọi task kiểu "spawn nhiều agent theo role để test flow".
>
> Lần chạy tham chiếu (2026-06-13, 5 agent thật) đạt DONE với 5 token_id phân biệt — xem
> `.ai/reports/TASK-046/` và `scripts/role-subagents-e2e/` cho bản đóng-gói gate-verifiable.

---

## 0. Nguyên tắc thiết kế (đọc trước khi dùng)

1. **1 token / 1 subagent.** Prompt mỗi subagent chỉ chứa ĐÚNG bearer của role nó; không con nào biết token con khác. Đây là điều biến "5 process" thành "5 tác nhân tách biệt".
2. **Phối hợp chỉ qua server.** Mỗi subagent **poll `task.get`** tới khi đến lượt rồi mới act. Không truyền tin ngoài luồng (không chia sẻ biến, không nhắn nhau).
3. **Tin cậy = dữ liệu server đóng dấu.** Server lấy `actor_role`/`actor_token_id` từ bearer đã xác thực (`server/src/mcp/tools/write.ts` → `ctx.auth.*`), client KHÔNG gửi được. Verify đọc lại các field này, không tin lời subagent.
4. **Real LLM subagent là non-deterministic** → KHÔNG nhét được vào gate `.ac.sh` headless. Muốn gate chấm máy, viết thêm **deterministic self-test** dùng scripted MCP client (xem `scripts/role-subagents-e2e/selftest.sh`). File này là cho lần chạy **agent thật, quan sát tay**.
5. **runner là role thứ 5.** Pipeline cần `runner` nộp evidence trước khi self-check pass — đừng quên (4 role "nhìn thấy" + runner = 5).

## 1. Dựng server persistent + mint token theo role

> Persistent (KHÔNG teardown) để query history sau khi chạy.

```bash
cd <repo>
pnpm build   # nếu chưa có dist/
ADMIN_TOKEN=<HUMAN_SECRET> PORT=<PORT> DB_PATH=/tmp/<run>.db node dist/index.js > /tmp/<run>.log 2>&1 &
curl -s http://127.0.0.1:<PORT>/healthz   # -> {"status":"ok"}

# human = ADMIN_TOKEN. Mint 4 role còn lại (in secret 1 lần):
for role in implementer runner self-check judge; do
  secret=$(curl -s -X POST -H "Authorization: Bearer <HUMAN_SECRET>" -H "Content-Type: application/json" \
    -d "{\"role\":\"$role\"}" http://127.0.0.1:<PORT>/api/tokens \
    | python3 -c "import sys,json;print(json.load(sys.stdin)['secret'])")
  echo "$role=$secret"
done
```

## 2. CLI transport helper (đặt ở repo root để resolve node_modules)

`_aka-mcp-cli.mjs` — cho subagent gọi 1 MCP tool với token của nó. Thin transport; out-of-role → in `TOOL_REJECTED`, exit 1.

```js
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
const URL_ = process.env.AKA_URL || 'http://127.0.0.1:<PORT>/mcp'
const TOKEN = process.env.AKA_TOKEN
const tool = process.argv[2]; const args = process.argv[3] ? JSON.parse(process.argv[3]) : {}
const c = new Client({ name: 'role-subagent', version: '1.0.0' }, { capabilities: {} })
await c.connect(new StreamableHTTPClientTransport(new global.URL(URL_),
  { requestInit: { headers: { Authorization: 'Bearer ' + TOKEN } } }))
let r; try { r = await c.callTool({ name: tool, arguments: args }) }
catch (e) { console.error('CALL_ERROR: ' + (e?.message || e)); await c.close(); process.exit(1) }
await c.close()
const text = (r.content ?? []).map((x) => x.text ?? '').join('')
if (r.isError) { console.error('TOOL_REJECTED: ' + text); process.exit(1) }
process.stdout.write(text)
```

> ⚠️ ESM resolve `@modelcontextprotocol/sdk` theo thư mục script đi lên → **đặt ở repo root**, không ở `/tmp`. Xoá sau khi xong (giữ git sạch).

Mỗi subagent gọi: `AKA_TOKEN=<secret> node <repo>/_aka-mcp-cli.mjs <tool> '<json-args>'`.

## 3. Spawn N subagent (Agent tool, song song, mỗi con 1 prompt dưới đây)

- `subagent_type: general-purpose`, `run_in_background: true`, đặt tên rõ: `human-agent`, `implementer-agent`, `runner-agent`, `selfcheck-agent`, `judge-agent`.
- **Tham số chung** thay vào mỗi prompt: `BASE=http://127.0.0.1:<PORT>/mcp`, `PROJECT=<slug>`, `KEY=<task-key>`, `CLI=<repo>/_aka-mcp-cli.mjs`, và **CHỈ token của role đó**.
- Poll loop chuẩn (đưa vào từng prompt; mỗi con đổi `WANT` cho state nó chờ):
  ```bash
  T=<role-secret>; CLI=<repo>/_aka-mcp-cli.mjs; WANT=<STATE-it-waits-for>
  for i in $(seq 1 120); do
    S=$(AKA_TOKEN=$T node $CLI task.get '{"project":"<slug>","key":"<key>"}' 2>/dev/null \
        | python3 -c "import sys,json;print(json.load(sys.stdin).get('state',''))" 2>/dev/null)
    echo "poll $i: state=$S"; [ "$S" = "$WANT" ] && break; sleep 2
  done
  ```

### Prompt theo role (giữ nguyên ranh giới — đừng để con nào làm việc role khác)

| Role | Chờ (WANT) | Hành động (theo thứ tự) |
|------|-----------|--------------------------|
| **human** | — rồi `JUDGE_PASSED` | `project.create {slug,name}` → `task.create {project,key,title,body_md,allow_no_code_change:true}` → poll `JUDGE_PASSED` → `task.approve {project,key}` → confirm `DONE`. |
| **implementer** | `TODO` | `task.claim` (phải claim để giữ lease) → `task.transition {from:TODO,to:IN_PROGRESS}` → `task.transition {from:IN_PROGRESS,to:IMPLEMENTED}`. |
| **runner** | `IMPLEMENTED` | `evidence.submit {build_exit:0,test_exit:0,ac_exit:0,manifest_json:"{\"files\":{\"noop.txt\":\"<sha1>\"}}"}`. (Chỉ vậy — không transition.) |
| **self-check** | `IMPLEMENTED` **+ evidence tồn tại** | poll `task.get`==IMPLEMENTED **và** `evidence.get` trả record (đợi runner) → `task.selfcheck {project,key}` → confirm `SELF_CHECK_PASSED`. |
| **judge** | `SELF_CHECK_PASSED` | `comment.add {kind:"verdict",verdict:"PASS",body_md:"...VERDICT: PASS"}` → `task.transition {from:SELF_CHECK_PASSED,to:JUDGE_PASSED}`. |

**Bẫy đã gặp & cách tránh:**
- `task.transition` **bắt buộc field `from`** (state hiện tại); gate cũng re-validate vs state thật.
- Gate **lease guard**: implementer phải `task.claim` trước các forward transition (non-human/non-gate).
- `evidence.get` trả object **ở top-level** (không bọc trong key `evidence`) → probe "có evidence chưa" phải check đúng shape, nếu không self-check sẽ poll mãi.
- `task.selfcheck` trả `{success, reason}` (KHÔNG trả state) → đọc lại `task.get` để xác nhận `SELF_CHECK_PASSED`.
- `allow_no_code_change:true` lúc create để guard IMPLEMENTED pass mà không cần gitref (task demo/không có diff).
- self-check cần evidence của runner trước → cho self-check đợi cả state lẫn evidence (đừng để nó self-check sớm → FAILED).

## 4. Giám sát độc lập (read-only, human token) — đừng tin lời subagent

```bash
# Theo dõi state đổi tới DONE (dùng Monitor hoặc background bash với until-loop):
prev=""; for i in $(seq 1 140); do
  S=$(AKA_TOKEN=<HUMAN_SECRET> node <repo>/_aka-mcp-cli.mjs task.get '{"project":"<slug>","key":"<key>"}' \
      2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('state',''))" 2>/dev/null)
  [ "$S" != "$prev" ] && [ -n "$S" ] && { echo "state=$S"; prev="$S"; }
  [ "$S" = "DONE" ] && { echo FINAL=DONE; break; }; sleep 2
done
```

## 5. Xác minh (đây mới là bằng chứng — đọc dữ liệu server đóng dấu)

```bash
# History đầy đủ: actor_role + actor_token_id mỗi transition/comment/evidence
curl -s -H "Authorization: Bearer <HUMAN_SECRET>" \
  "http://127.0.0.1:<PORT>/api/tasks/<key>?project=<slug>" | python3 -c "
import sys,json; d=json.load(sys.stdin); t=d.get('task',d)
print('FINAL', t.get('state'))
for x in d.get('timeline',[]): print(x.get('from_state'),'->',x.get('to_state'),x.get('actor_role'),x.get('actor_token_id'))
for c in d.get('comments',[]): print('comment',c.get('kind'),c.get('verdict'),c.get('author_role'),c.get('author_token_id'))
"
# Token: 5 id phân biệt + last_used_at (mỗi secret tự authenticate)
curl -s -H "Authorization: Bearer <HUMAN_SECRET>" http://127.0.0.1:<PORT>/api/tokens
```

### Checklist "đây là N tác nhân thật, không phải 1 con giả số liệu"
- [ ] N lời gọi Agent tách rời (hiện trong transcript), mỗi prompt chỉ 1 token.
- [ ] `last_used_at` của N token đều riêng & lệch thời điểm → mỗi secret tự authenticate.
- [ ] Mỗi transition mang `actor_token_id` đúng = token của role đó; ≥N token_id phân biệt.
- [ ] Có **độ trễ chờ-đúng-lượt** thật (vd runner đợi IMPLEMENTED, human đợi JUDGE_PASSED).
- [ ] **Negative**: role sai bị server chặn (`Role 'X' is not permitted to perform 'Y'`) — vd implementer/runner thử approve → reject.
- [ ] Final `DONE` chỉ do **human** token; verdict=PASS do **judge** token; evidence do **runner** token (khác implementer).

## 6. Dọn dẹp
```bash
rm -f <repo>/_aka-mcp-cli.mjs            # giữ git sạch
pkill -f "DB_PATH=/tmp/<run>.db"         # tắt server tạm
# (DB /tmp/<run>.db giữ lại nếu cần soi history; xoá khi xong)
```

---
**Liên quan:** `docs/CONNECT_MCP.md` (token theo role + tool surface) · `server/src/auth/authorize.ts` (ma trận role→quyền) · `scripts/role-subagents-e2e/` (bản gate-verifiable: scripted self-test + verifier + RUNBOOK).
