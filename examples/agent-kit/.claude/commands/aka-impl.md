---
description: One IMPLEMENTER iteration against the taskhub MCP server (designed for /loop).
argument-hint: [project-slug]
---

You are the IMPLEMENTER for project **$ARGUMENTS** (if blank, use slug `demo`) on MCP server `taskhub`.
Read the `aka-kanban` skill for states, guards, and lease rules. Run exactly one iteration:

1. **Busy check — ask the hub, not your memory** (a restarted session remembers
   nothing, but the lease lives on the server, bound to this token):
   `task.list { state: "IN_PROGRESS" }` — if a task is assigned to you, that is your
   task. `task.heartbeat` first, then **rebuild from origin, not from the local
   tree** — `git fetch origin`; if `origin/fix/<KEY>` exists, hard-reset your branch
   to it (any local-only work from a dead sandbox is gone — that is expected). Read
   `comment.list` for your own last narrative to find where you stopped, resume the
   work below from there. Do not pick a new task.
2. **Pick work**, in priority order (oldest first):
   - `task.list { state: "SELF_CHECK_FAILED" }` — rework. Read `comment.list` and
     `evidence.get` for the failure reason, `task.claim`, transition → IN_PROGRESS.
   - `task.list { state: "JUDGE_REJECTED" }` — rework. Read the judge's verdict comment,
     `task.claim`, transition → IN_PROGRESS.
   - `task.next` — fresh TODO. `task.claim`, then `task.transition TODO → IN_PROGRESS`.
   - Nothing found → reply `idle` and end the turn.
3. **Preflight — clean tree + fresh master (required before branching):**
   - `git status --porcelain` must be empty. If the tree is dirty (leftovers from a
     dead run), discard everything: `git checkout -- . && git clean -fd` — per the
     sandbox rule, anything not pushed to origin is already considered lost, so never
     let stray changes leak into a new task branch.
   - Sync master: `git checkout master && git fetch origin && git reset --hard
     origin/master`. The new branch MUST fork from the latest origin tip — a stale
     base causes merge conflicts at the human stage and a wrong `base_sha` diff for
     the judge.
4. **Implement** (fresh task):
   - Record `base_sha` = the `origin/master` sha from preflight. Create branch
     `fix/<KEY>` from it.
   - For rework, check `gitref.list` then `git ls-remote origin fix/<KEY>`:
     - **Branch exists on origin** → reuse it and continue on top. Do NOT rebase it
       onto a newer master: the hub cannot update `base_sha` on an existing gitref,
       so a rebase pollutes the `base_sha..head_sha` diff the judge reviews. Master
       catching up is the human stage's problem, not yours.
     - **Branch missing from origin** (a previous sandbox died before pushing — this
       is why the task came back) → restart from scratch: create `fix/<KEY>` from the
       **original `base_sha` recorded in the gitref** (a former master tip, always on
       origin) — NOT from current master, for the same base_sha-is-immutable reason.
       Re-implement, and this time push before anything else.
   - Implement exactly what `body_md` specifies, including real tests covering the AC.
     Run build + tests locally until green.
   - **Commit and push early and often.** This sandbox is ephemeral: an unpushed
     commit is a lost commit. If you must end the iteration before finishing, commit
     WIP, push, and `comment.add { kind: "narrative" }` noting where you stopped.
5. **Register and hand off — push BEFORE every hub update:**
   - `git push origin fix/<KEY>` and confirm it succeeded; `head_sha` below must be
     the sha now present on origin (verify with `git ls-remote origin fix/<KEY>`).
   - `gitref.set { repo: "<repo-name>", branch: "fix/<KEY>", base_sha, head_sha }` —
     required: the IMPLEMENTED guard rejects without it.
   - `comment.add { kind: "narrative" }` — what changed, how to verify.
   - `task.transition IN_PROGRESS → IMPLEMENTED`, then `task.release`.
   - Never transition to IMPLEMENTED with an unpushed sha — self-check fetches from
     origin and will fail the task if the sha is not there.
6. **If the push fails:**
   - Non-fast-forward (someone updated `fix/<KEY>` on origin): `git fetch origin`,
     rebase your work onto `origin/fix/<KEY>`, push again.
   - Origin unreachable (network/auth): STOP the hand-off — no `gitref.set`, no
     transition. Keep the lease (`task.heartbeat`), `comment.add { kind: "narrative" }`
     with the push error, report it, end the turn. Next iteration the busy check
     resumes this task and retries the push. The work survives locally only until the
     sandbox dies, so retrying the push is always the top priority on resume.

Never call selfcheck/judge/approve tools. Never push to master.
Report which task you worked and its final state.
