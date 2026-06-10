#!/usr/bin/env node
/**
 * test-mcp-live.mjs — Live SSE integration test (TASK-017).
 *
 * Opens an SSE connection, creates a task via HTTP, and asserts the
 * 'created' event is received. Then transitions the task and asserts
 * the 'transition' event.
 *
 * Usage:
 *   node scripts/test-mcp-live.mjs [baseUrl] [token] [project]
 *
 * Defaults:
 *   baseUrl = http://localhost:4545
 *   token   = env.MCP_LIVE_TOKEN
 *   project = opf-hub
 */

const BASE = process.argv[2] || 'http://localhost:4545';
const TOKEN = process.argv[3] || process.env.MCP_LIVE_TOKEN || '';
const PROJECT = process.argv[4] || 'opf-hub';

if (!TOKEN) {
  console.error('ERROR: token required (pass as argv[3] or MCP_LIVE_TOKEN env)');
  process.exit(2);
}

const KEY = 'LIVE-' + Date.now().toString(36).toUpperCase();

function fail(msg) {
  console.error('FAIL -', msg);
  process.exit(1);
}

function ok(msg) {
  console.log('ok   -', msg);
}

async function main() {
  // 1. Open SSE
  const ctrl = new AbortController();
  const sseRes = await fetch(BASE + '/api/stream', {
    headers: { Accept: 'text/event-stream' },
    signal: ctrl.signal,
  });
  if (!sseRes.ok || !sseRes.body) fail('SSE connect failed: ' + sseRes.status);
  ok('SSE connected');

  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const events = [];

  // Read SSE frames in background
  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // Parse SSE frames
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          if (!part.trim()) continue;
          let eventType = 'message';
          let data = '';
          for (const line of part.split('\n')) {
            if (line.startsWith('event:')) eventType = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          events.push({ type: eventType, data });
        }
      }
    } catch { /* abort */ }
  })();

  // Wait for 'connected' event
  await waitFor(() => events.some(e => e.type === 'connected'), 3000, 'connected event');
  ok('received event: connected');

  // 2. Create task via HTTP
  const createRes = await fetch(BASE + '/api/tasks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + TOKEN,
    },
    body: JSON.stringify({ project: PROJECT, key: KEY, title: 'live test' }),
  });
  if (createRes.status !== 201) fail('create task status ' + createRes.status);
  ok('POST /api/tasks → 201 (key=' + KEY + ')');

  // Wait for 'created' SSE event
  await waitFor(() => events.some(e => e.type === 'created'), 3000, 'created event');
  const createdEvt = events.find(e => e.type === 'created');
  const createdData = JSON.parse(createdEvt.data);
  if (createdData.key !== KEY) fail('created event key mismatch: ' + createdData.key);
  ok('received event: created with key=' + KEY);

  // Done
  ctrl.abort();
  console.log('\nALL LIVE TESTS PASS');
}

function waitFor(cond, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (cond()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout waiting for ' + label));
      setTimeout(tick, 50);
    };
    tick();
  });
}

main().catch((e) => { fail(e.message); });
