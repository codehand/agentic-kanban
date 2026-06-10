#!/usr/bin/env node
/**
 * index.mjs — Minimal MCP client (from scratch) that lists projects and
 * creates a new one over the server's Streamable HTTP /mcp endpoint.
 *
 * Scenario (TASK-022):
 *   1. project.list  — show what exists.
 *   2. project.create — create a unique project.
 *   3. project.list  — prove the new project is visible.
 *   4. GET /<slug>/index.html — prove path-based routing serves its board.
 *
 * Env vars:
 *   KANBAN_URL   — server base URL (default http://localhost:3000)
 *   KANBAN_TOKEN — bearer token with task.create permission (human)
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const BASE = process.env.KANBAN_URL || 'http://localhost:3000';
const TOKEN = process.env.KANBAN_TOKEN || '';

if (!TOKEN) {
  console.error('KANBAN_TOKEN env var is required');
  process.exit(2);
}

const SLUG = 'proj-mcp-' + Date.now().toString(36);

async function main() {
  console.log('→ Connecting MCP client to', BASE + '/mcp');
  const transport = new StreamableHTTPClientTransport(new URL(BASE + '/mcp'), {
    requestInit: { headers: { Authorization: 'Bearer ' + TOKEN } },
  });
  const client = new Client({ name: 'projects-example', version: '0.1.0' });
  await client.connect(transport);
  console.log('✓ MCP connected\n');

  // 1. List projects
  console.log('→ project.list');
  const before = await client.callTool({ name: 'project.list', arguments: {} });
  const beforeRows = JSON.parse(before.content?.[0]?.text ?? '[]');
  console.log(`✓ project.list: ${beforeRows.length} project(s)`);
  for (const p of beforeRows) console.log(`    - ${p.slug} (${p.id})`);
  console.log();

  // 2. Create a project
  console.log('→ project.create', { slug: SLUG, name: 'MCP Example Project' });
  const created = await client.callTool({
    name: 'project.create',
    arguments: { slug: SLUG, name: 'MCP Example Project' },
  });
  const project = JSON.parse(created.content?.[0]?.text ?? '{}');
  console.log('✓ project.create:', project.id, project.slug);
  console.log();

  // 3. List again — must contain the new project
  console.log('→ project.list (after create)');
  const after = await client.callTool({ name: 'project.list', arguments: {} });
  const afterRows = JSON.parse(after.content?.[0]?.text ?? '[]');
  const found = afterRows.find((p) => p.slug === SLUG);
  if (!found) throw new Error('created project not found in project.list');
  console.log(`✓ project.list: ${afterRows.length} project(s) — contains ${SLUG}`);
  console.log();

  // 4. Path-based routing serves the new project's board
  console.log(`→ GET ${BASE}/${SLUG}/index.html`);
  const res = await fetch(`${BASE}/${SLUG}/index.html`);
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
  const html = await res.text();
  if (!html.includes('id="board-columns"')) throw new Error('board markup missing');
  console.log('✓ board served for', `/${SLUG}/index.html`);
  console.log();

  console.log('=== Example complete ===');
  await client.close();
  process.exit(0);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
