/**
 * depends-on.spec.ts — Playwright UI test for TASK-050.
 *
 * The bug: the task-detail drawer never rendered task dependencies even though
 * GET /api/tasks/:key returns task.depends_on (array of task keys). Both the
 * board drawer (design-system/index.html) and the flat-list drawer
 * (design-system/tasks.js) only built Spec / Repos & MR / Evidence sections.
 *
 * This spec spawns a REAL server (node dev-server.mjs, requires `pnpm build`
 * first) on a dedicated port with a throwaway DB, seeds TWO tasks via real
 * POST /api/tasks where the second declares depends_on: ["<first-key>"], then
 * opens the dependent task's drawer from BOTH the board (index.html) and the
 * flat list (tasks.html) and asserts the drawer shows the "Depends on" heading
 * AND the dependency key. No API mocks.
 */
import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

const PORT = 4650;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'e2e-task050-token';
const PROJECT = 'deps-proj';
const DEP_KEY = 'TASK-050-DEP';
const MAIN_KEY = 'TASK-050-MAIN';

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

test.describe('TASK-050: Depends on section in task drawer', () => {
  test.beforeAll(async () => {
    // tsc does not copy .sql migrations into dist/ — dev-server needs them.
    fs.cpSync(path.join(ROOT, 'server/src/db/migrations'), path.join(ROOT, 'dist/db/migrations'), { recursive: true });
    dbPath = path.join(os.tmpdir(), `task050-e2e-${Date.now()}.db`);
    server = spawn('node', ['dev-server.mjs'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, ADMIN_TOKEN: TOKEN },
      stdio: 'inherit',
    });
    await waitForServer();

    // Seed: a project + the dependency task, then the dependent task that
    // declares depends_on: [DEP_KEY] (real POSTs, no mocks).
    await api('POST', '/api/projects', { slug: PROJECT, name: 'Dependencies Project' });
    const dep = await api('POST', '/api/tasks', {
      project: PROJECT,
      key: DEP_KEY,
      title: 'Upstream dependency task',
      body_md: '## Purpose\nThe task others depend on.\n',
    });
    expect(dep.status).toBe(201);
    const main = await api('POST', '/api/tasks', {
      project: PROJECT,
      key: MAIN_KEY,
      title: 'Dependent task',
      body_md: '## Purpose\nThis task depends on another.\n',
      depends_on: [DEP_KEY],
    });
    expect(main.status).toBe(201);

    // Sanity: the API really returns depends_on for the dependent task.
    const res = await api('GET', `/api/tasks/${MAIN_KEY}?project=${PROJECT}`);
    expect(res.status).toBe(200);
    const got = (await res.json()) as { task: { depends_on: string[] } };
    expect(got.task.depends_on).toEqual([DEP_KEY]);
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

  test('board drawer renders Depends on + the dependency key', async ({ page }) => {
    await page.goto(`${BASE}/${PROJECT}/index.html`);

    // Open the dependent task's drawer from its board card.
    await page.locator('article', { hasText: MAIN_KEY }).first().click();
    await page.waitForFunction(
      () => {
        const drawer = document.getElementById('drawer');
        return drawer && !drawer.classList.contains('translate-x-full')
          && (document.getElementById('drawer-title')?.textContent || '').includes('Dependent task');
      },
      { timeout: 15000 },
    );

    const drawerBody = page.locator('#drawer-body');
    await expect(drawerBody.getByRole('heading', { name: 'Depends on' })).toBeVisible();
    await expect(drawerBody.locator('button', { hasText: DEP_KEY }).first()).toBeVisible();
  });

  test('flat-list drawer renders Depends on + the dependency key', async ({ page }) => {
    await page.goto(`${BASE}/${PROJECT}/tasks.html`);

    // Open the dependent task's drawer from its table row.
    await page.locator('tr', { hasText: MAIN_KEY }).first().click();
    await page.waitForFunction(
      () => {
        const drawer = document.getElementById('drawer');
        return drawer && !drawer.classList.contains('translate-x-full')
          && (document.getElementById('drawer-title')?.textContent || '').includes('Dependent task');
      },
      { timeout: 15000 },
    );

    const drawerBody = page.locator('#drawer-body');
    await expect(drawerBody.getByRole('heading', { name: 'Depends on' })).toBeVisible();
    await expect(drawerBody.locator('button', { hasText: DEP_KEY }).first()).toBeVisible();
  });

  test('dependency chip click opens the upstream task drawer', async ({ page }) => {
    await page.goto(`${BASE}/${PROJECT}/index.html`);

    await page.locator('article', { hasText: MAIN_KEY }).first().click();
    await page.waitForFunction(
      () => {
        const drawer = document.getElementById('drawer');
        return drawer && !drawer.classList.contains('translate-x-full')
          && (document.getElementById('drawer-title')?.textContent || '').includes('Dependent task');
      },
      { timeout: 15000 },
    );

    // Clicking the chip re-opens the drawer for the upstream task.
    await page.locator('#drawer-body button', { hasText: DEP_KEY }).first().click();
    await page.waitForFunction(
      () => (document.getElementById('drawer-title')?.textContent || '').includes('Upstream dependency'),
      { timeout: 15000 },
    );
  });
});
