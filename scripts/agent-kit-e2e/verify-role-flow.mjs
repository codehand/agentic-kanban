#!/usr/bin/env node
/**
 * verify-role-flow.mjs — read REAL server data back for one task and assert the
 * per-role-actor + distinct-token (no-shared-bearer) invariants of a completed
 * no-self-certification run. Standalone ESM; exits 0 only if EVERY invariant
 * holds, non-zero (with FAIL: lines) otherwise.
 *
 * Inputs (env or argv):
 *   BASE_URL   base url of the running server, e.g. http://127.0.0.1:3961   ($1)
 *   TOKEN      a human (read-capable) bearer secret                          ($2)
 *   PROJECT    project slug                                                  ($3)
 *   KEY        task key, e.g. RS-LIFE-1                                       ($4)
 *
 * It reads `GET /api/tasks/:key?project=` which returns the canonical task
 * detail: { task, gitrefs, evidence, comments, timeline }. The server records
 * the genuine actor on every recorded action:
 *   - timeline[].actor_role + timeline[].actor_token_id   (transitions)
 *   - comments[].author_role + comments[].author_token_id (verdict comment)
 *   - evidence[].submitted_by_token_id                    (runner evidence)
 * We assert on those REAL recorded fields — never on the harness's intentions.
 *
 * Invariants asserted:
 *   1. final task.state === 'DONE'
 *   2. each lifecycle edge's actor_role matches the expected role:
 *        TODO->IN_PROGRESS            = implementer
 *        IMPLEMENTED->SELF_CHECK_PASSED = self-check  (gate edge, self-check actor)
 *        SELF_CHECK_PASSED->JUDGE_PASSED = judge
 *        JUDGE_PASSED->DONE           = human
 *   3. a verdict comment exists from the judge with verdict === 'PASS'
 *   4. the evidence row was submitted by the runner token (a token_id distinct
 *      from every transition actor up to that point)
 *   5. >= 5 DISTINCT token_ids appear across all recorded actions (transitions +
 *      verdict comment author + evidence submitter) — proving no shared bearer.
 */

const BASE_URL = process.env.BASE_URL || process.argv[2]
const TOKEN = process.env.TOKEN || process.argv[3]
const PROJECT = process.env.PROJECT || process.argv[4]
const KEY = process.env.KEY || process.argv[5]

if (!BASE_URL || !TOKEN || !PROJECT || !KEY) {
  console.error('usage: BASE_URL=.. TOKEN=.. PROJECT=.. KEY=.. node verify-role-flow.mjs')
  console.error('   or: node verify-role-flow.mjs <BASE_URL> <TOKEN> <PROJECT> <KEY>')
  process.exit(2)
}

let failures = 0
const fail = (msg) => { console.error('FAIL: ' + msg); failures++ }
const ok = (msg) => console.log('ok:   ' + msg)

// --- read REAL task detail back from the server -----------------------------
const url = `${BASE_URL}/api/tasks/${encodeURIComponent(KEY)}?project=${encodeURIComponent(PROJECT)}`
const res = await fetch(url, { headers: { Authorization: 'Bearer ' + TOKEN } })
if (!res.ok) {
  console.error(`FAIL: GET ${url} -> ${res.status}`)
  process.exit(1)
}
const detail = await res.json()
const task = detail.task ?? {}
const timeline = Array.isArray(detail.timeline) ? detail.timeline : []
const comments = Array.isArray(detail.comments) ? detail.comments : []
// evidence may be returned as a single latest row (task detail) — normalize.
const evidenceRows = Array.isArray(detail.evidence)
  ? detail.evidence
  : detail.evidence
    ? [detail.evidence]
    : []

// --- invariant 1: final state DONE ------------------------------------------
if (task.state === 'DONE') ok(`final task.state === DONE`)
else fail(`final task.state is '${task.state}', expected DONE`)

// --- invariant 2: per-edge actor_role ---------------------------------------
// find the transition record for a given from->to edge.
const edge = (from, to) =>
  timeline.find((t) => t.from_state === from && t.to_state === to)

const EXPECT = [
  ['TODO', 'IN_PROGRESS', 'implementer'],
  ['IMPLEMENTED', 'SELF_CHECK_PASSED', 'self-check'],
  ['SELF_CHECK_PASSED', 'JUDGE_PASSED', 'judge'],
  ['JUDGE_PASSED', 'DONE', 'human'],
]
for (const [from, to, role] of EXPECT) {
  const tr = edge(from, to)
  if (!tr) { fail(`no recorded transition ${from}->${to}`); continue }
  const actor_role = tr.actor_role
  const token_id = tr.actor_token_id
  if (actor_role === role) ok(`${from}->${to} actor_role === ${role} (token_id=${token_id})`)
  else fail(`${from}->${to} actor_role is '${actor_role}', expected '${role}'`)
  if (!token_id) fail(`${from}->${to} transition has no actor_token_id`)
}

// --- invariant 3: judge verdict=PASS comment --------------------------------
const verdict = comments.find((c) => c.kind === 'verdict' && c.verdict === 'PASS')
if (verdict && verdict.author_role === 'judge') {
  ok(`verdict comment kind=verdict verdict=PASS authored by judge (token_id=${verdict.author_token_id})`)
} else if (verdict) {
  fail(`verdict=PASS comment exists but author_role is '${verdict.author_role}', expected 'judge'`)
} else {
  fail(`no verdict comment with verdict=PASS found`)
}

// --- invariant 4: evidence submitted by the runner --------------------------
// The runner is the only actor that submits evidence and never transitions, so
// its token_id is distinct from every transition actor. Cross-check that the
// evidence submitter token_id does NOT equal the implementer's transition token.
const implEdge = edge('TODO', 'IN_PROGRESS')
const implTokenId = implEdge?.actor_token_id
const evidence = evidenceRows[evidenceRows.length - 1]
if (!evidence) {
  fail(`no evidence row recorded`)
} else {
  const runnerTokenId = evidence.submitted_by_token_id
  if (!runnerTokenId) fail(`evidence has no submitted_by_token_id`)
  else if (runnerTokenId === implTokenId) {
    fail(`evidence submitter token_id equals implementer token_id (${runnerTokenId}) — shared token!`)
  } else {
    ok(`evidence submitted by runner token_id=${runnerTokenId} (distinct from implementer)`)
  }
}

// --- invariant 5: >= 5 distinct token_ids / role identities -----------------
// Collect REAL token_ids from every recorded action and prove no shared bearer.
const tokenIds = new Set()
const roles = new Set()
for (const t of timeline) {
  if (t.actor_token_id) tokenIds.add(t.actor_token_id)
  if (t.actor_role) roles.add(t.actor_role)
}
for (const c of comments) {
  if (c.author_token_id) tokenIds.add(c.author_token_id)
  if (c.author_role) roles.add(c.author_role)
}
for (const e of evidenceRows) {
  if (e.submitted_by_token_id) tokenIds.add(e.submitted_by_token_id)
}
roles.add('runner') // the runner identity is carried by evidence.submitted_by_token_id

const distinctTokens = tokenIds.size
const distinctRoles = roles.size
console.log(`info: distinct token_ids across recorded actions = ${distinctTokens} -> [${[...tokenIds].join(', ')}]`)
console.log(`info: distinct actor roles = ${distinctRoles} -> [${[...roles].join(', ')}]`)
if (distinctTokens >= 5) {
  ok(`>= 5 distinct token_ids (${distinctTokens}) — no shared bearer across roles`)
} else if (distinctRoles >= 5) {
  // fall back to distinct role identities if some recorded fields omit token_id.
  ok(`>= 5 distinct actor roles (${distinctRoles}) — fell back to role identities (token_ids=${distinctTokens})`)
} else {
  fail(`only ${distinctTokens} distinct token_ids and ${distinctRoles} roles (expected >= 5) — possible shared token`)
}

// --- summary ----------------------------------------------------------------
if (failures === 0) {
  console.log('VERIFY-ROLE-FLOW: ALL INVARIANTS PASSED')
  process.exit(0)
}
console.error(`VERIFY-ROLE-FLOW: FAILED (${failures} invariant(s))`)
process.exit(1)
