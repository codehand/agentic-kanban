/**
 * task-attributes.spec.ts — Playwright UI test for TASK-021.
 *
 * Verifies that the 5 task attributes (priority, complexity, estimate_hours,
 * tags, link_document) are present in the create form, displayed in the
 * detail drawer, and rendered as badges on board cards — and that editing
 * them in the drawer persists through PATCH /api/tasks/:key.
 *
 * The form test loads new-task.html via the ds-server static HTTP helper
 * (static markup assertions).
 * The board/drawer tests spawn a REAL server (node dev-server.mjs, requires
 * `pnpm build` first) on a dedicated port with a throwaway DB and seed a task
 * with all 5 attributes via POST /api/tasks — no API mocks.
 *
 * Screenshots are captured to docs/ui/TASK-021/.
 */
import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { startDsServer, type DsServer } from './ds-server';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(ROOT, 'docs/ui/TASK-021');

const PORT = 4621;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'e2e-task021-token';
const PROJECT = 'attr-proj';
const KEY = 'TASK-ATTR-DEMO';

let server: ChildProcess;
let dsServer: DsServer;
let dbPath: string;

function pageUrl(file: string): string {
  return dsServer.url(file);
}

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

test.describe('TASK-021: Task Attributes UI', () => {
  test.beforeAll(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    dsServer = await startDsServer();
    // tsc does not copy .sql migrations into dist/ — dev-server needs them.
    fs.cpSync(path.join(ROOT, 'server/src/db/migrations'), path.join(ROOT, 'dist/db/migrations'), { recursive: true });
    dbPath = path.join(os.tmpdir(), `task021-e2e-${Date.now()}.db`);
    server = spawn('node', ['dev-server.mjs'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, ADMIN_TOKEN: TOKEN },
      stdio: 'inherit',
    });
    await waitForServer();

    // Seed: a project and ONE task carrying all 5 attributes (real POSTs).
    await api('POST', '/api/projects', { slug: PROJECT, name: 'Attribute Project' });
    const created = await api('POST', '/api/tasks', {
      project: PROJECT,
      key: KEY,
      title: 'Demonstrate task attributes',
      body_md: '## Purpose\nDemo task to show all 5 attributes.\n',
      priority: 'P1',
      complexity: 'L',
      estimate_hours: 16,
      tags: ['feature', 'search', 'backend'],
      link_document: 'https://docs.example.com/search-spec',
    });
    expect(created.status).toBe(201);

    // Seed a gitref with an MR URL directly in the throwaway DB so the drawer
    // can show the PR link sourced from gitref.mr_url (no HTTP write endpoint
    // for gitrefs — that is an MCP tool).
    const db = new Database(dbPath);
    const task = db.prepare(`SELECT id FROM task WHERE key = ?`).get(KEY) as { id: string };
    db.prepare(`
      INSERT INTO gitref (id, task_id, repo, branch, base_sha, head_sha, mr_url, mr_state)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('ref_e2e_021', task.id, '.', 'fix/TASK-021', 'a'.repeat(40), 'b'.repeat(40),
      'https://github.com/example/repo/pull/42', 'open');
    db.close();
  });

  test.afterAll(async () => {
    if (server) server.kill('SIGTERM');
    if (dsServer) await dsServer.close();
    if (dbPath) { try { fs.unlinkSync(dbPath); } catch { /* ignore */ } }
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((tok) => {
      localStorage.setItem('kanban_token', tok);
    }, TOKEN);
  });

  test('new-task form has all attribute fields with correct options', async ({ page }) => {
    await page.goto(pageUrl('new-task.html'));

    // Priority select with P0–P3 options
    const priority = page.locator('#field-priority');
    await expect(priority).toBeVisible();
    const prioOptions = await priority.locator('option').allTextContents();
    expect(prioOptions.some((t) => t.includes('P0'))).toBeTruthy();
    expect(prioOptions.some((t) => t.includes('P3'))).toBeTruthy();

    // Complexity select with XS–XL options
    const complexity = page.locator('#field-complexity');
    await expect(complexity).toBeVisible();
    const compOptions = await complexity.locator('option').allTextContents();
    expect(compOptions.some((t) => t.includes('XS'))).toBeTruthy();
    expect(compOptions.some((t) => t.includes('XL'))).toBeTruthy();

    // Estimate hours input (type=number, min=0)
    const estimate = page.locator('#field-estimate_hours');
    await expect(estimate).toBeVisible();
    await expect(estimate).toHaveAttribute('type', 'number');
    await expect(estimate).toHaveAttribute('min', '0');

    // Tags input
    await expect(page.locator('#field-tags')).toBeVisible();

    // Link document input (type=url)
    const linkDoc = page.locator('#field-link_document');
    await expect(linkDoc).toBeVisible();
    await expect(linkDoc).toHaveAttribute('type', 'url');

    // Fill values and verify they persist in the form
    await priority.selectOption('P1');
    await complexity.selectOption('M');
    await estimate.fill('8');
    await page.locator('#field-tags').fill('backend, api');
    await linkDoc.fill('https://docs.example.com/test');

    expect(await priority.inputValue()).toBe('P1');
    expect(await complexity.inputValue()).toBe('M');
    expect(await estimate.inputValue()).toBe('8');
    expect(await page.locator('#field-tags').inputValue()).toBe('backend, api');
    expect(await linkDoc.inputValue()).toBe('https://docs.example.com/test');

    await page.screenshot({ path: path.join(OUT_DIR, 'form-attributes.png'), fullPage: true });
  });

  test('board card renders priority badge and tags from real task data', async ({ page }) => {
    await page.goto(`${BASE}/${PROJECT}/index.html`);

    // The seeded task card appears on the real board.
    const card = page.locator('article', { hasText: KEY }).first();
    await expect(card).toBeVisible();

    // Priority badge is rendered on the card
    await expect(card.locator('span', { hasText: /^P1$/ }).first()).toBeVisible();

    // Tag badges are rendered on the card
    await expect(card.locator('span', { hasText: /^feature$/ }).first()).toBeVisible();
    await expect(card.locator('span', { hasText: /^search$/ }).first()).toBeVisible();

    await page.screenshot({ path: path.join(OUT_DIR, 'board-card-badges.png'), fullPage: true });
  });

  test('detail drawer shows all attributes with correct values', async ({ page }) => {
    await page.goto(`${BASE}/${PROJECT}/index.html`);

    // Click the task card to open the drawer
    await page.locator('article', { hasText: KEY }).first().click();

    // Wait for drawer to open and show the task title
    await page.waitForFunction(
      () => {
        const drawer = document.getElementById('drawer');
        return drawer && !drawer.classList.contains('translate-x-full')
          && (document.getElementById('drawer-title')?.textContent || '').includes('Demonstrate');
      },
      { timeout: 15000 },
    );

    // Verify attribute display section in drawer body
    const drawerBody = page.locator('#drawer-body');

    // Priority P1 badge displayed
    await expect(drawerBody.locator('span', { hasText: /^P1$/ }).first()).toBeVisible();

    // Complexity L displayed
    await expect(drawerBody.locator('span', { hasText: /^L$/ }).first()).toBeVisible();

    // Estimate 16h displayed
    await expect(drawerBody.locator('span', { hasText: /^16h$/ }).first()).toBeVisible();

    // Tags displayed
    await expect(drawerBody.locator('span', { hasText: /^feature$/ }).first()).toBeVisible();
    await expect(drawerBody.locator('span', { hasText: /^search$/ }).first()).toBeVisible();
    await expect(drawerBody.locator('span', { hasText: /^backend$/ }).first()).toBeVisible();

    // Link document link displayed
    await expect(drawerBody.locator('a[href="https://docs.example.com/search-spec"]').first()).toBeVisible();

    // PR link sourced from gitref.mr_url (no separate PR column)
    await expect(drawerBody.locator('a[href="https://github.com/example/repo/pull/42"]').first()).toBeVisible();

    await page.screenshot({ path: path.join(OUT_DIR, 'detail-attributes-view.png'), fullPage: true });
  });

  test('detail drawer edit form is populated and saving persists via PATCH', async ({ page }) => {
    await page.goto(`${BASE}/${PROJECT}/index.html`);

    // Click card to open drawer
    await page.locator('article', { hasText: KEY }).first().click();

    // Wait for drawer to open
    await page.waitForFunction(
      () => {
        const drawer = document.getElementById('drawer');
        return drawer && !drawer.classList.contains('translate-x-full')
          && (document.getElementById('drawer-title')?.textContent || '').includes('Demonstrate');
      },
      { timeout: 15000 },
    );

    // Click the Edit button to toggle to edit mode
    const editBtn = page.locator('#btn-edit-attrs');
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    // Wait for edit form to appear (attrs-edit loses .hidden)
    await page.waitForFunction(
      () => {
        const editEl = document.getElementById('attrs-edit');
        return editEl && !editEl.classList.contains('hidden');
      },
      { timeout: 5000 },
    );

    // Verify all 5 edit fields are present
    await expect(page.locator('#edit-priority')).toBeVisible();
    await expect(page.locator('#edit-complexity')).toBeVisible();
    await expect(page.locator('#edit-estimate_hours')).toBeVisible();
    await expect(page.locator('#edit-tags')).toBeVisible();
    await expect(page.locator('#edit-link_document')).toBeVisible();

    // Verify current values are populated from the real task
    expect(await page.locator('#edit-priority').inputValue()).toBe('P1');
    expect(await page.locator('#edit-complexity').inputValue()).toBe('L');
    expect(await page.locator('#edit-estimate_hours').inputValue()).toBe('16');
    expect(await page.locator('#edit-tags').inputValue()).toBe('feature, search, backend');
    expect(await page.locator('#edit-link_document').inputValue()).toBe('https://docs.example.com/search-spec');

    await page.screenshot({ path: path.join(OUT_DIR, 'detail-drawer-priority-tags.png'), fullPage: true });

    // Edit priority + estimate and save (real PATCH /api/tasks/:key)
    await page.locator('#edit-priority').selectOption('P0');
    await page.locator('#edit-estimate_hours').fill('24');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('#edit-attrs-msg')).toHaveText('Saved!');

    // The drawer reloads (~600ms) and the display section shows the new values.
    await expect(page.locator('#drawer-body span', { hasText: /^P0$/ }).first()).toBeVisible();
    await expect(page.locator('#drawer-body span', { hasText: /^24h$/ }).first()).toBeVisible();

    // And the change is persisted server-side (real GET, not the UI's echo).
    const res = await api('GET', `/api/tasks/${KEY}?project=${PROJECT}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { task: { priority: string; estimate_hours: number; complexity: string; tags: string[] } };
    expect(body.task.priority).toBe('P0');
    expect(body.task.estimate_hours).toBe(24);
    // Untouched fields preserved
    expect(body.task.complexity).toBe('L');
    expect(body.task.tags).toEqual(['feature', 'search', 'backend']);
  });
});
