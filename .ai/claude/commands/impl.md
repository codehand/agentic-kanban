---
description: Run the Implementer stage for a task (delegates to the implementer subagent).
argument-hint: <TASK-ID>
---

Implement task **$ARGUMENTS** using the workflow.

Delegate the actual work to the `implementer` subagent (do not implement it yourself in the main thread). Spawn it with the Agent tool, `subagent_type: "implementer"`, and instruct it to:

1. Read `.ai/tasks/$ARGUMENTS/$ARGUMENTS.md` (note the `Repos:` and `Branch:` lines) and `.ai/tasks/$ARGUMENTS/$ARGUMENTS.ac.sh` (if present).
2. Enter `IN_PROGRESS` first (this creates the per-repo branch + worktree), then run `.ai/scripts/gate.sh worktrees $ARGUMENTS` to get the worktree paths.
3. Implement the change and add/extend real tests as required — **entirely inside the worktree(s)**, never in any repo's main checkout. Commit the work onto the task branch.
4. Write `.ai/reports/$ARGUMENTS/implementer.md`.
5. Advance state via `.ai/scripts/gate.sh` to `IMPLEMENTED`.

When the subagent returns, report the final state (`.ai/scripts/gate.sh state $ARGUMENTS`) and a short summary. Do not claim the task is verified or done — that is not this stage's job.
