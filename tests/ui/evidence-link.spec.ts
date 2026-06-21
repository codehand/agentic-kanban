/**
 * evidence-link.spec.ts — Playwright UI test for TASK-052.
 *
 * The bug: in the board task-detail drawer (design-system/index.html), the
 * "View full evidence" link was hardcoded `<a href="evidence.html">` with no
 * task fragment. evidence.html resolves which task to show from the project in
 * the URL path AND the task key in `location.hash`; without `#<taskKey>` it
 * early-returns and renders nothing. The fix makes the href carry the current
 * task's key: `evidence.html#<selectedTask.key>`.
 *
 * This spec spawns a REAL server (node dev-server.mjs, requires `pnpm build`
 * first) on a dedicated port with a throwaway DB, seeds a task via the real
 * POST /api/tasks, then inserts an evidence row straight into that DB (there is
 * no REST endpoint for evidence — it normally arrives via the MCP runner flow)
 * so the drawer renders its Evidence section + the "View full evidence" link.
 * It opens the drawer from the board and asserts the anchor href ends with
 * `evidence.html#<that seeded key>` — the actual key, read back from the DB,
 * not a hardcoded constant. No API mocks.
 */
import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

const PORT = 4652;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'e2e-task052-token';
const PROJECT = 'evidence-link-proj';
const TASK_KEY = 'TASK-052-EV';

let server: ChildProcess;
let dbPath: string;

async function api(method: string, p: string, body?: unknown): Promise<Response> {
  return fetch(`${BASE}${p}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('dev server did not come up on ' + BASE);
}

test.describe('TASK-052: View full evidence link carries the current task key', () => {
  test.beforeAll(async () => {
    // tsc does not copy .sql migrations into dist/ — dev-server needs them.
    fs.cpSync(path.join(ROOT, 'server/src/db/migrations'), path.join(ROOT, 'dist/db/migrations'), { recursive: true });
    dbPath = path.join(os.tmpdir(), `task052-e2e-${Date.now()}.db`);
    server = spawn('node', ['dev-server.mjs'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, ADMIN_TOKEN: TOKEN },
      stdio: 'inherit',
    });
    await waitForServer();

    // Seed a project + task via the real API (no mocks).
    await api('POST', '/api/projects', { slug: PROJECT, name: 'Evidence Link Project' });
    const created = await api('POST', '/api/tasks', {
      project: PROJECT,
      key: TASK_KEY,
      title: 'Task with evidence',
      body_md: '## Purpose\nA task that has build/test evidence.\n',
    });
    expect(created.status).toBe(201);

    // Give the task evidence. There is no REST endpoint for evidence (it flows
    // through the MCP runner path), so insert one row directly into the same
    // DB the dev-server reads — using the real task id looked up by key.
    const db = new Database(dbPath);
    try {
      const row = db.prepare('SELECT id FROM task WHERE key = ?').get(TASK_KEY) as { id: string } | undefined;
      expect(row?.id, 'seeded task must exist in the DB').toBeTruthy();
      db.prepare(`
        INSERT INTO evidence (id, task_id, submitted_by_token_id, build_exit, test_exit, ac_exit)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(`ev_${randomBytes(8).toString('hex')}`, row!.id, 'runner-seed', 0, 0, 0);
    } finally {
      db.close();
    }

    // Sanity: the API now returns evidence for the task.
    const res = await api('GET', `/api/tasks/${TASK_KEY}?project=${PROJECT}`);
    expect(res.status).toBe(200);
    const got = (await res.json()) as { evidence: { build_exit: number } | null };
    expect(got.evidence?.build_exit).toBe(0);
  });

  test.afterAll(async () => {
    if (server) server.kill('SIGTERM');
    if (dbPath) { try { fs.unlinkSync(dbPath); } catch { /* ignore */ } }
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((tok) => {
      localStorage.setItem('kanban_token', tok);
    }, TOKEN);
  });

  test('board drawer "View full evidence" link points at evidence.html#<task key>', async ({ page }) => {
    await page.goto(`${BASE}/${PROJECT}/index.html`);

    // Open the seeded task's drawer from its board card.
    await page.locator('article', { hasText: TASK_KEY }).first().click();
    await page.waitForFunction(
      () => {
        const drawer = document.getElementById('drawer');
        return !!drawer && !drawer.classList.contains('translate-x-full')
          && (document.getElementById('drawer-title')?.textContent || '').includes('Task with evidence');
      },
      { timeout: 15000 },
    );

    // The Evidence section + its "View full evidence" link must render.
    const link = page.locator('#drawer-body a', { hasText: 'View full evidence' });
    await expect(link).toBeVisible();

    // The href must carry THIS task's key as the hash — parameterised on the
    // actually-seeded key, not a hardcoded literal.
    const href = await link.getAttribute('href');
    expect(href).toBeTruthy();
    expect(href!.endsWith(`evidence.html#${TASK_KEY}`)).toBe(true);
  });
});
