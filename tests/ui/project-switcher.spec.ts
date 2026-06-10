/**
 * project-switcher.spec.ts — Playwright E2E test for the project switcher (TASK-022).
 *
 * Spawns a REAL server (node dev-server.mjs, requires `pnpm build` first) on a
 * dedicated port with a throwaway DB, seeds two projects with distinct tasks via
 * POST /api/projects + POST /api/tasks, then asserts:
 *   - /<project>/index.html shows ONLY that project's tasks.
 *   - The rail dropdown lists the real projects and marks the current one.
 *   - Selecting another project navigates to /<other>/index.html and the board changes.
 *   - 0 projects (mocked) → board redirects to first-run.html with the create CTA.
 *
 * Screenshots are written to docs/ui/TASK-022/.
 *
 * Run:
 *   pnpm build && pnpm exec playwright test tests/ui/project-switcher.spec.ts
 */
import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(ROOT, 'docs/ui/TASK-022');

const PORT = 4622;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'e2e-task022-token';

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

test.beforeAll(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // tsc does not copy .sql migrations into dist/ — dev-server needs them.
  fs.cpSync(path.join(ROOT, 'server/src/db/migrations'), path.join(ROOT, 'dist/db/migrations'), { recursive: true });
  dbPath = path.join(os.tmpdir(), `task022-e2e-${Date.now()}.db`);
  server = spawn('node', ['dev-server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, ADMIN_TOKEN: TOKEN },
    stdio: 'inherit',
  });
  await waitForServer();

  // Seed: two projects, one distinct task each (idempotent across reruns via 409).
  await api('POST', '/api/projects', { slug: 'proj-alpha', name: 'Project Alpha' });
  await api('POST', '/api/projects', { slug: 'proj-beta', name: 'Project Beta' });
  await api('POST', '/api/tasks', { project: 'proj-alpha', key: 'ALPHA-1', title: 'Alpha only task' });
  await api('POST', '/api/tasks', { project: 'proj-beta', key: 'BETA-1', title: 'Beta only task' });
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

test('board at /<project>/index.html shows only that project; dropdown switches project (URL + board change)', async ({ page }) => {
  await page.goto(`${BASE}/proj-alpha/index.html`);

  // Board filtered to proj-alpha.
  await expect(page.locator('#board-columns')).toBeVisible();
  await expect(page.getByText('Alpha only task')).toBeVisible();
  await expect(page.getByText('Beta only task')).toHaveCount(0);
  await expect(page.locator('#topbar-project')).toHaveText('proj-alpha');
  await page.screenshot({ path: path.join(OUT_DIR, '01-board-proj-alpha.png') });

  // Dropdown: real project list, current marked.
  const btn = page.locator('#project-switcher');
  await expect(btn).toContainText('proj-alpha');
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await btn.click();
  const menu = page.locator('#project-menu');
  await expect(menu).toBeVisible();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.locator('a[role="menuitem"]')).toHaveCount(2);
  await expect(menu.locator('a[aria-current="true"]')).toContainText('proj-alpha');
  await page.screenshot({ path: path.join(OUT_DIR, '02-dropdown-open.png') });

  // Select the other project → URL changes to /proj-beta/index.html, board changes.
  await menu.getByText('proj-beta').click();
  await page.waitForURL('**/proj-beta/index.html');
  expect(new URL(page.url()).pathname).toBe('/proj-beta/index.html');
  await expect(page.locator('#board-columns')).toBeVisible();
  await expect(page.getByText('Beta only task')).toBeVisible();
  await expect(page.getByText('Alpha only task')).toHaveCount(0);
  await expect(page.locator('#topbar-project')).toHaveText('proj-beta');
  await page.screenshot({ path: path.join(OUT_DIR, '03-switch-proj-beta.png') });
});

test('Escape closes the dropdown (keyboard a11y)', async ({ page }) => {
  await page.goto(`${BASE}/proj-alpha/index.html`);
  const btn = page.locator('#project-switcher');
  await btn.click();
  await expect(page.locator('#project-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#project-menu')).toBeHidden();
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
});

test('assets load via absolute paths under a project-prefixed URL', async ({ page }) => {
  const cssResponse = page.waitForResponse((r) => r.url().endsWith('/theme.css') && r.status() === 200);
  await page.goto(`${BASE}/proj-alpha/index.html`);
  await cssResponse;
  // shell.js executed (rail injected) proves /shell.js resolved.
  await expect(page.locator('#project-switcher')).toBeVisible();
});

test('0 projects → board redirects to first-run guide with create CTA', async ({ page }) => {
  // Mock the project list as empty on top of the real server.
  await page.route('**/api/projects', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ projects: [] }),
      });
    } else {
      await route.continue();
    }
  });
  await page.goto(`${BASE}/index.html`);
  await page.waitForURL('**/first-run.html');
  await expect(page.locator('#btn-create-project')).toBeVisible();
  await page.screenshot({ path: path.join(OUT_DIR, '04-empty-first-run.png') });
});

test('create first project via UI → redirect to /<slug>/index.html with empty board', async ({ page }) => {
  await page.goto(`${BASE}/first-run.html`);
  await page.locator('#btn-create-project').click();
  const unique = `proj-ui-${Date.now().toString(36)}`;
  await page.locator('#field-project-name').fill(unique);
  await page.locator('#btn-create-project-submit').click();
  await page.waitForURL(`**/${unique}/index.html`);
  expect(new URL(page.url()).pathname).toBe(`/${unique}/index.html`);
  // New project has no tasks → empty board state.
  await expect(page.locator('#board-empty')).toBeVisible();
  await page.screenshot({ path: path.join(OUT_DIR, '05-create-first-project-redirect.png') });
});
