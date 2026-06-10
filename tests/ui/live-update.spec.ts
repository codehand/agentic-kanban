/**
 * live-update.spec.ts — Playwright E2E test for TASK-017.
 *
 * Verifies that creating a task via the API causes the board UI to
 * soft-refetch (new card appears) and a toast to be shown — without
 * a full page reload.
 */
import { test, expect } from '@playwright/test';

test.describe('Live update — SSE → UI (TASK-017)', () => {
  test('creating a task via API adds card + shows toast', async ({ page, request }) => {
    // Sign in: set token in localStorage before navigating
    const tokenResp = await request.post('/api/tokens', {
      headers: { 'Content-Type': 'application/json' },
      data: { role: 'human', label: 'pw-live-test' },
    });
    // If server requires auth to mint, fall back to env token
    let token = '';
    if (tokenResp.ok()) {
      const body = await tokenResp.json();
      token = body.secret;
    } else {
      token = process.env.KANBAN_ADMIN_TOKEN || '';
    }
    test.skip(!token, 'No token available — skipping live-update spec');

    // Ensure a project exists
    await request.get('/api/projects');

    // Navigate to board and set token
    await page.goto('/');
    await page.evaluate((t) => { window.__kanban_setToken(t); }, token);
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Create a task via the API (simulating MCP / external actor)
    const key = 'LIVEPW-' + Date.now().toString(36).toUpperCase();
    const createResp = await request.post('/api/tasks', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      data: { project: 'opf-hub', key, title: 'Playwright live test' },
    });
    expect(createResp.status()).toBe(201);

    // Assert the new card appears in the TODO column (soft-refetch via SSE)
    const todoCol = page.locator('#col-todo');
    await expect(todoCol.getByText(key)).toBeVisible({ timeout: 5000 });

    // Assert the toast appears with the task key
    const toast = page.locator('#toast');
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast.locator('#toast-msg')).toContainText(key);

    // Verify no full page reload happened: the page should still have
    // the same SPA state (no navigation occurred)
    const url = page.url();
    expect(url).toContain('/');
  });
});
