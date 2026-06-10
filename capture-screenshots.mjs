#!/usr/bin/env node
/**
 * capture-screenshots.mjs — TASK-017 real E2E screenshot capture.
 *
 * Starts the server with a file-backed DB, seeds a project + token,
 * then uses Playwright to capture real screenshots of:
 *   1. Toast on task create (via HTTP API → broadcastCreated → SSE → UI)
 *   2. Toast on task transition (via HTTP approve → broadcastTransition → SSE → UI)
 *   3. Board after auto-loading the created task
 *   4. Board after task transitioned to DONE
 *
 * Both HTTP and MCP write paths call the same broadcastCreated/broadcastTransition
 * functions in stream.ts — the SSE/UI flow is identical.
 *
 * Output: docs/ui/TASK-017/*.png (real browser captures).
 *
 * Usage:
 *   node capture-screenshots.mjs
 */
import { chromium } from 'playwright';
import { openDatabase } from './dist/db/connection.js';
import { runMigrations } from './dist/db/migrate.js';
import { bootstrapAdminToken } from './dist/auth/bootstrap.js';
import { createHttpServer } from './dist/http/server.js';
import { insertProject } from './dist/db/repositories/project.js';
import { getTaskByKey } from './dist/db/repositories/task.js';
import { randomBytes } from 'node:crypto';
import { mkdirSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, 'docs/ui/TASK-017');
const PORT = 4599;
const ADMIN_TOKEN = 'tk_test_' + randomBytes(8).toString('hex');
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = '/tmp/task017-capture.db';

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  // Clean up any previous DB
  try { unlinkSync(DB_PATH); } catch {}
  try { unlinkSync(DB_PATH + '-wal'); } catch {}
  try { unlinkSync(DB_PATH + '-shm'); } catch {}

  // 1. Start server with file-backed DB (so we can manipulate state between requests)
  const db = openDatabase(DB_PATH);
  runMigrations(db);
  bootstrapAdminToken(db, ADMIN_TOKEN);
  const projId = 'proj_opf';
  insertProject(db, { id: projId, slug: 'opf-hub', name: 'OPF Hub' });
  insertProject(db, { id: 'proj_other', slug: 'other-proj', name: 'Other Project' });

  const server = createHttpServer(db);
  await new Promise((r) => server.listen(PORT, r));
  console.log(`Server running on ${BASE}`);
  console.log(`Token: ${ADMIN_TOKEN}`);

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + ADMIN_TOKEN,
  };

  try {
    // 2. Launch browser
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    // Collect SSE console logs
    page.on('console', (msg) => {
      const t = msg.text();
      if (t.includes('[sse]')) console.log('  BROWSER:', t);
    });

    // 3. Navigate to board and authenticate
    await page.goto(BASE + '/');
    await page.evaluate((t) => { window.localStorage.setItem('kanban_token', t); }, ADMIN_TOKEN);
    await page.goto(BASE + '/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
    // Set the viewed project
    await page.evaluate(() => { document.body.dataset.project = 'opf-hub'; });
    await page.waitForTimeout(500);
    console.log('Board loaded');

    // 4. Create a task via HTTP API (triggers broadcastCreated → SSE → UI)
    const key = 'LIVE-' + Date.now().toString(36).toUpperCase();
    console.log(`Creating task ${key} via HTTP POST /api/tasks...`);
    const createRes = await fetch(BASE + '/api/tasks', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'opf-hub',
        key,
        title: 'Live UI test — auto-loaded via SSE',
        body_md: 'Created to verify SSE live updates (TASK-017).',
      }),
    });
    console.log('  → status:', createRes.status);

    // 5. Wait for toast and capture
    const toast = page.locator('#toast');
    await toast.waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(OUT_DIR, 'toast-created.png'), fullPage: true });
    console.log('Captured toast-created.png');

    // 6. Wait for card to appear in TODO column
    const todoCol = page.locator('#col-todo');
    await todoCol.getByText(key).waitFor({ state: 'visible', timeout: 5000 });
    await page.screenshot({ path: resolve(OUT_DIR, 'board-autoload.png'), fullPage: true });
    console.log('Captured board-autoload.png');

    // 7. Set up a task in JUDGE_PASSED state to test transition toast via approve
    const transKey = 'TR-' + Date.now().toString(36).toUpperCase();
    // Create it
    await fetch(BASE + '/api/tasks', {
      method: 'POST',
      headers,
      body: JSON.stringify({ project: 'opf-hub', key: transKey, title: 'Transition test task' }),
    });
    // Manually set state to JUDGE_PASSED in DB
    const transTask = getTaskByKey(db, projId, transKey);
    if (transTask) {
      db.prepare(`UPDATE task SET state = 'JUDGE_PASSED', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`).run(transTask.id);
      console.log(`Set task ${transKey} to JUDGE_PASSED`);
    }

    // 8. Approve the task via HTTP (triggers broadcastTransition → SSE → UI)
    console.log(`Approving task ${transKey} via HTTP POST /api/tasks/${transKey}/approve...`);
    const approveRes = await fetch(BASE + `/api/tasks/${transKey}/approve?project=opf-hub`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ note: 'Approved via screenshot capture script' }),
    });
    console.log('  → status:', approveRes.status);

    // 9. Wait for transition toast and capture
    await toast.waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(OUT_DIR, 'toast-transition.png'), fullPage: true });
    console.log('Captured toast-transition.png');

    // 10. Wait for board to update and capture final state
    await page.waitForTimeout(1000);
    await page.screenshot({ path: resolve(OUT_DIR, 'mcp-live-flow.png'), fullPage: true });
    console.log('Captured mcp-live-flow.png');

    // 11. Project scoping test: create task in other project — toast should NOT appear
    console.log('Testing project scoping: creating task in other-proj...');
    await page.waitForTimeout(3500); // wait for current toast to hide

    const toastWatcher = page.evaluate(() => {
      return new Promise((resolve) => {
        const el = document.getElementById('toast');
        if (!el.classList.contains('hidden')) { resolve('already-visible'); return; }
        const obs = new MutationObserver(() => {
          if (!el.classList.contains('hidden')) { obs.disconnect(); resolve('shown'); }
        });
        obs.observe(el, { attributes: true, attributeFilter: ['class'] });
        setTimeout(() => { obs.disconnect(); resolve('not-shown'); }, 4000);
      });
    });

    await fetch(BASE + '/api/tasks', {
      method: 'POST',
      headers,
      body: JSON.stringify({ project: 'other-proj', key: 'OTHER-1', title: 'Wrong project task' }),
    });

    const scopeResult = await toastWatcher;
    console.log('Project scoping test:', scopeResult === 'not-shown' ? 'PASS (toast suppressed for other project)' : 'RESULT: ' + scopeResult);

    await browser.close();
    console.log('\nAll screenshots captured to', OUT_DIR);
  } finally {
    server.close();
    db.close();
    try { unlinkSync(DB_PATH); } catch {}
    try { unlinkSync(DB_PATH + '-wal'); } catch {}
    try { unlinkSync(DB_PATH + '-shm'); } catch {}
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
