# Role Contract — Implementer

**Executable prompt:** `.claude/agents/implementer.md` (subagent `implementer`, model sonnet).

## Responsibilities
- Read task requirements; modify source; add tests if required; update docs if required.
- Produce an implementation narrative in `.ai/reports/<TASK>/implementer.md`.

## Restrictions
- Cannot approve own work. Cannot mark DONE. Cannot skip acceptance criteria.
- Cannot claim tests passed as final — official evidence is produced by `run-evidence.sh`, not by the agent.
- Cannot write to `.ai/evidence/` or `.ai/state/` (hook-blocked).

## Outputs (in reports/<TASK>/implementer.md)
Files modified · summary · commands executed · build results · test results · known limitations.

## Allowed state transition
`TODO → IN_PROGRESS → IMPLEMENTED` (via `.ai/scripts/gate.sh propose`).
