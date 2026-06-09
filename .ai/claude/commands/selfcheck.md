---
description: Run the Self-Check stage for a task (independent evidence; gate decides pass/fail).
argument-hint: <TASK-ID>
---

Run self-check for task **$ARGUMENTS**.

Delegate to the `self-check` subagent (Agent tool, `subagent_type: "self-check"`). Instruct it to:

1. Run `.ai/scripts/run-evidence.sh $ARGUMENTS` to produce fresh deterministic evidence.
2. Read the evidence (`*.exit`, `coverage.pct`, logs) and compare against the Acceptance Criteria in `.ai/tasks/$ARGUMENTS/$ARGUMENTS.md`.
3. Write `.ai/reports/$ARGUMENTS/self-check.md` with a per-AC verification table citing evidence.
4. Run `.ai/scripts/gate.sh selfcheck $ARGUMENTS` and report whatever the gate decides — it must NOT override the gate.

When done, report the resulting state. If `SELF_CHECK_FAILED`, summarize which checks failed so the Implementer can rework.
