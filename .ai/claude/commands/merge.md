---
description: Merge a task's worktree branch into the current branch (auto-resolve conflicts), then drop the worktree/branch. Keeps the task.
argument-hint: <TASK-ID>
---

Merge the worktree branch of task **$ARGUMENTS** into the current branch of each repo, then remove the worktree + branch. **Do not remove or reset the task** — its spec/state/evidence/reports stay.

The deterministic git lifecycle is owned by `gate.sh`; your only job in the conflict case is to resolve conflicts inside the integration worktree it sets up. Never touch git in a repo's main checkout yourself.

Steps:

1. Run `.ai/scripts/gate.sh merge $ARGUMENTS`.
   - **Exit 0** → every repo merged cleanly and the task worktree/branch were removed. Report the result and stop.
   - **Exit 2** (`MERGE_CONFLICT`) → continue below. Any cleanly-merged repos are already done; only the conflicting repos need resolution.

2. Read the integration worktrees from state: `jq '.merge.repos' .ai/state/$ARGUMENTS.json`. For each repo whose `mode` is `"integrating"`, its `integ_wt` is the integration worktree path (relative to repo root). For each such worktree:
   - Inspect conflicts: `git -C <integ_wt> status` and `git -C <integ_wt> diff --diff-filter=U`.
   - Resolve every conflicted file by editing it — produce the correct merged result, removing all `<<<<<<<`/`=======`/`>>>>>>>` markers. Preserve the intent of **both** sides; do not blindly take one side. If a resolution is genuinely ambiguous or risky, stop and ask the user instead of guessing.
   - `git -C <integ_wt> add -A` then `git -C <integ_wt> commit --no-edit` to complete the merge commit.

3. Run `.ai/scripts/gate.sh merge-finish $ARGUMENTS`. This fast-forwards each current branch onto the resolved integration branch, removes the integration worktrees, removes the task worktree/branch, and keeps the task.

4. Report: final `.ai/scripts/gate.sh state $ARGUMENTS` (stays `DONE`), which repos merged cleanly vs. needed conflict resolution, and confirm the worktree/branch were removed and the task was kept.

Notes:
- `gate.sh merge` requires state `DONE` (human-approved). If it isn't, report that and stop.
- If `gate.sh` rejects a precheck (dirty main checkout, uncommitted worktree, etc.), surface the exact message — do not try to work around it.
