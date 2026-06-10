---
description: Run the Judge stage for a task (independent adversarial review).
argument-hint: <TASK-ID>
---

Run judge review for task **$ARGUMENTS**.

Delegate to the `judge` subagent (Agent tool, `subagent_type: "judge"`). The subagent inherits this session's model — for model independence, run this command in a separate terminal set to a different model than `/impl` used (see the workflow README). Instruct it to:

1. Read `.ai/tasks/$ARGUMENTS/$ARGUMENTS.md`, the machine evidence under `.ai/evidence/$ARGUMENTS/`, and the **real diff inside each per-repo worktree** — the task code is on the task branch, not the main checkout. Get paths via `.ai/scripts/gate.sh worktrees $ARGUMENTS` and the per-repo base from `.ai/state/$ARGUMENTS.json`, then `git -C <worktree> diff <base_sha>` + `git -C <worktree> status --porcelain` for each repo.
2. Treat prior agents' reports as claims to verify, not truth. Inspect the tests in the diff for tautologies / skips / deletions.
3. Write `.ai/reports/$ARGUMENTS/judge.md` starting with `VERDICT: PASS` or `VERDICT: REJECT`, with per-AC rulings and evidence references.
4. Record the verdict via `.ai/scripts/gate.sh propose $ARGUMENTS SELF_CHECK_PASSED JUDGE_PASSED|JUDGE_REJECTED judge`.

When done, report the verdict and resulting state. Remind the human that only they can mark the task DONE via `.ai/scripts/gate.sh approve $ARGUMENTS`.
