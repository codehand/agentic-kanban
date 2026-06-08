---
description: Create a new workflow task (spec + optional machine AC) and register it at TODO.
argument-hint: <short title>  (or full requirements)
---

Create a new task for the AI development workflow from: **$ARGUMENTS**

Do this:

1. If the request is vague, ask 1–3 short questions to pin down: Purpose, Scope (in/out), at least one **machine-verifiable** Acceptance Criterion, and **which repo(s)** the task will touch. Do not invent requirements silently.

2. Decide the repo set and worktree branch:
   - **Repos**: space-separated paths (relative to repo root) the task will change. Default `.` (single repo). For a multi-repo workspace, e.g. `opf-auto-e2e api-marketplace`.
   - **Branch**: generate a short readable kebab-case **slug from the title**, then form `fix/<slug>`. One branch name is shared across every repo of the task.

3. Scaffold the files (deterministic — auto-picks the next `TASK-NNN` id). Pass the repos and branch slug:
   ```
   .ai/scripts/new-task.sh "<title>" --ac --repos "<repos>" --branch "fix/<slug>"
   ```
   Use `--ac` only if there is a machine-verifiable AC to encode; omit it for purely manual tasks (then `ac.exit` will be treated as N/A by the gate). Capture the `TASK-NNN` id it prints, then edit the `Branch:` line in the generated md to fold the id in: `fix/<ID>-<slug>` (so it reads e.g. `Branch: fix/TASK-007-fix-csp-header`). The branch is only created later, at `IN_PROGRESS`, so editing the line now is safe.

4. Fill in the generated `.ai/tasks/<ID>/<ID>.md`: confirm the `Repos:` and `Branch:` lines, then replace every `<…>` placeholder with the real Purpose / Scope / Acceptance Criteria / Definition of Done / Dependencies. Split AC into **machine-verifiable** vs **human/semantic** honestly.

5. If you used `--ac`, replace the stub body of `.ai/tasks/<ID>/<ID>.ac.sh` with a real check that exits 0 only when the criteria are met (the stub deliberately `exit 1`s until you do). **The AC runs inside the task's worktree** — anchor each repo via the `${AI_WT_<REPO>:-$ROOT/<repo>}` env the runner exports (see the comments in the generated stub), never a hard-coded path.

6. Confirm: print the new id, the final state (`.ai/scripts/gate.sh state <ID>`, should be `TODO`), and the next command (`/impl <ID>`).

Note: you are only creating the task definition. You are NOT implementing it and NOT changing its state beyond the initial `TODO`.
