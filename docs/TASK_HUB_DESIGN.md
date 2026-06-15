# Task Hub — Agentic Kanban MCP Server (Bản thiết kế)

> Trạng thái: **DESIGN — chờ chốt để scaffold**
> Cập nhật: 2026-06-08
> Liên quan: kế thừa & centralize hoá `WORKFLOW_DESIGN.md`.

## 0. Một câu

Một **MCP server tập trung** đóng vai trò *gate có thẩm quyền* + *kho kanban* cho workflow trong
`WORKFLOW_DESIGN.md`. Các agent (chạy trong sandbox / trên device khác nhau, manual hoặc auto)
**connect tới** server này để nhận task, chuyển state, comment, nộp evidence; human review + approve
qua một web UI nhẹ. **Server KHÔNG chứa logic agent** — chỉ là nơi điều phối + lưu trữ + cưỡng chế luật.

## 1. Nguyên tắc nền (kế thừa từ WORKFLOW_DESIGN)

1. **Không agent nào tự xác nhận hoàn thành.** Agent *đề xuất*; **server (gate)** mới ghi state/evidence.
2. **Evidence là sự thật do máy đo, immutable.** Chỉ role `runner` được nộp; ghi xong là khoá, có checksum.
3. **Mỗi vai = quyền tách biệt, cưỡng chế phía server.** Token theo role quyết định ai làm được gì —
   không dựa vào kỷ luật người chạy như bản local đa-terminal.
4. **AC ưu tiên dạng máy chấm được** (exit code), không phải câu văn.
5. **Code task ở git remote, không ở server.** Server lưu *con trỏ* (branch/base/head/MR URL), không ôm code.

### Điểm khác bản local (do phân tán sinh ra)
- Cưỡng chế chuyển sang **phía server** (token role) thay cho OS hook + file 0444 trên một máy.
- Thêm **claim/lease/heartbeat** để nhiều agent đa-device không giành nhau một task.
- "Worktree guard" (main sạch + code trong worktree) — kiểm tra git *local* không dịch lên server được;
  thay bằng đảm bảo **"branch đã push lên remote, `head_sha` vượt `base_sha`"** (server verify hoặc tin
  attestation của runner). Yếu hơn bản local một chút — chấp nhận, đánh đổi để phân tán.

## 2. Phạm vi & triển khai

- **Multi-project**: nhiều board, mỗi board một project/repo-set. Một human operator duy nhất.
- **Mạng**: localhost hoặc LAN. Transport MCP = **Streamable HTTP** (remote-capable cho sandbox/device khác).
- **Stack**: **TypeScript** (Node) + `@modelcontextprotocol/sdk` + **SQLite** (`better-sqlite3`).
  Một process phục vụ cả (a) MCP endpoint, (b) read JSON API + web UI tĩnh.
- **Lộ trình**: **standalone trước** — Task Hub + UI chạy độc lập, test bằng MCP client; SAU đó mới sửa
  `.ai/gate.sh` + `run-evidence.sh` thành thin client gọi server (mục 12).

## 3. Auth & Roles (token theo role)

Single-user nên auth tối giản: **bearer token**, mỗi token gắn một **role** (và optionally giới hạn project).

| Role | Được phép (server cưỡng chế) |
|------|------------------------------|
| `human` | approve→DONE, reset/remove, mint/revoke token, đọc tất cả |
| `implementer` | claim task, `TODO→IN_PROGRESS→IMPLEMENTED`, comment narrative, set gitref, push+tạo Draft MR |
| `self-check` | trigger evidence run, không sửa code; `IMPLEMENTED→SELF_CHECK_*` (gate tự chấm từ evidence) |
| `judge` | `SELF_CHECK_PASSED→JUDGE_*`, comment verdict (PASS/REJECT) |
| `runner` | **CHỈ** `evidence.submit` — không transition, không comment |

- **Bootstrap**: lần chạy đầu đọc `ADMIN_TOKEN` từ env/config → tạo token `human`.
- Human mint token scoped cho từng role/agent qua UI hoặc CLI (`token.mint role=implementer project=X`).
- Server từ chối mọi tool-call mà role không có quyền → đây là lớp chống self-certify trung tâm.

## 4. Data model (SQLite)

```
project(id, slug, name, created_at)

task(id, project_id, key,            -- key = TASK-001 (unique trong project)
     title, body_md,                 -- spec: Purpose/Scope/AC/DoD
     state,                          -- enum state machine (mục 5)
     allow_no_code_change,           -- bool, do người tạo task đặt
     assignee_token_id, lease_until, -- claim/lease (mục 11)
     created_at, updated_at)

transition(id, task_id, from_state, to_state, actor_role, actor_token_id,
           note, evidence_id, at)    -- append-only audit log

comment(id, task_id, author_role, author_token_id,
        kind,                        -- 'narrative' | 'verdict' | 'review' | 'note'
        verdict,                     -- 'PASS' | 'REJECT' | NULL  (chỉ khi kind=verdict)
        body_md, created_at)

evidence(id, task_id, submitted_by_token_id,  -- token PHẢI role=runner
         build_exit, test_exit, lint_exit, ac_exit, coverage_pct,
         manifest_json,              -- {file: sha256} + log digests, immutable
         logs_json,                  -- digest/đường dẫn log (không ôm full nếu lớn)
         created_at)                 -- bản ghi mới = lần run mới; gate dùng bản mới nhất

gitref(id, task_id, repo,            -- multi-repo: nhiều dòng / task
       branch, base_sha, head_sha, mr_url, mr_state, updated_at)

token(id, role, project_id NULL, label, secret_hash, created_at, revoked_at)
```

`evidence` & `transition` **append-only** (không UPDATE/DELETE). `gitref` cập nhật được (head_sha, mr_url đổi).

## 5. State machine = Kanban

State giữ nguyên WORKFLOW_DESIGN; map sang cột kanban cho human dễ nhìn:

```
TODO ──claim/impl──> IN_PROGRESS ──> IMPLEMENTED ──> SELF_CHECK_PASSED ──> JUDGE_PASSED ──> DONE
                          ▲                │  └────────> SELF_CHECK_FAILED ─┐
                          │                └──(gate guard reject)          │
                          └──────────────── JUDGE_REJECTED <───────────────┘
                                   (rework: *_FAILED / *_REJECTED → IN_PROGRESS)
```

| Cột UI | State |
|--------|-------|
| Backlog | `TODO` |
| In Progress | `IN_PROGRESS`, `IMPLEMENTED` |
| Self-Check | (đang chạy / `SELF_CHECK_FAILED`) |
| Judge Review | `SELF_CHECK_PASSED`, `JUDGE_REJECTED` |
| Awaiting Human | `JUDGE_PASSED` |
| Done | `DONE` |

**Bảng transition hợp lệ + role** (server cưỡng chế, từ chối nhảy cóc):

```
TODO              -> IN_PROGRESS        : implementer
IN_PROGRESS       -> IMPLEMENTED        : implementer   (guard: gitref có head_sha>base_sha, hoặc allow_no_code_change)
IMPLEMENTED       -> SELF_CHECK_PASSED  : self-check via gate  (gate tự chấm từ evidence + checksum)
IMPLEMENTED       -> SELF_CHECK_FAILED  : self-check via gate
SELF_CHECK_FAILED -> IN_PROGRESS        : implementer
SELF_CHECK_PASSED -> JUDGE_PASSED       : judge         (đòi comment kind=verdict verdict=PASS + checksum khớp)
SELF_CHECK_PASSED -> JUDGE_REJECTED     : judge         (đòi verdict=REJECT)
JUDGE_REJECTED    -> IN_PROGRESS        : implementer
JUDGE_PASSED      -> DONE               : human         (KHÔNG auto-merge MR)
```

## 6. MCP tools (API surface)

Đọc:
- `project.list` / `project.create`
- `task.list(project, state?)` / `task.get(key)` / `task.next(project, role)` — pull cho agent auto
- `comment.list(task)` / `evidence.get(task)` / `gitref.list(task)`

Ghi (server check role + state trước khi thực thi):
- `task.create(project, title, body_md, repos[], allow_no_code_change?)`
- `task.claim(key)` / `task.heartbeat(key)` / `task.release(key)` — leasing (mục 11)
- `task.transition(key, from, to, note?)` — validate role + bảng mục 5
- `gitref.set(key, repo, branch, base_sha, head_sha, mr_url?, mr_state?)`
- `comment.add(key, kind, body_md, verdict?)`
- `evidence.submit(key, build_exit, test_exit, lint_exit, ac_exit, coverage_pct, manifest_json, logs_json)` — **runner only**
- `task.selfcheck(key)` — gate tự đọc evidence mới nhất + checksum → set `SELF_CHECK_PASSED|FAILED` (giống `gate.sh selfcheck`)
- `task.approve(key)` — **human only** → DONE

> `task.selfcheck` và `task.transition(→JUDGE_*)` re-verify checksum của evidence trước khi đổi state —
> tái lập đúng `verify_checksums` của bản local.

## 7. Luồng evidence (chống bịa — quan trọng nhất)

1. Agent/runner build+test **local** trong worktree (server không chạy code, không biết stack từng repo).
2. Runner gom kết quả → `evidence.submit` bằng **token role=runner**. Implementer/judge KHÔNG submit được
   (server từ chối theo role) — đây là lớp tách "evidence vs agent".
3. Server ghi `evidence` row immutable + `manifest_json` (sha256 từng file/log). Sửa lén → checksum lệch →
   `task.selfcheck`/judge reject.
4. `task.selfcheck` đọc evidence **mới nhất**: build/test/ac luôn hard-required; lint/coverage theo config
   project (optional→cảnh báo, required→chặn). Hệ quả: "tests passed" = `test_exit==0` do runner ghi, agent không giả.

## 8. Comment & Verdict

- Comment có `author_role` + `kind`. Narrative (implementer/self-check) = `kind=narrative`.
- **Verdict** của judge = `kind=verdict` + `verdict=PASS|REJECT` (structured) → server parse trực tiếp,
  thay cho `grep 'VERDICT: PASS'`. Transition `→JUDGE_*` đòi đúng comment verdict tương ứng tồn tại.
- Human review = `kind=review` (ghi chú trước khi approve/reset).
- Timeline mỗi task = chuỗi comment + transition theo thời gian, hiển thị trong UI.

## 9. Human review flow + Web UI (nhẹ)

UI = trang tĩnh + read JSON API (cùng process). Tối thiểu:
- **Board view**: cột theo mục 5, card = task (key, title, assignee, lease status).
- **Task detail**:
  - Spec (body_md), AC.
  - **gitref**: mỗi repo → branch, base..head, **link MR** (mr_state).
  - **Evidence**: build/test/lint/ac exit + coverage%, link/log digest, checksum status.
  - **Timeline**: comment (narrative/verdict/review) + transition history.
  - **Nút Approve** (chỉ hiện khi state=JUDGE_PASSED, gọi `task.approve`, cần token human). Nút Reset/Reject.
- Approve **không** merge MR — chỉ set DONE; human tự merge từng MR.

## 10. Git / MR integration (multi-repo)

- Một task có thể đụng **N repo** (giữ tinh thần multi-repo của WORKFLOW_DESIGN). `gitref` nhiều dòng/task.
- **Implementer**: trong worktree mỗi repo → commit lên branch task → **push lên remote** → tạo **Draft MR** →
  `gitref.set(... mr_url ...)`. Human review + **merge tay** (approve không auto-merge).
- Server chỉ lưu URL + sha; không gọi git host API ở v1 (implementer tự tạo MR). Có thể thêm verify
  `head_sha` tồn tại trên remote sau.

## 11. Concurrency: claim / lease / heartbeat

- `task.claim(key)`: chỉ thành công nếu task chưa bị lease (hoặc lease hết hạn). Gắn `assignee_token_id` + `lease_until`.
- `task.heartbeat(key)`: gia hạn `lease_until` (agent đang chạy gọi định kỳ). TTL đề xuất **15 phút**, heartbeat mỗi **5 phút**.
- `task.release(key)`: nhả sớm. Lease hết hạn → task tự mở lại cho agent khác claim.
- Transition đòi caller đang giữ lease (trừ human/gate). Chống 2 implementer đa-device cùng làm một task.

## 12. Tích hợp với engine `.ai/` (sau khi server standalone xong)

- `gate.sh` → thin client: `propose/selfcheck/approve` gọi MCP tool tương ứng (giữ CLI cho người quen dùng).
- `run-evidence.sh` → vẫn build/test **local trong worktree**, nhưng thay vì ghi `.ai/evidence/*` + manifest
  local, nó `evidence.submit` lên server bằng token `runner`.
- `new-task.sh` / `/newtask` → `task.create` trên server (vẫn có thể giữ bản file cho offline).
- Hook `guard-protected-paths.sh` thành thừa với phần evidence (server đã cưỡng chế theo role) — giữ lại
  cũng vô hại.

## 13. Giới hạn đã biết (nói thẳng)

- Server **không chạy code** → tin `runner` về tính trung thực của build/test. Bảo vệ = tách credential
  (implementer không có token runner) + checksum, KHÔNG phải re-run. Nếu cùng một tác nhân nắm cả 2 token thì
  vẫn bịa được — kỷ luật cấp token là trách nhiệm human.
- "Code trong worktree, main sạch" không cưỡng chế được từ xa → hạ xuống "branch push remote, head>base".
- Single-user/LAN: auth tối giản, **không** dành cho internet công khai (không TLS/RBAC ở v1).
- Cùng họ model vẫn correlated blind-spot phần ngữ nghĩa → human review vẫn cần (như bản local).

## 14. Success Criteria

- [ ] Agent đa-device connect 1 server, nhận/chuyển task qua MCP.
- [ ] Role cưỡng chế phía server: implementer không submit evidence / không set JUDGE_*/DONE.
- [ ] Evidence immutable + checksum; chỉ runner ghi.
- [ ] Verdict structured; transition đòi đúng evidence + verdict.
- [ ] Human approve qua UI (chỉ human set DONE); UI show MR link + ref + evidence.
- [ ] Lease chống 2 agent giành 1 task.
- [ ] Standalone chạy được trước khi đụng `.ai/`.
```
