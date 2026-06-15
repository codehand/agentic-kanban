# agent-kit — skill/command bundle to copy into the target project

A portable `.claude/` bundle that teaches Claude sessions inside the **target
project** (the demo repo the agents will modify) how to operate the aka-mcp
lifecycle over MCP. Hub server setup and token minting still follow
`docs/CONNECT_MCP.md`.

## Contents

```
.claude/
  skills/aka-kanban/SKILL.md         # shared reference: state machine, guards, lease, evidence
  agents/aka-implementer.md          # implementer role agent  (taskhub-impl)
  agents/aka-runner.md               # runner role agent       (taskhub-runner, evidence.submit-only)
  agents/aka-self-check.md           # self-check role agent   (taskhub-selfcheck)
  agents/aka-judge.md                # judge role agent        (taskhub-judge)
  agents/aka-human.md                # human-approver agent    (taskhub-human)
  commands/aka-run.md                # orchestrator — drive the whole lifecycle → /aka-run <slug> [key|all]
  commands/aka-impl.md               # one implementer iteration   → /aka-impl <slug>      (legacy /loop)
  commands/aka-selfcheck.md          # one self-check iteration    → /aka-selfcheck <slug> (legacy /loop)
  commands/aka-judge.md              # one judge iteration         → /aka-judge <slug>     (legacy /loop)
  commands/aka-human.md              # one human-approve iteration → /aka-human <slug>     (legacy /loop)
```

## Two ways to run

- **Single-session orchestrator (recommended)** — one Claude session registers **all 5**
  role-scoped MCP servers and spawns the role *agent definitions* (`agents/aka-*.md`) to drive
  tasks through the lifecycle. See [Orchestrator](#orchestrator-single-session-5-role-agents).
- **One clone per role (`/loop`)** — copy the kit into a clone per role; each clone registers
  one role's token as `taskhub` and runs its slash command under `/loop`. Backward-compatible;
  see [Per-clone /loop model](#per-clone-loop-model).

## Orchestrator (single session, 5 role agents)

Each role is a first-class **agent definition** bound to its role token through its **own**
MCP server. An agent's `tools:` allowlist names ONLY its own `mcp__taskhub-<role>__*` tools
(never a blanket `*`), so a role agent literally cannot call another role's tools (tool-scope)
— and even if it tried, the server rejects it by the bearer token's role (defense in depth).

| Role | Agent def (`subagent_type`) | MCP server | Token role | Hub authority |
|---|---|---|---|---|
| Implementer | `aka-implementer` | `taskhub-impl` | `implementer` | claim/lease, gitref.set, `TODO→IN_PROGRESS→IMPLEMENTED`, narrative |
| Runner | `aka-runner` | `taskhub-runner` | `runner` | `evidence.submit` ONLY |
| Self-check | `aka-self-check` | `taskhub-selfcheck` | `self-check` | `task.selfcheck` → `SELF_CHECK_*` (no code edits) |
| Judge | `aka-judge` | `taskhub-judge` | `judge` | verdict comment + `SELF_CHECK_PASSED→JUDGE_*` |
| Human | `aka-human` | `taskhub-human` | `human` | merge + `task.approve` → DONE |

**Register all 5 servers in the orchestrator session** (mint one token per role first — see
`docs/CONNECT_MCP.md` §3; tokens are minted by the operator via the Tokens web UI or
`POST /api/tokens`, never auto-minted by the kit). Replace `<url>` with your hub `/mcp`
endpoint (`http://127.0.0.1:3000/mcp`, or `http://host.docker.internal:3000/mcp` from Docker):

```bash
claude mcp add taskhub-impl      --transport http <url> --header "Authorization: Bearer <implementer-token>"
claude mcp add taskhub-runner    --transport http <url> --header "Authorization: Bearer <runner-token>"
claude mcp add taskhub-selfcheck --transport http <url> --header "Authorization: Bearer <self-check-token>"
claude mcp add taskhub-judge     --transport http <url> --header "Authorization: Bearer <judge-token>"
claude mcp add taskhub-human     --transport http <url> --header "Authorization: Bearer <human-token>"
```

Then drive the board from a single session:

```
/aka-run demo all        # sweep the board to DONE
/aka-run demo TASK-123   # drive one task to DONE
```

`/aka-run` spawns the 5 role agents stage by stage, coordinating **only through the hub**
(polling `task.list`/`task.get` to decide whose turn is next). This mirrors the proven
per-role-subagent recipe in `docs/MULTI_AGENT_E2E_TEMPLATE.md`.

## Per-clone /loop model

The original model copies the kit into one clone per role and runs the slash commands under
`/loop`; the legacy commands (`aka-impl`, `aka-selfcheck`, `aka-judge`, `aka-human`) stay in
the kit for this purpose.

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
