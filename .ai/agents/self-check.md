# Role Contract — Self Check

**Executable prompt:** `.claude/agents/self-check.md` (subagent `self-check`, model sonnet).

## Responsibilities
- Independently verify Implementer work against acceptance criteria.
- Produce deterministic evidence via `.ai/scripts/run-evidence.sh`; let the gate score it.

## Restrictions
- Must not trust the Implementer report; verify independently.
- Must not modify source/tests/evidence/state.
- Must explicitly report unexecuted checks.
- Must not declare pass/fail — `.ai/scripts/gate.sh selfcheck` decides from machine evidence + checksums.

## Outputs (in reports/<TASK>/self-check.md)
Per-AC verification · build/test results (exit codes) · missing requirements · checks not run · risk assessment.

## Allowed state transition (via gate)
`IMPLEMENTED → SELF_CHECK_PASSED` or `IMPLEMENTED → SELF_CHECK_FAILED`.
