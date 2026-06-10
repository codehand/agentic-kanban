#!/usr/bin/env node
/**
 * index.mjs — Minimal MCP client that creates a task and transitions it,
 * while observing live SSE events from the server.
 *
 * Env vars:
 *   KANBAN_URL    — server base URL (default http://localhost:4545)
 *   KANBAN_TOKEN  — bearer token (any role that can create/transition)
 *   KANBAN_PROJECT— project slug (default opf-hub)
 *   MCP_SERVER_CMD— command to start the MCP server (default: node dev-server.mjs --mcp)
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const BASE = process.env.KANBAN_URL || 'http://localhost:4545';
const TOKEN = process.env.KANBAN_TOKEN || '';
const PROJECT = process.env.KANBAN_PROJECT || 'opf-hub';
const SERVER_CMD = process.env.MCP_SERVER_CMD || 'node';
const SERVER_ARGS = process.env.MCP_SERVER_ARGS
  ? process.env.MCP_SERVER_ARGS.split(' ')
  : ['dev-server.mjs', '--mcp'];

if (!TOKEN) {
  console.error('KANBAN_TOKEN env var is required');
  process.exit(2);
}

const KEY = 'EX-' + Date.now().toString(36).toUpperCase();

async function main() {
  // 1. Open SSE listener
  console.log('→ Opening SSE connection to', BASE + '/api/stream');
  const sseRes = await fetch(BASE + '/api/stream', {
    headers: { Accept: 'text/event-stream' },
  });
  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const events = [];
  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const p of parts) {
          if (!p.trim()) continue;
          let type = 'message', data = '';
          for (const line of p.split('\n')) {
            if (line.startsWith('event:')) type = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          events.push({ type, data });
          console.log('  ⟵ SSE', type, data.slice(0, 120));
        }
      }
    } catch { /* ignore */ }
  })();

  await waitUntil(() => events.some(e => e.type === 'connected'), 3000);
  console.log('✓ SSE connected\n');

  // 2. Connect MCP client
  console.log('→ Connecting MCP client via stdio:', SERVER_CMD, SERVER_ARGS.join(' '));
  const transport = new StdioClientTransport({ command: SERVER_CMD, args: SERVER_ARGS });
  const client = new Client({ name: 'mcp-live-example', version: '0.1.0' });
  await client.connect(transport);
  console.log('✓ MCP connected\n');

  // 3. Create task
  console.log('→ task.create', { project: PROJECT, key: KEY, title: 'example live task' });
  const createResult = await client.callTool({
    name: 'task.create',
    arguments: { project: PROJECT, key: KEY, title: 'example live task' },
  });
  console.log('✓ task.create result:', createResult.content?.[0]?.text?.slice(0, 200));

  await waitUntil(() => events.some(e => e.type === 'created' && e.data.includes(KEY)), 3000);
  console.log('✓ SSE received created event\n');

  // 4. Transition task
  console.log('→ task.transition', { project: PROJECT, key: KEY, from: 'TODO', to: 'IN_PROGRESS' });
  const transResult = await client.callTool({
    name: 'task.transition',
    arguments: { project: PROJECT, key: KEY, from: 'TODO', to: 'IN_PROGRESS' },
  });
  console.log('✓ task.transition result:', transResult.content?.[0]?.text?.slice(0, 200));

  await waitUntil(() => events.some(e => e.type === 'transition' && e.data.includes(KEY)), 3000);
  console.log('✓ SSE received transition event\n');

  console.log('=== Example complete ===');
  process.exit(0);
}

function waitUntil(cond, ms) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      if (cond()) return resolve();
      if (Date.now() - t0 > ms) return reject(new Error('timeout'));
      setTimeout(tick, 50);
    };
    tick();
  });
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
