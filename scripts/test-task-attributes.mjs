#!/usr/bin/env node
/**
 * test-task-attributes.mjs — API test script for TASK-021 task attributes.
 *
 * Usage:
 *   TASK_HUB_URL=http://localhost:3000 TASK_TOKEN=<bearer> node scripts/test-task-attributes.mjs
 *
 * Flow:
 *   1. Create task with all attributes → verify 201 + fields persisted.
 *   2. GET task → verify fields returned.
 *   3. PATCH task → update attributes → verify 200 + updated fields.
 *   4. GET task again → verify all fields after update.
 *   5. POST with invalid priority → verify 400.
 *   6. PATCH with invalid complexity → verify 400.
 */

const BASE = process.env.TASK_HUB_URL || 'http://localhost:3000'
const TOKEN = process.env.TASK_TOKEN || ''
const PROJECT = process.env.TASK_PROJECT || 'test-project'

if (!TOKEN) {
  console.error('TASK_TOKEN env var is required')
  process.exit(1)
}

const headers = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
}

function assert(cond, msg) {
  if (!cond) { console.error(`  FAIL: ${msg}`); process.exit(1) }
  console.log(`  ok   - ${msg}`)
}

async function main() {
  const key = `TASK-TEST-${Date.now().toString(36).toUpperCase()}`

  // Step 1: Create task with attributes
  console.log('\n1. Create task with all attributes')
  let res = await fetch(`${BASE}/api/tasks`, {
    method: 'POST', headers,
    body: JSON.stringify({
      project: PROJECT, key, title: 'Attribute test task',
      priority: 'P1', complexity: 'M', estimate_hours: 4,
      tags: ['test', 'api'], link_document: 'https://example.com/doc',
    }),
  })
  assert(res.status === 201, `create returns 201 (got ${res.status})`)
  let body = await res.json()
  assert(body.task.priority === 'P1', 'priority = P1')
  assert(body.task.complexity === 'M', 'complexity = M')
  assert(body.task.estimate_hours === 4, 'estimate_hours = 4')
  assert(JSON.stringify(body.task.tags) === '["test","api"]', 'tags = ["test","api"]')
  assert(body.task.link_document === 'https://example.com/doc', 'link_document set')

  // Step 2: GET task
  console.log('\n2. GET task — verify attributes')
  res = await fetch(`${BASE}/api/tasks/${key}?project=${PROJECT}`, { headers })
  assert(res.status === 200, `GET returns 200 (got ${res.status})`)
  body = await res.json()
  assert(body.task.priority === 'P1', 'GET priority = P1')
  assert(Array.isArray(body.task.tags) && body.task.tags.length === 2, 'GET tags is array of 2')

  // Step 3: PATCH update
  console.log('\n3. PATCH — update attributes')
  res = await fetch(`${BASE}/api/tasks/${key}?project=${PROJECT}`, {
    method: 'PATCH', headers,
    body: JSON.stringify({ priority: 'P0', tags: ['urgent', 'critical', 'p0'] }),
  })
  assert(res.status === 200, `PATCH returns 200 (got ${res.status})`)
  body = await res.json()
  assert(body.task.priority === 'P0', 'updated priority = P0')
  assert(body.task.tags.length === 3, 'updated tags has 3 items')
  assert(body.task.complexity === 'M', 'complexity unchanged = M')

  // Step 4: GET after update
  console.log('\n4. GET after PATCH — verify all fields')
  res = await fetch(`${BASE}/api/tasks/${key}?project=${PROJECT}`, { headers })
  body = await res.json()
  assert(body.task.priority === 'P0', 'priority still P0')
  assert(body.task.estimate_hours === 4, 'estimate still 4')
  assert(body.task.link_document === 'https://example.com/doc', 'link_document still set')

  // Step 5: Invalid priority
  console.log('\n5. POST with invalid priority → 400')
  res = await fetch(`${BASE}/api/tasks`, {
    method: 'POST', headers,
    body: JSON.stringify({ project: PROJECT, key: key + '-BAD1', title: 'Bad', priority: 'P9' }),
  })
  assert(res.status === 400, `invalid priority rejected (got ${res.status})`)

  // Step 6: PATCH invalid complexity
  console.log('\n6. PATCH with invalid complexity → 400')
  res = await fetch(`${BASE}/api/tasks/${key}?project=${PROJECT}`, {
    method: 'PATCH', headers,
    body: JSON.stringify({ complexity: 'XXL' }),
  })
  assert(res.status === 400, `invalid complexity rejected (got ${res.status})`)

  console.log('\nALL TESTS PASSED ✓')
}

main().catch((err) => { console.error('Error:', err); process.exit(1) })
