# agent-kit — skill/command bundle to copy into the target project

A portable `.claude/` bundle that teaches Claude sessions inside the **target
project** (the demo repo the agents will modify) how to operate the aka-mcp
lifecycle over MCP. Hub server setup and token minting still follow
`docs/CONNECT_MCP.md`.

## Contents

```
.claude/
  skills/aka-kanban/SKILL.md      # shared reference: state machine, guards, lease, evidence
  commands/aka-impl.md            # one implementer iteration   → /aka-impl <slug>
  commands/aka-selfcheck.md       # one self-check iteration    → /aka-selfcheck <slug>
  commands/aka-judge.md           # one judge iteration         → /aka-judge <slug>
  commands/aka-human.md           # one human-approve iteration → /aka-human <slug>
```

## Usage

1. Copy this entire `.claude/` directory into **each clone** of the target
   project (`work-impl`, `work-selfcheck`, `work-judge`, `work-human`):

   ```bash
   for r in impl selfcheck judge human; do
     cp -R examples/agent-kit/.claude ~/ws/demo/work-$r/
   done
   ```

2. In each clone, register the MCP server `taskhub` with the bearer token for
   the matching role (the self-check clone additionally registers
   `taskhub-runner` with a `runner`-role token). When running in Docker, use
   `http://host.docker.internal:3000/mcp`.

3. Open `claude` in each clone and run its role under `/loop`:

   | Terminal | Command |
   |---|---|
   | work-impl | `/loop 5m /aka-impl demo` |
   | work-selfcheck | `/loop 5m /aka-selfcheck demo` |
   | work-judge | `/loop 5m /aka-judge demo` |
   | work-human | `/loop 5m /aka-human demo` |

   The agent wakes every 5 minutes, runs exactly one iteration (at most one
   task), then sleeps again; on an empty board the iteration costs only a
   single queue check. Tune the interval to taste (shorter → picks up new
   tasks sooner, spends more tokens on empty checks).

   `demo` is the project slug on the hub; if omitted, the commands default to
   `demo`.

   Session context grows with the number of iterations. When the board is
   quiet, run `/compact` occasionally — the kit is stateless by design (all
   context is rebuilt from the hub + origin), so compacting/clearing loses
   nothing.

Each command carries its own "busy → skip" rule: at most one task per
iteration, and an unfinished task from the previous iteration is resumed
instead of picking a new one.

The kit assumes sessions run in ephemeral environments (Docker/sandbox), so
**the git server (origin) is the source of truth**: the implementer pushes its
branch before every hub state update; self-check/judge/human only fetch from
origin and fail/reject the task if the registered `head_sha` does not exist on
origin. Origin therefore must be mountable/routable from inside the container
(a bare repo on a mounted volume, or a real remote such as GitHub).
