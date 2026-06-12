---
name: aka-kanban
description: Operating reference for working a task lifecycle against an Agentic Kanban (aka-mcp) hub over MCP. Use whenever acting as implementer, self-check, judge, or human approver on the taskhub MCP server — covers states, role permissions, transition guards, lease rules, and evidence format. Triggers: /aka-impl, /aka-selfcheck, /aka-judge, /aka-human, "taskhub", "aka-mcp lifecycle".
---

# aka-kanban — agent operating reference

This project is a **target repo** worked by role agents talking to an Agentic Kanban hub
over MCP. The hub is registered as MCP server `taskhub` (tools appear as
`mcp__taskhub__<name>`). The self-check clone additionally has `taskhub-runner`
(runner-role token, used **only** for `evidence.submit`).

Authority is enforced server-side by the **role of the bearer token**. You can only do
what your clone's token allows. A role error from the server means you attempted
something outside your stage — do not retry, do not work around it.

## State machine (server-enforced; no skipping)

```
TODO → IN_PROGRESS → IMPLEMENTED → SELF_CHECK_PASSED → JUDGE_PASSED → DONE
                          ↑   └→ SELF_CHECK_FAILED ─┐
                          └──── JUDGE_REJECTED ←────┘   (rework → IN_PROGRESS)
```

| Transition | Role | Guard |
|---|---|---|
| TODO → IN_PROGRESS | implementer | must hold lease (`task.claim`) |
| IN_PROGRESS → IMPLEMENTED | implementer | `gitref.set` exists with `head_sha` ≠ `base_sha` |
| IMPLEMENTED → SELF_CHECK_PASSED/FAILED | self-check | via `task.selfcheck` only — the gate grades the latest evidence; build/test/ac exit codes must all be 0 to pass |
| SELF_CHECK_FAILED → IN_PROGRESS | implementer | rework |
| SELF_CHECK_PASSED → JUDGE_PASSED/REJECTED | judge | a `comment.add { kind: "verdict", verdict: "PASS"\|"REJECT" }` matching the direction must exist **before** the transition |
| JUDGE_REJECTED → IN_PROGRESS | implementer | rework |
| JUDGE_PASSED → DONE | human | via `task.approve`; does **not** merge git — merge first |

## Leasing (implementer only)

- `task.claim` before touching a task; fails if another agent holds the lease.
- Lease TTL is 15 minutes — call `task.heartbeat` every ~5 minutes while working.
- `task.release` when your stage's work on the task is finished.

## Finding work

`task.next` only returns TODO tasks. For other stages use
`task.list { project, state }` and take the oldest entry.

## Evidence (anti-fabrication core)

Evidence is submitted **only** by the runner token (`taskhub-runner`), and only after
independently checking out the exact `head_sha` from `gitref.list` and running
build/test/AC yourself. Submit **real exit codes, even failures**:

```
evidence.submit {
  project, key,
  build_exit, test_exit, ac_exit,      # integers, real values
  manifest_json: "{\"logs/build.log\": \"<sha256>\", ...}",
  logs_json: "{\"test\": \"<tail of output>\"}"
}
```

Then `task.selfcheck { project, key }` on `taskhub` — the gate decides PASSED/FAILED.
Never edit code to make evidence pass; that is the implementer's job in rework.

## Git server is the source of truth (sandbox-safe rule)

Sessions may run in Docker/sandboxes: **any local-only commit or branch is considered
lost the moment the turn ends.** Therefore:

- **Implementer:** push the task branch to origin **before every hub state update** —
  before reporting IN_PROGRESS progress, and strictly before `gitref.set` +
  `→ IMPLEMENTED`. The `head_sha` you register must be a sha that exists on origin
  (`git push` first, then read the sha you pushed). If an iteration ends mid-work,
  commit WIP and push anyway; the next iteration rebuilds from origin, not from local
  state.
- **Self-check / judge / human:** always `git fetch origin` first and operate only on
  what origin has. After fetching, verify the registered `head_sha` exists
  (`git cat-file -e <head_sha>`). If the branch or sha is **not on origin**, the work
  effectively does not exist — fail it through your stage's normal channel
  (see each command). Never grade, review, or merge a sha you could not fetch.
- **Resuming after restart:** never trust the local working copy. Rebuild context from
  the hub (`task.get`, `comment.list`, `gitref.list`) and from `git fetch origin`.

### Push/fetch failures — content vs infrastructure

Two failure classes, handled differently:

- **Content failure** — origin is reachable but the registered branch/sha is missing.
  The implementer never delivered. Fail through your stage's normal channel
  (selfcheck → FAILED via evidence, judge → REJECT). This routes the task back to
  IN_PROGRESS — there is no transition back to TODO, so "start over" means the
  implementer's rework detects the missing branch and rebuilds it from the gitref's
  original `base_sha`.
- **Infrastructure failure** — `git push`/`git fetch` itself errors (network down,
  auth, origin unreachable). Nobody is at fault and nothing can be verified:
  **make no hub state change at all.** Leave the task exactly where it is, report the
  error in your reply (and a `comment.add { kind: "note" }` if the hub is reachable),
  end the turn. The next loop tick is the retry. Never convert an infra error into a
  FAILED/REJECTED verdict, and never advance state on work you could not push/fetch.

## Universal loop discipline (all roles)

1. At most **one task per iteration**.
2. If the previous iteration left a task mid-stage (lease held / review unfinished),
   continue that task; do not pick a new one.
3. No eligible task → reply `idle` and end the turn. Do not invent work.
4. Never perform another role's action, even if the tool call would be convenient.
5. On any server rejection (401, role, guard), report it in a comment or your reply —
   do not brute-force retries.
