/**
 * new-task.spec.ts — Playwright E2E test for New Task flow (TASK-019).
 *
 * Modes:
 *   - Default (no env): runs against mock routes so CI can execute without a server.
 *   - E2E_BASE_URL set: runs against a REAL dev server, proving the end-to-end create
 *     path (POST /api/tasks → task at TODO → redirect to board with toast).
 *
 * Run:
 *   pnpm exec playwright test tests/ui/new-task.spec.ts                     # mocked
 *   E2E_BASE_URL=http://127.0.0.1:3456 E2E_TOKEN=test-human-token \
 *     pnpm exec playwright test tests/ui/new-task.spec.ts                   # real server
 */
import { test, expect, type Page } from '@playwright/test';

const REAL_BASE = process.env.E2E_BASE_URL || '';
const REAL_TOKEN = process.env.E2E_TOKEN || '';

function isRealMode(): boolean {
  return !!REAL_BASE;
}

/** In mocked mode we intercept /api/tasks POST and return a fake created task. */
async function installMocksIfMocked(page: Page) {
  if (isRealMode()) return;
  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() === 'POST') {
      const reqBody = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          task: {
            id: 'task_mock',
            key: reqBody.key || 'TASK-MOCK',
            title: reqBody.title || 'Mocked',
            state: 'TODO',
          },
        }),
      });
    } else {
      await route.continue();
    }
  });
  await page.route('**/api/tasks?*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tasks: [] }),
    });
  });
  await page.route('**/api/projects', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ projects: [{ id: 'proj_1', slug: 'test', name: 'Test' }] }),
    });
  });
}

function baseUrl(): string {
  return REAL_BASE || '';
}

function authScript(page: Page) {
  if (isRealMode()) {
    return page.addInitScript((tok) => {
      localStorage.setItem('kanban_token', tok);
    }, REAL_TOKEN);
  }
  return page.addInitScript(() => {
    localStorage.setItem('kanban_token', 'mock-token');
  });
}

test.describe('New Task Flow', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    authScript(page);
    await installMocksIfMocked(page);
    // Set baseURL for navigation
    if (!isRealMode() && baseURL) {
      // will use relative URLs via baseURL from playwright config
    }
  });

  test('New Task CTA has id and links to new-task.html', async ({ page }) => {
    const url = isRealMode() ? `${REAL_BASE}/index.html` : '/';
    await page.goto(url);
    const btn = page.locator('#btn-new-task');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute('href', 'new-task.html');
  });

  test('New Task form has required elements', async ({ page }) => {
    const url = isRealMode() ? `${REAL_BASE}/new-task.html` : '/new-task.html';
    await page.goto(url);
    const form = page.locator('#new-task-form');
    await expect(form).toBeVisible();
    const createBtn = page.locator('#btn-create-task');
    await expect(createBtn).toBeVisible();
    await expect(createBtn).toHaveText(/Create task/);
    await expect(page.locator('#field-title')).toBeVisible();
    await expect(page.locator('#field-project')).toBeVisible();
    await expect(page.locator('#field-description')).toBeVisible();
  });

  test('Create task redirects to board with toast', async ({ page }) => {
    const newTaskUrl = isRealMode() ? `${REAL_BASE}/new-task.html` : '/new-task.html';
    await page.goto(newTaskUrl);

    // Fill form
    await page.locator('#field-title').fill('My New Test Task');

    // Click create
    await page.locator('#btn-create-task').click();

    // Wait for redirect to index.html with ?created= param
    await page.waitForURL(/index\.html\?created=/, { timeout: 15000 });

    // Toast should appear (the page creates a .fixed.bottom-4 element)
    // The toast is a dynamically-created div with class containing 'fixed bottom-4'
    // We wait for any element containing 'created' text to appear near bottom of page
    const toast = page.locator('div.fixed.bottom-4');
    await expect(toast.first()).toBeVisible({ timeout: 5000 });
    await expect(toast.first()).toContainText('created');

    // In real mode, verify the task actually exists on the server
    if (isRealMode()) {
      const listRes = await page.evaluate(async (tok) => {
        const r = await fetch('/api/tasks?project=opf-hub', {
          headers: { Authorization: `Bearer ${tok}` },
        });
        return r.json();
      }, REAL_TOKEN);
      const tasks = (listRes as { tasks: Array<{ title: string; state: string }> }).tasks;
      const found = tasks.find((t) => t.title === 'My New Test Task');
      expect(found).toBeDefined();
      expect(found!.state).toBe('TODO');
    }
  });
});
