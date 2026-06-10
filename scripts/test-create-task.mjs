#!/usr/bin/env node
/**
 * test-create-task.mjs — API test script for POST /api/tasks (TASK-019).
 *
 * Usage:
 *   KANBAN_TOKEN=<human-token> node scripts/test-create-task.mjs
 *   KANBAN_TOKEN=<human-token> KANBAN_BASE_URL=http://localhost:3000 node scripts/test-create-task.mjs
 */

const BASE_URL = process.env.KANBAN_BASE_URL || 'http://localhost:3000';
const TOKEN = process.env.KANBAN_TOKEN;

if (!TOKEN) {
  console.error('Error: KANBAN_TOKEN environment variable is required.');
  console.error('Usage: KANBAN_TOKEN=<token> node scripts/test-create-task.mjs');
  process.exit(1);
}

const headers = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
};

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    return false;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

async function run() {
  console.log('Create Task API Tests');
  console.log('=====================');
  console.log(`Base URL: ${BASE_URL}`);
  console.log();

  let passed = 0;
  let failed = 0;
  const taskKey = `TASK-TEST-${Date.now().toString(36).toUpperCase()}`;

  // Test 1: Create task successfully
  const t1 = await test('POST /api/tasks creates task in TODO state', async () => {
    const res = await fetch(`${BASE_URL}/api/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'opf-hub',
        key: taskKey,
        title: 'API Test Task',
        body_md: 'Created by test script',
      }),
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    const body = await res.json();
    assert(body.task, 'Response missing task');
    assert(body.task.key === taskKey, `Expected key ${taskKey}, got ${body.task.key}`);
    assert(body.task.state === 'TODO', `Expected state TODO, got ${body.task.state}`);
  });
  if (t1) passed++; else failed++;

  // Test 2: Verify task via GET
  const t2 = await test('GET /api/tasks returns created task', async () => {
    const res = await fetch(`${BASE_URL}/api/tasks?project=opf-hub`, { headers });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    const found = body.tasks.find(t => t.key === taskKey);
    assert(found, `Task ${taskKey} not found in list`);
    assert(found.state === 'TODO', `Expected state TODO, got ${found.state}`);
  });
  if (t2) passed++; else failed++;

  // Test 3: 401 without token
  const t3 = await test('POST /api/tasks returns 401 without token', async () => {
    const res = await fetch(`${BASE_URL}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: 'opf-hub', key: 'TASK-NOAUTH', title: 'No auth' }),
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });
  if (t3) passed++; else failed++;

  // Test 4: 400 missing fields
  const t4 = await test('POST /api/tasks returns 400 for missing fields', async () => {
    const res = await fetch(`${BASE_URL}/api/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ project: 'opf-hub' }),
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });
  if (t4) passed++; else failed++;

  // Test 5: 409 duplicate key
  const t5 = await test('POST /api/tasks returns 409 for duplicate key', async () => {
    const res = await fetch(`${BASE_URL}/api/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'opf-hub',
        key: taskKey,
        title: 'Duplicate',
      }),
    });
    assert(res.status === 409, `Expected 409, got ${res.status}`);
  });
  if (t5) passed++; else failed++;

  console.log();
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
