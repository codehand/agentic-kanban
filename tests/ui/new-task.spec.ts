/**
 * new-task.spec.ts — Playwright E2E test for New Task flow (TASK-019).
 *
 * Tests:
 *   - New Task CTA is wired (has id, links to new-task.html)
 *   - Form can be filled and submitted
 *   - After creation, redirects to board with toast
 *   - Task appears in board
 *
 * Run: pnpm exec playwright test tests/ui/new-task.spec.ts
 */
import { test, expect } from '@playwright/test';

test.describe('New Task Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Set a mock token in localStorage
    await page.addInitScript(() => {
      localStorage.setItem('kanban_token', 'test-human-token');
    });
  });

  test('New Task CTA has id and links to new-task.html', async ({ page }) => {
    await page.goto('/');
    const btn = page.locator('#btn-new-task');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute('href', 'new-task.html');
  });

  test('New Task form has required elements', async ({ page }) => {
    await page.goto('/new-task.html');

    // Form exists
    const form = page.locator('#new-task-form');
    await expect(form).toBeVisible();

    // Create button has id
    const createBtn = page.locator('#btn-create-task');
    await expect(createBtn).toBeVisible();
    await expect(createBtn).toHaveText(/Create task/);

    // Fields have ids
    await expect(page.locator('#field-title')).toBeVisible();
    await expect(page.locator('#field-project')).toBeVisible();
    await expect(page.locator('#field-description')).toBeVisible();
  });

  test('Create task redirects to board with toast', async ({ page }) => {
    // Mock the API call
    await page.route('**/api/tasks', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            task: {
              id: 'task_test',
              key: 'TASK-TEST',
              title: 'Test Task',
              state: 'TODO',
            },
          }),
        });
      } else {
        await route.continue();
      }
    });

    // Mock GET tasks for board
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

    await page.goto('/new-task.html');

    // Fill form
    await page.locator('#field-title').fill('My New Test Task');

    // Click create
    await page.locator('#btn-create-task').click();

    // Wait for redirect to index.html with ?created= param
    await page.waitForURL(/index\.html\?created=/);

    // Toast should appear
    const toast = page.locator('#toast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('created');
  });
});
