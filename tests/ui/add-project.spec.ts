/**
 * add-project.spec.ts — Playwright E2E test for the "Add project" CTA on projects.html.
 *
 * The tile was rendered as inert markup (no click handler), so the CTA did
 * nothing. Asserts the wired flow against a REAL server (requires `pnpm build`):
 *   - Clicking "Add project" reveals the create form.
 *   - Submitting creates the project and redirects to /<slug>/index.html.
 *   - A duplicate slug surfaces the server error instead of navigating.
 *
 * Run:
 *   pnpm build && pnpm exec playwright test tests/ui/add-project.spec.ts
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

const PORT = 4626;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'e2e-add-project-token';

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
  // tsc does not copy .sql migrations into dist/ — dev-server needs them.
  fs.cpSync(path.join(ROOT, 'server/src/db/migrations'), path.join(ROOT, 'dist/db/migrations'), { recursive: true });
  dbPath = path.join(os.tmpdir(), `add-project-e2e-${Date.now()}.db`);
  server = spawn('node', ['dev-server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, ADMIN_TOKEN: TOKEN },
    stdio: 'inherit',
  });
  await waitForServer();
  await api('POST', '/api/projects', { slug: 'proj-existing', name: 'Existing Project' });
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

test('Add project CTA opens the form and creates a project → redirects to its board', async ({ page }) => {
  await page.goto(`${BASE}/projects.html`);

  const form = page.locator('#add-project-form');
  await expect(form).toBeHidden();

  await page.locator('#btn-add-project').click();
  await expect(form).toBeVisible();
  await expect(page.locator('#field-project-name')).toBeFocused();

  const slug = `proj-added-${Date.now().toString(36)}`;
  await page.locator('#field-project-name').fill(slug);
  await page.locator('#btn-add-project-submit').click();

  await page.waitForURL(`**/${slug}/index.html`);
  expect(new URL(page.url()).pathname).toBe(`/${slug}/index.html`);
  // Brand-new project → empty board.
  await expect(page.locator('#board-empty')).toBeVisible();

  // And it now shows up in the list.
  await page.goto(`${BASE}/projects.html`);
  await expect(page.locator('#projects-grid')).toContainText(slug);
});

test('duplicate slug shows the server error and stays on the page', async ({ page }) => {
  await page.goto(`${BASE}/projects.html`);
  await page.locator('#btn-add-project').click();
  await page.locator('#field-project-name').fill('proj-existing');
  await page.locator('#btn-add-project-submit').click();

  const err = page.locator('#add-project-error');
  await expect(err).toBeVisible();
  await expect(err).toContainText(/already exists/i);
  expect(new URL(page.url()).pathname).toBe('/projects.html');
  // Retry stays possible — the submit button is re-enabled.
  await expect(page.locator('#btn-add-project-submit')).toBeEnabled();
});
