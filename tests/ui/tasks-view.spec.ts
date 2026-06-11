/**
 * tasks-view.spec.ts — Playwright spec for TASK-023.
 *
 * Asserts:
 *   - Board page's rail links "Tasks" to tasks.html (not index.html).
 *   - Navigating to tasks.html loads, marks Tasks active, and renders a list of tasks.
 *   - Clicking a row opens the task detail drawer.
 *
 * Serves design-system/ over HTTP (ds-server helper) and mocks /api/* by
 * overriding window.fetch in the page.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startDsServer, type DsServer } from './ds-server';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_DIR = path.resolve(__dirname, '../../docs/ui/TASK-023');

let server: DsServer;

function pageUrl(file: string): string {
  return server.url(file);
}

async function mockApi(page: any) {
  // Override fetch in the page; survives the shell's project-prefix redirect
  // (addInitScript re-runs on every navigation in the context).
  await page.addInitScript(() => {
    const PROJECTS_RESP = JSON.stringify({ projects: [{ id: 'p1', slug: 'opf-hub', name: 'opf-hub' }] });
    const TASKS_RESP = JSON.stringify({
      tasks: [
        { key: 'TASK-001', title: 'Set up shell', state: 'DONE', updated_at: new Date().toISOString() },
        { key: 'TASK-010', title: 'Board kanban view', state: 'IN_PROGRESS', updated_at: new Date().toISOString() },
        { key: 'TASK-023', title: 'Tasks list view', state: 'TODO', updated_at: new Date().toISOString() },
      ],
    });
    const TASK_DETAIL = JSON.stringify({
      task: {
        key: 'TASK-023',
        title: 'Tasks list view',
        state: 'TODO',
        body_md: 'Create a flat list view for tasks.',
        updated_at: new Date().toISOString(),
      },
      gitrefs: [],
      evidence: null,
      timeline: [],
    });

    const origFetch = window.fetch.bind(window);
    window.fetch = async function (input: any, init?: any) {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/api/projects')) {
        return new Response(PROJECTS_RESP, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/tasks/')) {
        return new Response(TASK_DETAIL, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/tasks')) {
        return new Response(TASKS_RESP, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return origFetch(input, init);
    };
  });
}

test.describe('TASK-023: Tasks list view', () => {
  test.beforeAll(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    server = await startDsServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  test.beforeEach(async ({ context }) => {
    // Seed a dummy token so api.js doesn't redirect to signin.html.
    await context.addInitScript(() => {
      localStorage.setItem('kanban_token', 'test-token');
    });
  });

  test('rail Tasks link points to tasks.html (not index.html)', async ({ page }) => {
    await mockApi(page);
    await page.goto(pageUrl('index.html'));
    // Wait on the visible nav links: with projects mocked, the (hidden)
    // project-switcher dropdown also contains <a> elements inside #rail.
    await page.waitForSelector('#rail nav a', { timeout: 5000 });

    const tasksLink = page.locator('#rail a[href="tasks.html"]');
    await expect(tasksLink).toHaveCount(1);
    await expect(tasksLink).toContainText('Tasks');
  });

  test('tasks.html renders list with Tasks active', async ({ page }) => {
    await mockApi(page);
    await page.goto(pageUrl('tasks.html'));
    // Same as above: target the visible nav links, not the hidden dropdown.
    await page.waitForSelector('#rail nav a', { timeout: 5000 });

    // Active highlight: data-active="tasks" on body, and the Tasks rail link uses ph-fill + accent.
    await expect(page.locator('body')).toHaveAttribute('data-active', 'tasks');
    const tasksLink = page.locator('#rail a[href="tasks.html"]');
    await expect(tasksLink).toContainText('Tasks');
    // Active styling classes (bg-accent/12 and font-medium)
    await expect(tasksLink.locator('i')).toHaveClass(/ph-fill/);

    // Table rows rendered from mocked data.
    await expect(page.locator('#tasks-tbody tr')).toHaveCount(3, { timeout: 5000 });

    // Screenshot: menu with Tasks active
    await page.screenshot({ path: path.join(OUT_DIR, 'tasks-menu-active.png'), fullPage: false });

    // Screenshot: list view
    await page.screenshot({ path: path.join(OUT_DIR, 'tasks-list-view.png'), fullPage: false });
  });

  test('filter by state narrows the list', async ({ page }) => {
    await mockApi(page);
    await page.goto(pageUrl('tasks.html'));
    await page.waitForSelector('#tasks-tbody tr', { timeout: 5000 });

    await expect(page.locator('#tasks-tbody tr')).toHaveCount(3);
    await page.locator('#state-filter').selectOption('TODO');
    await expect(page.locator('#tasks-tbody tr')).toHaveCount(1);
    await expect(page.locator('#tasks-tbody tr').first()).toContainText('TASK-023');
  });

  test('clicking a row opens the task detail drawer', async ({ page }) => {
    await mockApi(page);
    await page.goto(pageUrl('tasks.html'));
    await page.waitForSelector('#tasks-tbody tr', { timeout: 5000 });

    // Click the TASK-023 row (third)
    const row = page.locator('#tasks-tbody tr').filter({ hasText: 'TASK-023' });
    await row.click();

    // Drawer opens and shows task title.
    const drawer = page.locator('#drawer');
    await expect(drawer).not.toHaveClass(/translate-x-full/, { timeout: 5000 });
    await expect(page.locator('#drawer-title')).toHaveText('Tasks list view');
    await expect(page.locator('#drawer-key')).toHaveText('TASK-023');
  });
});
