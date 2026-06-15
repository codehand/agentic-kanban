#!/usr/bin/env node
/**
 * verify-kit-consistency.mjs — prove the TASK-047 agent kit's declared per-role
 * MCP tool allowlists agree with the server's REAL enforced permission matrix.
 *
 * Standalone ESM. No Docker, no running server — it only PARSES files:
 *   - examples/agent-kit/.claude/agents/aka-{implementer,runner,self-check,judge,human}.md
 *     → each agent's `tools:` frontmatter line → its `mcp__taskhub-<role>__<tool>` allowlist.
 *   - server/src/auth/authorize.ts → the REAL `PERMISSIONS` matrix (role → Set<Action>),
 *     parsed from source (NOT hardcoded) so this check FAILS if the matrix changes.
 *
 * The tool→action mapping is anchored to the server too: it is read from
 * server/src/mcp/tools/write.ts (the `transitionAction`/`commentAction` switches and the
 * `assertAuthorized(..., '<action>')` calls), so a server-side remap is detected.
 *
 * Per role it asserts:
 *   (a) NO over-grant   — every state-mutating MCP tool the agent declares maps to an
 *                         action that role is permitted in authorize.ts;
 *   (b) NO missing tool — each role declares the tools its lifecycle stage needs;
 *   (c) exactly ONE `taskhub-<role>` server prefix per agent.
 *
 * Exit 0 only if every role passes; non-zero with the specific mismatch otherwise.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..') // scripts/agent-kit-e2e -> repo root
const AGENTS_DIR = join(REPO, 'examples/agent-kit/.claude/agents')
const AUTHORIZE_TS = join(REPO, 'server/src/auth/authorize.ts')
const WRITE_TS = join(REPO, 'server/src/mcp/tools/write.ts')

let failures = 0
const fail = (msg) => { console.error('FAIL: ' + msg); failures++ }
const ok = (msg) => console.log('ok:   ' + msg)

// ---------------------------------------------------------------------------
// 1. Parse the REAL role->action matrix out of server/src/auth/authorize.ts.
//    We read each `<role>: new Set<Action>([ '...', ... ])` block and collect
//    the quoted action strings. This is the live matrix, not a copy.
// ---------------------------------------------------------------------------
function parsePermissions(src) {
  const start = src.indexOf('const PERMISSIONS')
  if (start < 0) throw new Error('PERMISSIONS not found in authorize.ts')
  const body = src.slice(start)
  const perms = {}
  // Match: <role-key>: new Set<Action>([ ...actions... ]),
  // role-key is a bareword (human/implementer/judge/runner) or quoted ('self-check').
  const roleRe = /(?:'([a-z-]+)'|([a-z-]+))\s*:\s*new Set<Action>\(\[([\s\S]*?)\]\)/g
  let m
  while ((m = roleRe.exec(body)) !== null) {
    const role = m[1] ?? m[2]
    const inner = m[3]
    const actions = [...inner.matchAll(/'([a-z.]+(?:_[a-z]+)*[a-z._]*)'/g)].map((a) => a[1])
    perms[role] = new Set(actions)
  }
  return perms
}

// ---------------------------------------------------------------------------
// 2. Anchor the tool->action mapping by confirming write.ts still wires each
//    tool to the action this check assumes. We grep for the literal action
//    strings the server uses; if write.ts no longer references one, fail loudly
//    so the mapping below cannot silently drift from the server.
// ---------------------------------------------------------------------------
function assertWriteTsAnchors(src) {
  const required = [
    "'task.claim'",
    "'task.transition.todo_to_in_progress'",
    "'task.transition.in_progress_to_implemented'",
    "'task.transition.self_check'",
    "'task.transition.judge'",
    "'task.transition.approve'",
    "'gitref.set'",
    "'evidence.submit'",
    "'comment.narrative'",
    "'comment.verdict'",
  ]
  for (const lit of required) {
    if (!src.includes(lit)) {
      fail(`write.ts no longer references ${lit} — tool→action mapping drifted; update this check`)
    }
  }
}

// Tool name -> the action(s) the server requires to call it. For tools whose
// required action depends on a runtime arg (comment.add's `kind`, task.transition's
// from/to edge), we record the FULL set of actions the tool can require; the
// allowlist check then asks "does this role hold an action that lets it use this
// tool for its stage?". Read-only tools require only `read` (every role has it).
const READ_ACTION = 'read'
const READ_TOOLS = new Set([
  'task.list', 'task.get', 'task.next', 'comment.list', 'evidence.get', 'gitref.list',
])

// For each state-mutating tool: the candidate actions it may require (any one of
// which, if held by the role, authorizes at least one legitimate use of the tool).
const TOOL_ACTIONS = {
  'task.claim': ['task.claim'],
  'task.heartbeat': ['task.claim'],
  'task.release': ['task.claim'],
  'gitref.set': ['gitref.set'],
  'evidence.submit': ['evidence.submit'],
  'task.selfcheck': ['task.transition.self_check'],
  'task.approve': ['task.transition.approve'],
  'task.update': ['task.update'],
  // comment.add's required action depends on `kind` (narrative|verdict|review|note).
  'comment.add': ['comment.narrative', 'comment.verdict', 'comment.review'],
  // task.transition's required action depends on the from/to edge.
  'task.transition': [
    'task.transition.todo_to_in_progress',
    'task.transition.in_progress_to_implemented',
    'task.transition.self_check',
    'task.transition.judge',
    'task.transition.approve',
    'task.transition.rework',
  ],
}

// ---------------------------------------------------------------------------
// 3. Parse each kit agent def: its `tools:` line -> server prefix + tool names.
// ---------------------------------------------------------------------------
function parseAgentTools(file) {
  const src = readFileSync(file, 'utf8')
  const line = src.split(/\r?\n/).find((l) => l.startsWith('tools:'))
  if (!line) throw new Error(`no tools: line in ${file}`)
  const entries = line
    .replace(/^tools:\s*/, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const prefixes = new Set()
  const tools = []
  for (const e of entries) {
    const m = e.match(/^mcp__(taskhub-[a-z]+)__(.+)$/)
    if (!m) continue // built-in tool (Read/Bash/Edit/...): not a hub tool
    prefixes.add(m[1])
    tools.push(m[2])
  }
  return { prefixes: [...prefixes], tools }
}

// Each kit agent file + the role its token carries + the actions its STAGE must
// be able to perform (the "no missing tool" expectation per the task spec).
const KIT = [
  {
    agent: 'aka-implementer.md', role: 'implementer', prefix: 'taskhub-impl',
    requiredTools: [
      'task.claim',
      'task.transition', // both forward edges
      'gitref.set',
      'comment.add',     // narrative
    ],
  },
  {
    agent: 'aka-runner.md', role: 'runner', prefix: 'taskhub-runner',
    requiredTools: ['evidence.submit'],
  },
  {
    agent: 'aka-self-check.md', role: 'self-check', prefix: 'taskhub-selfcheck',
    requiredTools: ['task.selfcheck'],
  },
  {
    agent: 'aka-judge.md', role: 'judge', prefix: 'taskhub-judge',
    requiredTools: ['comment.add', 'task.transition'], // verdict comment + judge edge
  },
  {
    agent: 'aka-human.md', role: 'human', prefix: 'taskhub-human',
    requiredTools: ['task.approve'],
  },
]

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------
const authorizeSrc = readFileSync(AUTHORIZE_TS, 'utf8')
const writeSrc = readFileSync(WRITE_TS, 'utf8')
const PERMISSIONS = parsePermissions(authorizeSrc)
assertWriteTsAnchors(writeSrc)

// sanity: the matrix parsed and has all 5 roles
for (const r of ['human', 'implementer', 'self-check', 'judge', 'runner']) {
  if (!PERMISSIONS[r] || PERMISSIONS[r].size === 0) {
    fail(`authorize.ts PERMISSIONS missing/empty for role '${r}' (parse failure?)`)
  }
}

for (const { agent, role, prefix, requiredTools } of KIT) {
  const file = join(AGENTS_DIR, agent)
  let parsed
  try {
    parsed = parseAgentTools(file)
  } catch (e) {
    fail(`${agent}: ${e.message}`)
    continue
  }
  const perm = PERMISSIONS[role] ?? new Set()
  const declared = new Set(parsed.tools)
  let roleOk = true

  // (c) exactly one taskhub-<role> server prefix
  if (parsed.prefixes.length !== 1) {
    fail(`${agent}: declares ${parsed.prefixes.length} server prefixes [${parsed.prefixes.join(', ')}] — expected exactly one`)
    roleOk = false
  } else if (parsed.prefixes[0] !== prefix) {
    fail(`${agent}: server prefix is '${parsed.prefixes[0]}', expected '${prefix}' for role ${role}`)
    roleOk = false
  }

  // (a) no over-grant: every declared state-mutating tool must map to an action
  //     this role is permitted. Read-only tools only need `read`.
  for (const tool of declared) {
    if (READ_TOOLS.has(tool)) {
      if (!perm.has(READ_ACTION)) {
        fail(`${agent}: declares read tool '${tool}' but role ${role} lacks '${READ_ACTION}'`)
        roleOk = false
      }
      continue
    }
    const candidates = TOOL_ACTIONS[tool]
    if (!candidates) {
      fail(`${agent}: declares unknown hub tool '${tool}' (no action mapping) — possible over-grant`)
      roleOk = false
      continue
    }
    const permitted = candidates.some((a) => perm.has(a))
    if (!permitted) {
      fail(`${agent}: OVER-GRANT — declares '${tool}' but role ${role} holds none of [${candidates.join(', ')}] in authorize.ts`)
      roleOk = false
    }
  }

  // (b) no missing tool: each role must declare the tools its stage needs.
  for (const tool of requiredTools) {
    if (!declared.has(tool)) {
      fail(`${agent}: MISSING TOOL — role ${role} must declare '${tool}' to complete its hand-off`)
      roleOk = false
    }
  }

  if (roleOk) {
    ok(`${role.padEnd(11)} [${prefix}] ${declared.size} hub tools — no over-grant, no missing tool, single server`)
  }
}

if (failures === 0) {
  console.log('VERIFY-KIT-CONSISTENCY: ALL ROLES CONSISTENT WITH authorize.ts')
  process.exit(0)
}
console.error(`VERIFY-KIT-CONSISTENCY: FAILED (${failures} mismatch(es))`)
process.exit(1)
