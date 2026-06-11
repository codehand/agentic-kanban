/**
 * new-task.spec.ts — Playwright E2E test for New Task flow (TASK-019).
 *
 * Modes:
 *   - Default (no env): serves design-system/ over HTTP via the ds-server
 *     harness (ephemeral port) and mocks /api/* routes so CI can execute
 *     without a server.
 *   - E2E_BASE_URL set: runs against a REAL dev server, proving the end-to-end create
 *     path (POST /api/tasks → task at TODO → redirect to board with toast).
 *
 * Run:
 *   pnpm exec playwright test tests/ui/new-task.spec.ts                     # mocked
 *   E2E_BASE_URL=http://127.0.0.1:3456 E2E_TOKEN=test-human-token \
 *     pnpm exec playwright test tests/ui/new-task.spec.ts                   # real server
 */
import { test, expect, type Page } from '@playwright/test';
import { startDsServer, type DsServer } from './ds-server';

const REAL_BASE = process.env.E2E_BASE_URL || '';
const REAL_TOKEN = process.env.E2E_TOKEN || '';

function isRealMode(): boolean {
  return !!REAL_BASE;
}

let server: DsServer | null = null;

/** URL for a design-system page in the current mode. */
function pageUrl(file: string): string {
  return isRealMode() ? `${REAL_BASE}/${file}` : server!.url(file);
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
  test.beforeAll(async () => {
    if (!isRealMode()) server = await startDsServer();
  });

  test.afterAll(async () => {
    if (server) await server.close();
  });

  test.beforeEach(async ({ page }) => {
    await authScript(page);
    await installMocksIfMocked(page);
  });

  test('New Task CTA has id and links to new-task.html', async ({ page }) => {
    await page.goto(pageUrl('index.html'));
    const btn = page.locator('#btn-new-task');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute('href', 'new-task.html');
  });

  test('New Task form has required elements', async ({ page }) => {
    await page.goto(pageUrl('new-task.html'));
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
    // The board shows the toast on /index.html?created=…, then immediately
    // cleans the URL (history.replaceState) and gets replaced by the shell's
    // project-prefix redirect — so the toast may only exist for the duration
    // of the projects fetch. Outside-in polling can miss that window, so we
    // record the toast from INSIDE the page: a MutationObserver (re-installed
    // on every navigation) writes the toast text to localStorage the moment
    // it becomes visible, and the test asserts on that record.
    await page.addInitScript(() => {
      const record = () => {
        const t = document.getElementById('toast');
        if (t && !t.classList.contains('hidden')) {
          const msg = document.getElementById('toast-msg');
          localStorage.setItem('__pw_toast', (msg ? msg.textContent : t.textContent) || '');
        }
      };
      const mo = new MutationObserver(record);
      // Observe `document` (documentElement does not exist yet at
      // init-script time).
      mo.observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class'],
      });
      document.addEventListener('DOMContentLoaded', record);
    });

    await page.goto(pageUrl('new-task.html'));

    // The project <select> is populated asynchronously from /api/projects.
    // Wait for a real value so the POST carries a project, and remember which
    // project the form actually submits to (no hardcoded slug).
    const projectSelect = page.locator('#field-project');
    await expect(projectSelect).not.toHaveValue('');
    const projectUsed = await projectSelect.inputValue();

    // Unique title so the real-mode server check below finds THIS run's task,
    // not a leftover from a previous run against the same DB.
    const title = `My New Test Task ${Date.now().toString(36)}`;

    // Fill form
    await page.locator('#field-title').fill(title);

    // Register the URL waiter BEFORE clicking and observe the redirect at
    // 'commit', i.e. before the board page's scripts run. The board toast
    // auto-hides 3.2s after those scripts start, so starting our assertions
    // at commit removes the race against that timer (and against the page
    // cleaning ?created= out of the URL via history.replaceState).
    const redirected = page.waitForURL(/index\.html\?created=/, {
      waitUntil: 'commit',
      timeout: 15000,
    });

    // Click create
    await page.locator('#btn-create-task').click();
    await redirected;

    // The board toast (#toast) was shown with the created message — read the
    // in-page observer's record, retrying through the redirect churn.
    await expect
      .poll(
        () => page.evaluate(() => localStorage.getItem('__pw_toast')).catch(() => null),
        { timeout: 10000 },
      )
      .toContain('created');

    // In real mode, verify the task actually exists on the server, in the
    // project the form actually used.
    if (isRealMode()) {
      // Let the redirect chain settle on the project board before fetching —
      // an in-flight navigation would abort the page-side fetch.
      await page.waitForURL(/\/[^/]+\/index\.html/, { timeout: 15000 });
      const listRes = await page.evaluate(async ({ tok, project }) => {
        const r = await fetch(`/api/tasks?project=${encodeURIComponent(project)}`, {
          headers: { Authorization: `Bearer ${tok}` },
        });
        return r.json();
      }, { tok: REAL_TOKEN, project: projectUsed });
      const tasks = (listRes as { tasks: Array<{ title: string; state: string }> }).tasks;
      const found = tasks.find((t) => t.title === title);
      expect(found).toBeDefined();
      expect(found!.state).toBe('TODO');
    }
  });
});
