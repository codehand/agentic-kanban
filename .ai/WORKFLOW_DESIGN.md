# AI Development Workflow — Bản thiết kế chốt

> Trạng thái: **DESIGN LOCKED — đã implement worktree-isolation + multi-repo**
> Cập nhật: 2026-06-08
> Mục tiêu: workflow dev local có AI, **không agent nào được tự xác nhận hoàn thành**. Tách bạch implementation / validation / approval để diệt false-positive completion (AI báo "xong" trong khi acceptance criteria chưa thực sự đạt).

---

## 0. Nguyên tắc nền (xuyên suốt)

1. **Không tin lời agent — chỉ tin cái script đo được.** Agent *đề xuất*, **script (gate)** mới được ghi state và evidence.
2. **Evidence là read-only với agent.** Test/build do runner tất định chạy → ghi file → agent chỉ đọc, không sửa.
3. **Mỗi vai = context tách biệt.** Subagent luôn có context riêng (không thấy lý lẽ nội bộ agent trước → chống anchoring). Model **inherit** từ session; muốn Judge khác model thì chạy đa-terminal (xem mục 1).
4. **AC ưu tiên dạng lệnh chạy được**, không phải câu văn.
5. **Code task bị CÔ LẬP trong worktree.** Mỗi task làm trên branch riêng + git worktree (một cái cho MỖI repo task đụng). Checkout chính của mọi repo phải luôn sạch — code task không được rò ra main tree. Build/test/verify đều chạy bên trong worktree (xem mục 1b).

---

## 1. Quyết định thiết kế đã chốt

- **Evidence:** Hook/script tự chạy, agent chỉ đọc (read-only).
- **Judge model:** subagent **không khai báo `model`** → kế thừa model của session gọi nó (`inherit`). Tính độc lập về model đạt được bằng **vận hành đa-terminal (paranoid mode)**: chạy `/impl` + `/selfcheck` ở một session, chạy `/judge` ở session/terminal khác đặt model khác tier. Không hard-code model → portable; nhưng độc lập-model phụ thuộc kỷ luật người chạy (xem README). Trụ chống gian lận thật sự vẫn là **gate tất định**, không phụ thuộc model.
- **Gate là script tất định**, không phải AI — là thực thể duy nhất được ghi `state/` và `evidence/`.
- **KHÔNG fast path.** Mọi task — kể cả nhỏ — đều đi đủ pipeline `IMPLEMENTED → SELF_CHECK → JUDGE → HUMAN`. Không có ngoại lệ, không bỏ Judge. (Bỏ field `risk` khỏi thiết kế.)
- **Lint + coverage threshold = optional, điều khiển bằng config.** Hiện tại gate đọc `config.yml` để quyết định lint/coverage là `required` hay `optional`. Mặc định `optional` (gate ghi cảnh báo nhưng không chặn). Về sau đổi thành `required` chỉ bằng cách sửa config — không phải sửa code gate.
- **Runner = dùng `test-report` skill.** `run-evidence.sh` tái dùng đúng các lệnh tất định của skill `test-report` (`go test ./... -count=1 -coverprofile=...` + `go tool cover -func`) và trỏ evidence vào output của nó — nhưng chạy **per-repo, bên trong worktree** (xem mục 1b).
- **Worktree-isolation + multi-repo (1 task = N repo).** Một task có thể đụng nhiều git repo độc lập (workspace nhiều repo). Engine không còn giả định "gốc `.ai/` = 1 git repo = 1 module". Task khai báo `Repos:`; gate tạo branch + worktree cho từng repo. **Branch không tự merge khi `approve`** — con người tự mở MR/merge.

---

## 1b. Worktree-isolation & multi-repo

**Khai báo (nguồn sự thật trong task md):**
- `Repos: <r1> <r2> …` — danh sách repo (path tương đối gốc `.ai/`) mà task đụng. Mặc định `.` (repo đơn).
- `Branch: fix/<TASK>-<slug>` — một tên branch **dùng chung cho mọi repo** của task (slug do AI sinh từ title lúc `/newtask`).

**Vòng đời (gate tất định lo, agent không chạm git lifecycle):**

| Mốc | Gate làm gì |
|-----|-------------|
| `TODO → IN_PROGRESS` | Mỗi repo: tạo branch `fix/<TASK>-<slug>` từ **HEAD của branch hiện tại** (lưu `base_sha`/`base_ref`), `git worktree add` vào `<repo>/.claude/worktree/<branch>`, thêm `.claude/worktree/` vào `<repo>/.git/info/exclude`. Ghi `branch` + `repos{base_sha,base_ref,wt}` vào `state/<TASK>.json`. Rework (quay lại IN_PROGRESS) **tái dùng** worktree đã có. |
| Implementer làm việc | `gate.sh worktrees <TASK>` in ra path; implementer **chỉ** sửa + commit trong các worktree đó. |
| `IN_PROGRESS → IMPLEMENTED` | Guard: với mỗi repo (a) checkout chính **sạch** + `HEAD == base_sha` → code task **không** rò ra main tree; (b) worktree **có** thay đổi vs base. Vi phạm (a) hoặc không (b) → **REJECT**. |
| Self-Check / Judge | build/test/cover chạy trong worktree; Judge diff `base_sha..` trong worktree. |
| `approve → DONE` | **KHÔNG** auto-merge. Branch + worktree giữ nguyên để con người mở MR/merge. |
| `merge` (CHỈ sau DONE) | Lệnh tường minh do con người gọi (`/merge` hoặc `gate.sh merge`). Mỗi repo: merge branch worktree → **current branch của checkout chính**. Clean → merge thẳng rồi `git worktree remove` + `branch -D` branch task (**giữ task**). Conflict → `merge --abort` (checkout chính KHÔNG bị bẩn), dựng **integration worktree** `integrate/<TASK>` từ current branch, merge branch task vào đó để conflict ở yên trong worktree đó; agent resolve + commit; `gate.sh merge-finish` FF current branch → integration rồi gỡ integration + worktree/branch task. Xong set `merged=true`, xoá `branch`/`repos`/`merge` khỏi state, **task không bị xoá**. |
| `reset` / `remove` | `git worktree remove` + `branch -D` cho từng repo, xoá `branch`/`repos` khỏi state. |

**Đường dẫn suy ra tất định:** với `(repo, branch)` → worktree = `<repo>/.claude/worktree/<branch>`. Engine chỉ cần đọc `Repos:`/`Branch:` (hoặc `state.repos`) là tìm được mọi thứ.

**Runner ↔ ac.sh:** `run-evidence.sh` export `AI_WT_<REPO>=<đường dẫn worktree>` cho mỗi repo (vd `AI_WT_ROOT`, `AI_WT_OPF_AUTO_E2E`). `ac.sh` neo qua `${AI_WT_<REPO>:-$ROOT/<repo>}` để verify đúng code task trong worktree (fallback checkout chính khi chạy tay).

---

## 2. Kiến trúc & ánh xạ sang Claude Code

| Vai | Cơ chế Claude Code | Model | Quyền ghi |
|-----|--------------------|-------|-----------|
| Implementer | subagent `.claude/agents/implementer.md` | inherit (session chạy `/impl`) | sửa source + đề xuất evidence text |
| SelfCheck | subagent `self-check.md` | inherit (session chạy `/selfcheck`) | **không** sửa source; chạy runner |
| Judge | subagent `judge.md` | inherit (session chạy `/judge` — đặt khác tier) | chỉ đọc; ra verdict |
| Human | người dùng | — | duy nhất được set `DONE` |
| **Gate** (không phải AI) | script `.ai/scripts/gate.sh` + hook | — | **duy nhất được ghi `state.json` và `evidence/*`** |

**Mấu chốt:** mọi chuyển state đi qua Gate. Agent chỉ gọi `gate.sh propose <task> <from> <to>`; gate tự kiểm tra evidence bắt buộc tồn tại + hợp lệ rồi mới ghi.

---

## 3. Luồng evidence (chống bịa — phần quan trọng nhất)

Runner sinh evidence, agent KHÔNG tự "kể" kết quả. `run-evidence.sh` tái dùng đúng lệnh tất định của skill **`test-report`**:

```
.ai/scripts/run-evidence.sh TASK-001
  # đọc repos{wt} từ state -> chạy build/test BÊN TRONG worktree mỗi repo
  for repo in $(Repos):
    export AI_WT_<REPO>=<worktree>           # cho ac.sh neo vào
    (cd <worktree> && go build ./...)        >> build.log        # exit gộp: fail nếu BẤT KỲ repo nào fail
    (cd <worktree> && go test ./... -count=1 -timeout 120s \
        -coverprofile=evidence/TASK-001/coverage-<repo>.out -v)  >> test.log
    (cd <worktree> && go tool cover -func=coverage-<repo>.out)   >> coverage.func.txt
  → build.exit / test.exit = MAX exit qua các repo ; coverage.pct = MIN % qua các repo
  # --- lint (optional theo config) ---
  → golangci-lint run    2>&1 | tee evidence/TASK-001/lint.log ; echo $? > lint.exit
  # --- AC machine-verify (nếu có; ac.sh tự cd vào worktree qua AI_WT_<REPO>) ---
  → ./.ai/tasks/TASK-001/TASK-001.ac.sh                        ; echo $? > ac.exit
  → ghi evidence/TASK-001/manifest.json (sha256 từng file + exit codes + coverage%)
```

> Repo đơn (`Repos: .`): vòng lặp chạy đúng 1 lần trong worktree của repo gốc. Đa repo: `build.exit`/`test.exit` là exit **tổng hợp** (non-zero nếu bất kỳ repo nào fail), `coverage.pct` là **min** các repo, mỗi repo có profile `coverage-<repo>.out` riêng.

Runner cũng có thể gọi trực tiếp `/test-report` để mở HTML cho người xem; nhưng evidence chính thức (dùng cho gate) luôn nằm trong `evidence/TASK-001/` do `run-evidence.sh` ghi, không phải bản trong `.claude/test-reports/`.

- File `evidence/` set read-only sau khi ghi; `manifest.json` chứa **sha256** → agent sửa lén thì checksum lệch, gate reject.
- SelfCheck/Judge **đọc** `*.exit` + log, không được tuyên bố pass/fail trái exit code.
- Hệ quả: "tests passed" = `test.exit == 0` do máy ghi → agent không thể giả.

---

## 4. State machine + điều kiện cưỡng chế

```
TODO ─┬─> IN_PROGRESS ──> IMPLEMENTED
      │   (gate tạo branch+   │  gate đòi: reports/<TASK>/implementer.md + code task NẰM TRONG worktree
      │    worktree mỗi repo) │  (mỗi repo: checkout chính SẠCH & HEAD==base, worktree CÓ diff vs base;
      │                       │   rò ra main tree → REJECT. No-op chỉ qua nếu 'Allow-No-Code-Change: true')
      │                          ▼
      │                   SELF_CHECK_PASSED   ← gate đòi (bắt buộc): build.exit==0 && test.exit==0 && ac.exit==0
      │                          │              và manifest checksum khớp  (build/test = exit gộp qua các repo)
      │                          │              + theo config: lint.exit==0 và coverage ≥ threshold
      │                          │                (mặc định optional → chỉ cảnh báo; đổi 'required' để chặn)
      │                   SELF_CHECK_FAILED   ← bất kỳ exit≠0 → quay lại Implementer
      │                          ▼
      │                   JUDGE_PASSED  ← gate đòi: reports/<TASK>/judge.md có dòng `VERDICT: PASS`
      │                   JUDGE_REJECTED ← quay lại Implementer (kèm lý do)
      │                          ▼
      └─────────────────────>  DONE   ← CHỈ Human; gate chặn nếu actor≠human. KHÔNG auto-merge branch.
```

### Guard "code task phải nằm trong worktree" (thay cho work-fingerprint cũ)
Vào `IN_PROGRESS`, gate tạo branch + worktree cho từng repo và lưu `base_sha`. Khi lên `IMPLEMENTED`, với **mỗi** repo trong `Repos:`, gate đòi:
- (a) checkout chính **sạch** (loại trừ `.ai/ .claude/`) và `HEAD == base_sha` → đảm bảo code task **không** nằm ngoài worktree (không dirty, không commit lén lên branch chính). Vi phạm → **REJECT**.
- (b) worktree **có** thay đổi vs `base_sha` (đã commit lên branch task, hoặc uncommitted) → có làm thật.

Nếu không repo nào có thay đổi → REJECT, trừ khi spec task có dòng `Allow-No-Code-Change: true` (do **người tạo task** đặt — agent không tự cấp được). Cơ chế này thay hẳn work-fingerprint cũ: vừa bắt "implementer chưa làm gì", vừa cưỡng chế cô lập worktree, và hoạt động đúng trên workspace nhiều git repo (mỗi repo kiểm riêng).

Quy tắc gate:
- Từ chối mọi transition không có trong bảng (vd nhảy cóc `IMPLEMENTED → JUDGE_PASSED`).
- Mỗi lần ghi state kèm `actor`, `timestamp`, `evidence_ref`.
- Append vào `state/TASK-001.log` (audit append-only, không xoá).
- **Không fast path:** mọi task bắt buộc qua đủ 4 chặng, gate không cho phép tắt Judge.

### Điều kiện check: required vs optional (đọc từ `config.yml`)

| Check | Mặc định | Khi `optional` | Khi `required` |
|-------|----------|----------------|----------------|
| `build.exit==0` | **required** (cứng) | — | chặn nếu fail |
| `test.exit==0` | **required** (cứng) | — | chặn nếu fail |
| `ac.exit==0` (nếu có `.ac.sh`) | **required** (cứng) | — | chặn nếu fail |
| `lint.exit==0` | optional | ghi cảnh báo, không chặn | chặn nếu fail |
| coverage ≥ threshold | optional | ghi cảnh báo, không chặn | chặn nếu dưới ngưỡng |

> build/test/ac luôn cứng. Lint + coverage điều khiển hoàn toàn bằng config — chuyển sang bắt buộc về sau chỉ cần sửa `config.yml`, không đụng code gate.

### Các state hợp lệ
`TODO, IN_PROGRESS, IMPLEMENTED, SELF_CHECK_PASSED, SELF_CHECK_FAILED, JUDGE_PASSED, JUDGE_REJECTED, DONE`

---

## 5. Cấu trúc thư mục

**Nguyên tắc đóng gói:** toàn bộ "engine" nằm gọn trong `.ai/` (mang đi project khác = copy cả folder `.ai/` rồi chạy `.ai/install.sh`). `install.sh` copy `.ai/claude/{agents,commands}` sang `.claude/` và merge hook vào `.claude/settings.json`. Phần `tasks/ state/ evidence/ reports/` là dữ liệu sinh ra theo từng project (không mang đi).

```
.ai/                        # ====== GÓI ENGINE (copy sang project khác) ======
  install.sh                # chạy 1 lần ở repo đích: sync .claude/ + merge hook
  config.yml                # model từng vai, lệnh build/test/lint, required/optional
  README.md  WORKFLOW_DESIGN.md
  scripts/                  # thực thi (chỉ 2 script này được ghi state/evidence)
    gate.sh                 # validate transition + checksum + worktree lifecycle/guard → ghi state
    run-evidence.sh         # chạy build/test/lint/AC per-repo trong worktree → ghi evidence (tất định)
    new-task.sh             # scaffold task mới (--repos/--branch)
    guard-protected-paths.sh# hook PreToolUse chặn agent ghi evidence/state
  agents/                   # role contracts (tài liệu vai trò)
    implementer.md self-check.md judge.md
  claude/                   # BẢN GỐC — install.sh copy sang .claude/
    agents/    implementer.md self-check.md judge.md   # subagent (kèm model)
    commands/  impl.md selfcheck.md judge.md status.md newtask.md merge.md
    settings.hook.json      # snippet hook để merge vào .claude/settings.json
  # ====== INSTANCE DATA (sinh ra theo project, .gitignore) ======
  tasks/
    TASK-001/               # mỗi task = 1 folder
      TASK-001.md           # spec; có dòng 'Repos:' và 'Branch:'
      TASK-001.ac.sh        # AC (neo qua AI_WT_<REPO> → chạy trong worktree)
  state/
    TASK-001.json           # state hiện tại + branch + repos{base_sha,base_ref,wt} (CHỈ gate ghi)
    TASK-001.log            # audit log append-only
  evidence/                 # CHỈ MÁY GHI (locked 0444 + hook chặn agent)
    TASK-001/ build.* test.* coverage.pct coverage.func.txt coverage-<repo>.out lint.* ac.* manifest.json
  reports/                  # AGENT GHI narrative (được phép sửa)
    TASK-001/ implementer.md self-check.md judge.md

<repo>/.claude/worktree/<branch>/   # WORKTREE mỗi repo (code task; .git/info/exclude bỏ qua; .gitignore)

.claude/                    # ====== SINH RA BỞI install.sh ======
  agents/                   # ← copy từ .ai/claude/agents
  commands/                 # ← copy từ .ai/claude/commands
  settings.json             # ← hook merge từ .ai/claude/settings.hook.json
```

**Hook bắt buộc** (`settings.json` + `.ai/scripts/guard-protected-paths.sh`): `PreToolUse` trên `Edit|Write|MultiEdit|NotebookEdit|Bash` → nếu thao tác **ghi** vào `.ai/evidence/` hoặc `.ai/state/` → **deny**. Ngoại lệ: lệnh Bash gọi `.ai/scripts/run-evidence.sh` / `.ai/scripts/gate.sh` (đây là 2 thực thể tất định duy nhất được ghi). `.ai/reports/` KHÔNG bị chặn — agent ghi narrative ở đó.

> Phân tách then chốt: **`evidence/` = sự thật do máy đo (locked)**, **`reports/` = lời khai của agent**. Gate ra quyết định cứng dựa trên `evidence/manifest.json`, chỉ dùng `reports/judge.md` để đọc verdict ngữ nghĩa.

---

## 5b. `config.yml` (nguồn sự thật cho gate & runner)

```yaml
# .ai/config.yml
models:
  implementer: sonnet
  self_check:  sonnet
  judge:       opus        # bắt buộc khác implementer

commands:                  # runner tái dùng lệnh của skill test-report
  build: "go build ./..."
  test:  "go test ./... -count=1 -timeout 120s -coverprofile={cov} -v"
  lint:  "golangci-lint run"

checks:
  build:    { mode: required }   # cứng, không đổi được qua config
  test:     { mode: required }   # cứng
  ac:       { mode: required }   # cứng (chỉ áp dụng nếu task có .ac.sh)
  lint:     { mode: optional }   # optional → cảnh báo; đổi 'required' để chặn
  coverage: { mode: optional, threshold: 80 }   # % tổng từ `go tool cover -func`

pipeline:
  fast_path: false           # KHÓA — mọi task qua đủ 4 chặng, không bỏ Judge
```

Gate đọc `checks.*.mode`: `required` → fail/dưới ngưỡng thì chặn transition; `optional` → ghi dòng cảnh báo vào `state log` nhưng vẫn cho qua. Nâng cấp về sau = đổi `optional` → `required`, không sửa code.

---

## 6. Task format — AC tách 2 loại

```markdown
# TASK-001: <title>
Repos: opf-auto-e2e api-marketplace   ← repo task đụng (mặc định '.'); gate tạo worktree mỗi repo
Branch: fix/TASK-001-<slug>           ← branch worktree chung mọi repo (slug AI sinh từ title)
## Purpose / Scope / Dependencies / References
## Acceptance Criteria
### Machine-verifiable   ← gate tự chấm qua TASK-001.ac.sh
- [ ] AC1: `go test ./auth/...` pass
- [ ] AC2: coverage auth/ ≥ 80%
### Human/semantic       ← Judge + Human đánh giá
- [ ] AC3: API trả lỗi đúng ngữ nghĩa khi token hết hạn
## Definition of Done
```

Càng đẩy AC xuống nhóm machine-verifiable, false-positive càng khó xảy ra.

---

## 7. Phân vai SelfCheck vs Judge (hết trùng lặp)

- **SelfCheck** = chạy `run-evidence.sh` (build/test/cover per-repo trong worktree), đối chiếu từng AC machine-verifiable với exit code, liệt kê check *chưa chạy được*. Thiên về đo đạc.
- **Judge** (model khác, context sạch) = đọc **diff + task + evidence thô** (KHÔNG đọc lý lẽ Implementer). Diff đọc **trong worktree mỗi repo**: `git -C <worktree> diff <base_sha>` + `status --porcelain` (diff `git` ở gốc workspace là rỗng — code nằm trên branch task). Soi: test có thật không (không tautology/skip), AC ngữ nghĩa có đạt không, có né requirement không. Ra `PASS`/`REJECT` kèm trích dẫn evidence cụ thể.

---

## 8. Vòng đời 1 task (cách chạy thực tế)

```
/impl TASK-001        # gate tạo worktree @IN_PROGRESS → Implementer code TRONG worktree → propose IMPLEMENTED
/selfcheck TASK-001   # chạy run-evidence.sh (per-repo, trong worktree) → gate set PASSED/FAILED theo exit
/judge TASK-001       # Judge (Opus) diff base..branch trong worktree → gate set JUDGE_PASSED/REJECTED
# Human review diff (trong worktree) + .ai/reports/TASK-001/judge.md + .ai/evidence/TASK-001/
.ai/scripts/gate.sh approve TASK-001   # CHỈ người dùng chạy → DONE (KHÔNG auto-merge)
/merge TASK-001                        # (tuỳ chọn, sau DONE) merge branch worktree → current branch mỗi repo;
                                       # conflict → agent resolve trong integration worktree → gate.sh merge-finish;
                                       # xong gỡ worktree/branch task, GIỮ task. Hoặc tự mở MR thay vì /merge.
```

> `/merge` không thay con người mở MR — nó là tiện ích merge-local cho workflow đơn nhánh. Pipeline cốt lõi vẫn dừng ở `approve → DONE`; merge là bước tách rời, tường minh, chỉ chạy được sau DONE.

---

## 9. Giới hạn đã biết (nói thẳng)

- Cùng họ model Claude vẫn còn correlated blind-spot phần *ngữ nghĩa*; khác model chỉ giảm chứ không triệt tiêu → Human review semantic vẫn cần.
- AC viết dở thì máy chấm "pass" mà vẫn sai ý → chất lượng AC là trách nhiệm con người.
- Chi phí: 3 agent + Opus Judge cho **mọi** task → đắt và chậm. Đây là đánh đổi đã chấp nhận: không fast path, ưu tiên độ tin cậy hơn tốc độ.

---

## 10. Success Criteria (đối chiếu mục tiêu gốc)

- [x] Implementer không thể self-approve (gate + hook chặn).
- [x] Mọi task sinh evidence (runner tất định).
- [x] Judge validate độc lập (model khác + context sạch).
- [x] Human là final authority (chỉ Human set DONE).
- [x] False completion report tối thiểu hoá (evidence read-only + checksum + state machine cưỡng chế).
