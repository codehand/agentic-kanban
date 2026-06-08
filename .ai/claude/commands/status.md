---
description: Show workflow state + evidence summary for a task (read-only).
argument-hint: <TASK-ID>
allowed-tools: ["Bash(cat:*)", "Bash(.ai/scripts/gate.sh:*)", "Bash(jq:*)", "Bash(ls:*)"]
---

Show the current status of task **$ARGUMENTS** (read-only — do not change anything):

1. Current state: `.ai/scripts/gate.sh state $ARGUMENTS`
2. State history: `jq '.history' .ai/state/$ARGUMENTS.json` (if it exists)
3. Latest evidence summary, if present, from `.ai/evidence/$ARGUMENTS/manifest.json` (build/test/lint/ac exits + coverage%).
4. Whether each report exists: `.ai/reports/$ARGUMENTS/{implementer,self-check,judge}.md`.

Present it as a short status block. Note the next valid action given the state (e.g. JUDGE_PASSED → awaiting human `.ai/scripts/gate.sh approve $ARGUMENTS`).
