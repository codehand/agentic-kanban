---
description: One HUMAN-approver iteration — merge a judge-passed task and approve to DONE (designed for /loop).
argument-hint: [project-slug]
---

You act as the HUMAN approver for project **$ARGUMENTS** (if blank, use slug `demo`) on MCP server
`taskhub` (human token). Read the `aka-kanban` skill. Run exactly one iteration:

1. **Busy check.** If a merge from the previous iteration is unfinished, finish it.
   Do not pick a new task.
2. **Pick work:** `task.list { state: "JUDGE_PASSED" }`, oldest first — but **skip any
   task you already flagged as blocked**: if `comment.list` shows your own blocker
   note (mismatch/conflict/red tests) for the task's current `head_sha`, move on to
   the next oldest instead of re-failing it every tick. A blocked task only becomes
   eligible again when its `head_sha` changed or a human resolved it.
   Nothing eligible → reply `idle` and end the turn.
3. **Sanity read:** `comment.list` (the judge's PASS verdict must exist) and
   `gitref.list` for branch + shas.
4. **Merge — `task.approve` does NOT merge git, so merge first:**
   - `git checkout master && git fetch origin && git reset --hard origin/master`
     (reset, not pull — a stray merge commit from a previously failed push must not
     survive into this attempt)
   - Verify `origin/fix/<KEY>` exists and its tip matches the registered `head_sha`
     (`git ls-remote origin fix/<KEY>`). **If the branch is missing from origin or the
     tip differs from the judged sha**, do NOT merge or approve:
     `comment.add { kind: "note" }` describing the mismatch, leave the task in
     JUDGE_PASSED, report it, and end the turn. (No transition out of JUDGE_PASSED
     except DONE exists, so this needs the operator: reset the task via the web UI /
     `POST /api/tasks/:key/reset` to send it back to IN_PROGRESS — say so in your
     report.)
   - `git merge --no-ff <head_sha>` (merge the judged sha, not the branch name)
   - **Conflict:** abort the merge (`git merge --abort`), do NOT force anything,
     `comment.add { kind: "note" }` describing the conflict, leave the task in
     JUDGE_PASSED (step 2 will skip it next tick), and end the turn.
   - Run the project's test command on merged master. Green → `git push origin master`.
     **Red tests:** reset master to `origin/master`, comment the failure as a blocker
     note, leave the task in JUDGE_PASSED, end the turn.
   - **If the push of master fails:** non-fast-forward → `git pull --rebase` is NOT
     safe on a merge commit; instead reset master to `origin/master`, redo the merge,
     push again. Origin unreachable → reset master to `origin/master` (the merge
     commit is reproducible from the judged sha), comment the error, leave the task in
     JUDGE_PASSED, end the turn; the next tick redoes merge + push. **Never
     `task.approve` unless the merged master is confirmed on origin.**
5. **Finalize:**
   - `gitref.set` updating `mr_state: "merged"` (if the server rejects this for the
     human role, skip it silently).
   - `comment.add { kind: "note", body_md: "merged into master at <sha>" }`.
   - `task.approve { project, key }` → DONE.

Report the task key, the merge commit sha, and the final state.
