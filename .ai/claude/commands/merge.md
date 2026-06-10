---
description: Push a task's worktree branch to origin and open a PR into master per repo (human merges on the git server). On conflict, resolve in the integration worktree. Keeps the task and the local worktree/branch.
argument-hint: <TASK-ID>
---

Push the worktree branch of task **$ARGUMENTS** to origin and open a PR into `master` for each repo. A human merges the PR on the git server. **Do not remove or reset the task** — its spec/state/evidence/reports stay, and the local worktree/branch are kept.

The deterministic git lifecycle is owned by `gate.sh`; your only job in the conflict case is to resolve conflicts inside the integration worktree it sets up. Never touch git in a repo's main checkout yourself.

Steps:

1. Run `.ai/scripts/gate.sh merge $ARGUMENTS`.
   - **Exit 0** → every repo was pushed and a PR into `master` was opened. Report the PR URL(s) and stop.
   - **Exit 2** (`MERGE_CONFLICT`) → continue below. Any mergeable repos already have their PR opened; only the conflicting repos need resolution.

2. Read the integration worktrees from state: `jq '.merge.repos' .ai/state/$ARGUMENTS.json`. For each repo whose `mode` is `"integrating"`, its `integ_wt` is the integration worktree path (created **off `origin/master`**, with the task branch merged in). For each such worktree:
   - Inspect conflicts: `git -C <integ_wt> status` and `git -C <integ_wt> diff --diff-filter=U`.
   - Resolve every conflicted file by editing it — produce the correct merged result, removing all `<<<<<<<`/`=======`/`>>>>>>>` markers. Preserve the intent of **both** sides; do not blindly take one side. If a resolution is genuinely ambiguous or risky, stop and ask the user instead of guessing.
   - `git -C <integ_wt> add -A` then `git -C <integ_wt> commit --no-edit` to complete the merge commit.

3. Run `.ai/scripts/gate.sh merge-finish $ARGUMENTS`. This pushes each resolved integration branch to origin and opens a PR (`integrate/<TASK>` → master). It does **not** touch any main checkout and keeps the local worktrees/branches.

4. Report: final `.ai/scripts/gate.sh state $ARGUMENTS` (stays `DONE`), which repos were mergeable vs. needed conflict resolution, and the PR URL(s) the human should merge on the git server.

Notes:
- `gate.sh merge` requires state `DONE` (human-approved). If it isn't, report that and stop.
- PR creation uses the GitHub API (no `gh` needed); the token comes from `GH_TOKEN`/`GITHUB_TOKEN` or the git credential helper. Only `github.com` remotes are supported for auto-PR; for other hosts the gate reports the head→base branches to open the PR manually.
- If `gate.sh` rejects a precheck (uncommitted worktree, missing branch, etc.), surface the exact message — do not try to work around it.
