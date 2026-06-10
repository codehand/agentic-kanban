#!/usr/bin/env node
/**
 * test-projects.mjs — API test script for project list/create + path routing (TASK-022).
 *
 * Flow: list (note count / empty) → POST /api/projects → list again (project present)
 *       → GET /<slug>/index.html proves path-based routing serves the board.
 *
 * Usage:
 *   KANBAN_TOKEN=<human-token> node scripts/test-projects.mjs
 *   KANBAN_TOKEN=<human-token> KANBAN_BASE_URL=http://localhost:3000 node scripts/test-projects.mjs
 */

const BASE_URL = process.env.KANBAN_BASE_URL || 'http://localhost:3000';
const TOKEN = process.env.KANBAN_TOKEN;

if (!TOKEN) {
  console.error('Error: KANBAN_TOKEN environment variable is required.');
  console.error('Usage: KANBAN_TOKEN=<token> node scripts/test-projects.mjs');
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
  console.log('Project API Tests');
  console.log('=================');
  console.log(`Base URL: ${BASE_URL}`);
  console.log();

  let passed = 0;
  let failed = 0;
  const slug = `proj-test-${Date.now().toString(36)}`;
  let initialCount = -1;

  // Test 1: List projects (note whether the server starts empty)
  const t1 = await test('GET /api/projects returns a project list', async () => {
    const res = await fetch(`${BASE_URL}/api/projects`, { headers });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(Array.isArray(body.projects), 'Response missing projects array');
    initialCount = body.projects.length;
    console.log(`    (server has ${initialCount} project(s)${initialCount === 0 ? ' — empty list case' : ''})`);
  });
  if (t1) passed++; else failed++;

  // Test 2: Create project
  const t2 = await test('POST /api/projects creates a project (201)', async () => {
    const res = await fetch(`${BASE_URL}/api/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ slug, name: `Test Project ${slug}` }),
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    const body = await res.json();
    assert(body.project, 'Response missing project');
    assert(body.project.slug === slug, `Expected slug ${slug}, got ${body.project.slug}`);
  });
  if (t2) passed++; else failed++;

  // Test 3: List again — project present, count grew
  const t3 = await test('GET /api/projects includes the new project', async () => {
    const res = await fetch(`${BASE_URL}/api/projects`, { headers });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.projects.some((p) => p.slug === slug), `Project ${slug} not found in list`);
    assert(body.projects.length === initialCount + 1, `Expected ${initialCount + 1} projects, got ${body.projects.length}`);
  });
  if (t3) passed++; else failed++;

  // Test 4: 401 without token
  const t4 = await test('POST /api/projects returns 401 without token', async () => {
    const res = await fetch(`${BASE_URL}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'proj-noauth', name: 'No auth' }),
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });
  if (t4) passed++; else failed++;

  // Test 5: 400 for missing / path-unsafe slug
  const t5 = await test('POST /api/projects returns 400 for bad slug', async () => {
    const missing = await fetch(`${BASE_URL}/api/projects`, {
      method: 'POST', headers, body: JSON.stringify({ name: 'No slug' }),
    });
    assert(missing.status === 400, `Expected 400 (missing slug), got ${missing.status}`);
    const unsafe = await fetch(`${BASE_URL}/api/projects`, {
      method: 'POST', headers, body: JSON.stringify({ slug: 'a/b', name: 'Unsafe' }),
    });
    assert(unsafe.status === 400, `Expected 400 (unsafe slug), got ${unsafe.status}`);
  });
  if (t5) passed++; else failed++;

  // Test 6: 409 duplicate slug
  const t6 = await test('POST /api/projects returns 409 for duplicate slug', async () => {
    const res = await fetch(`${BASE_URL}/api/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ slug, name: 'Duplicate' }),
    });
    assert(res.status === 409, `Expected 409, got ${res.status}`);
  });
  if (t6) passed++; else failed++;

  // Test 7: path-based routing serves the board for the new project
  const t7 = await test(`GET /${slug}/index.html serves the board (path routing)`, async () => {
    const res = await fetch(`${BASE_URL}/${slug}/index.html`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    assert(ct.includes('text/html'), `Expected text/html, got ${ct}`);
    const html = await res.text();
    assert(html.includes('id="board-columns"'), 'Board markup not found in response');
  });
  if (t7) passed++; else failed++;

  console.log();
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
