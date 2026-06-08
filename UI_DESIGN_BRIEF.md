# Task Hub — UI/UX Design Brief (prompt context)

> Dùng làm **prompt context** đưa vào công cụ design (Pencil / v0 / Figma AI / agent design).
> Nguồn sự thật về chức năng: `TASK_HUB_DESIGN.md`. File này chỉ nói về **giao diện & trải nghiệm**.
> Viết bằng tiếng Anh cho công cụ design hiểu tốt; phần product context giữ đúng ý dự án.

---

## 1. Product in one line

**Task Hub** is the mission-control web UI for a centralized MCP server that coordinates AI coding
agents through a no-self-certification workflow. A single human operator watches autonomous agents
move tasks across a kanban board, inspects machine-measured evidence, and is the *only* actor who can
mark a task **Done**.

## 2. Who uses the UI

- **The human operator (only UI user).** Reviews agent work, reads evidence + diffs (via MR links),
  approves or sends back. Often supervising several tasks/projects at once. Wants to know at a glance:
  *"What needs ME right now?"*
- **Agents are NOT UI users** — they talk to the server over MCP (API). The UI only *reflects* what
  agents did. So the UI is **read-heavy + a few decisive write actions** (approve, reset, create task,
  manage tokens). No drag-to-reorder workflow editing; the state machine is fixed.

## 3. Jobs the UI must make effortless

1. **Triage**: instantly see which tasks are *Awaiting Human* (the only thing requiring action).
2. **Trust the evidence**: read build/test/lint/AC exit codes, coverage %, and checksum status without
   ambiguity — green means a machine measured it, not an agent claimed it.
3. **Review the change**: jump to each repo's MR + see branch/base..head SHAs.
4. **Follow the story**: a per-task timeline of agent comments (narrative), the judge verdict
   (PASS/REJECT), state transitions, and who/what did each.
5. **Decide**: Approve → Done, or Reset/send-back, with a short review note.
6. **See live agent activity**: which agent role currently holds a task (lease) and its heartbeat.

## 4. Design principles

- **Calm mission-control, not a busy dashboard.** Dense information, but quiet by default; color only
  carries meaning (status), never decoration.
- **Evidence > prose.** Machine numbers (exit codes, %, SHAs) are first-class, shown in monospace,
  visually distinct from human/agent narrative text.
- **One clear call-to-action per state.** The UI always answers "what's the next valid move?"
- **Read-mostly.** Destructive/decisive actions (Approve, Reset, Remove, Revoke token) are guarded and
  visually separated.
- **Status is a color language.** Each workflow state has one consistent hue everywhere (board column
  header, card border, detail header, timeline dot).

## 5. Visual theme

- **Mood**: developer/ops tooling — think *Linear × GitHub Checks × a CI runner dashboard*. Technical,
  precise, trustworthy. "Control room for AI agents."
- **Mode**: **Dark theme primary** (operators run this in a terminal-adjacent context). Provide a light
  theme as secondary, same semantics.
- **Surface**: near-black/charcoal base, subtle elevation via slightly lighter panels + 1px hairline
  borders (no heavy shadows). Rounded-md corners (6–8px). Generous but not airy spacing.
- **Accent**: a single cool accent (electric indigo/blue) for interactive elements + focus rings.
- **Texture**: flat. Optional very subtle grid/scanline on empty areas to reinforce the "console" feel —
  keep it faint.

## 6. Color system (semantic, dark-first)

Base:
- `bg` deep charcoal (#0E0F13-ish), `panel` (#15171D), `border` hairline (#262932), `text` (#E6E8EC),
  `text-muted` (#8A8F98). Accent `#5B7CFA` (indigo).

**Workflow-state palette** (same hue used on column header / card border / status pill / timeline dot):

| State / Column | Hue | Meaning |
|----------------|-----|---------|
| `TODO` — Backlog | slate / gray | not started |
| `IN_PROGRESS` | blue | agent actively working |
| `IMPLEMENTED` | indigo | code done, awaiting check |
| `SELF_CHECK_PASSED` | cyan/teal | evidence green, awaiting judge |
| `SELF_CHECK_FAILED` | amber | rework needed |
| `JUDGE_PASSED` — **Awaiting Human** | **violet + subtle glow** | **needs YOU** (highlight) |
| `JUDGE_REJECTED` | orange/red | sent back |
| `DONE` | green | approved by human |

Evidence/status semantics: pass = green, fail = red, optional-warning = amber, not-run/N-A = gray,
checksum-OK = green shield, checksum-mismatch = red.

> **Awaiting Human is the visual hero state** — it should pull the eye (glow/badge/count) because it's
> the only column the operator must act on.

## 7. Typography

- **UI / narrative**: a clean grotesk sans (Inter / Geist / IBM Plex Sans).
- **Technical tokens — monospace** (JetBrains Mono / Geist Mono / IBM Plex Mono) for: task keys
  (`TASK-001`), git SHAs (`a1b2c3d`), branch names, exit codes, coverage `82.4%`, file paths, checksums.
- Clear hierarchy: page title → section → label/caption. Tabular numerals for evidence tables.

## 8. Layout & navigation

- **Left rail** (collapsible, ~64–240px): app logo, **Project switcher**, nav (Board, Tasks, Tokens/
  Settings), and an **"Awaiting Human (N)"** quick-jump badge. Operator/connection status at bottom.
- **Top bar**: current project name, search/filter, "New Task" button, theme toggle.
- **Main**: the active screen. **Task detail opens as a right-side drawer over the board** (preferred) so
  the operator keeps board context; also addressable as a full page (deep-link `/t/TASK-001`).

## 9. Screen inventory — **8 screens** (4 primary, 4 secondary/overlay)

### PRIMARY

**S1 — Board (Kanban)** · *the home screen*
- Columns from §6 in workflow order: Backlog · In Progress · Self-Check · Judge Review · **Awaiting
  Human** · Done. Column header shows name + count + state hue.
- **Task card** shows: monospace key `TASK-001`, title, project tag (if cross-project view), state pill,
  repo count chips, and a **live agent indicator** when leased (e.g. `🤖 implementer · lease 12m`),
  plus tiny evidence glyphs (build/test/cover) once evidence exists.
- Cards are **read-only on the board** (no drag — state is server-enforced). Click → opens S2 drawer.
- Filters: by project, by state, by "has MR", by "needs human". Horizontal scroll for many columns.

**S2 — Task Detail** · *drawer over board, or full page*
- **Header**: key + title + big state pill + (if leased) agent/lease indicator. Primary action button
  reflects state: at `JUDGE_PASSED` → **Approve** (prominent, violet); else show the next-valid hint
  read-only (e.g. "Awaiting self-check by agent"). Secondary: Reset / Remove (guarded).
- **Spec panel**: Purpose / Scope / Acceptance Criteria (machine-verifiable vs human/semantic split,
  with checkbox states), Definition of Done.
- **Repos & MR panel** (multi-repo): one row per repo → branch (mono), `base..head` short SHAs,
  **MR link** with MR-state badge (Draft/Open/Merged). External-link affordance.
- **Evidence panel** (see S6 for expanded): summary row of exit codes + coverage% + checksum shield,
  link to expand logs. "Measured at <time> by runner" caption.
- **Timeline**: chronological feed mixing comments (narrative / verdict / review) and transitions. Each
  item: author **role** chip (color per role), timestamp, body (markdown). **Verdict items are
  emphasized** (PASS = green card, REJECT = red card with the required-changes list).

**S3 — Projects Overview / Dashboard** · *multi-project landing*
- Grid/list of projects, each with state-count mini-bars and a prominent **Awaiting-Human count**.
- "Across all projects: N tasks awaiting you" hero strip at top.

**S4 — Create / Edit Task** · *modal or page*
- Fields: title, project, body (markdown editor with the spec template prefilled: Purpose/Scope/AC/DoD),
  **repos** (chip input, default `.`), **Allow-No-Code-Change** toggle (with helper explaining only the
  task author should set it). Branch slug auto-generated + editable.
- Note: creating a task only registers it at `TODO`; no implementation here.

### SECONDARY / OVERLAY

**S5 — Token gate / Sign-in** · enter operator token (single-user). Minimal centered card, paste token,
remember on device. Wrong/expired token → clear error.

**S6 — Evidence detail (expanded drawer/section)** · full evidence breakdown: per-check rows
(build/test/lint/ac) with exit code + status, coverage% (per-repo if multi-repo), expandable log digests
(monospace, with copy), **manifest checksum table** (file → sha256, OK/mismatch). Immutable + timestamp
emphasized.

**S7 — Token management (Settings)** · *human only*
- Table of tokens: role, label, project scope, created, last-used, revoked. Mint new token (pick role +
  optional project) → show secret **once** (copy, masked after). Revoke action (guarded).

**S8 — Empty / first-run states** · no projects yet → onboarding card ("Create your first project / point
an agent at this server"); empty column → quiet placeholder; loading skeletons; connection-lost banner.

## 10. Key components (design system)

- **State pill** (8 variants, §6) · **role chip** (human / implementer / self-check / judge / runner —
  distinct, calmer than state colors) · **evidence stat** (label + mono value + pass/fail/warn color) ·
  **checksum shield** (ok/mismatch) · **MR link badge** (Draft/Open/Merged) · **lease/heartbeat
  indicator** (pulsing dot + countdown) · **task card** · **timeline item** (comment vs transition vs
  verdict) · **guarded action button** (confirm step for Approve/Reset/Remove/Revoke) · **markdown
  renderer** for spec + comments · **toast/notification** for action results.

## 11. Interaction & states to cover

- Loading (skeletons), empty (per §S8), error (failed action → toast + inline), permission (UI is
  single-operator but reflect server rejects clearly).
- **Live updates**: board + task drawer should update as agents act (poll or SSE) — show subtle "updated"
  pulse, never a jarring reflow. Lease countdowns tick.
- Confirm dialogs for: Approve (→ "this marks DONE, does NOT merge the MR"), Reset, Remove, Revoke token.
- Deep-linkable: `/p/<project>`, `/t/<TASK-KEY>`.

## 12. Responsive & a11y

- Desktop-first (operator at a workstation). Tablet: drawer becomes full-screen; board scrolls. Phone is
  best-effort (read + approve), not a priority.
- WCAG AA contrast in both themes; **never rely on color alone** — pair state hue with text label + icon
  (color-blind safe). Full keyboard nav; visible focus rings; respect reduced-motion (disable pulses/glow).

## 13. Out of scope (do NOT design)

- Editing the workflow/state machine, drag-to-change-state, agent chat/console, code editor or full diff
  viewer (we link out to the MR), multi-user/role management for *humans*, public-internet auth screens.

## 14. One-paragraph prompt (paste into a generator)

> Design a dark-themed, developer-tool "mission control" web app called **Task Hub** for a single human
> operator supervising AI coding agents. Primary screen is a **kanban board** with columns Backlog →
> In Progress → Self-Check → Judge Review → **Awaiting Human** (the highlighted hero state) → Done; cards
> show a monospace task key, title, a colored state pill, repo chips, live "agent working / lease
> countdown" indicators, and tiny build/test/coverage evidence glyphs. Clicking a card opens a **right-side
> task-detail drawer** with: spec (acceptance criteria), a repos+MR panel (branch, base..head SHAs,
> Draft/Open/Merged MR links), an **evidence panel** (build/test/lint/AC exit codes, coverage %, checksum
> shield — green = machine-measured, immutable), and a **timeline** of role-tagged agent comments + a
> prominent judge **VERDICT: PASS/REJECT** card + state transitions. The only decisive action is a guarded
> **Approve** button (visible at Awaiting-Human) that marks Done without merging the MR. Use a calm
> charcoal palette with one indigo accent, a clean grotesk for UI and **monospace for all technical tokens
> (keys, SHAs, exit codes, percentages, checksums)**, semantic status colors (pass=green, fail=red,
> warn=amber, awaiting-human=violet glow), hairline borders, flat elevation, AA contrast, and never color
> alone for status. Read-mostly, quiet by default, evidence over prose.
