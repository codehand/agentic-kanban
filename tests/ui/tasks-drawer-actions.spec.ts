/**
 * tasks-drawer-actions.spec.ts — Playwright spec for TASK-058.
 *
 * The tasks-list detail drawer (/<project>/tasks.html) was read-only: opening a
 * task showed Spec / Depends on / Repos & MR / Evidence but offered NO human
 * action. This task surfaces the same state-gated human actions the board
 * drawer has (Approve / Reset / Remove) and enforces one rule across both
 * drawers: a DONE task shows NO action buttons.
 *
 * These tests serve design-system/ over HTTP via the ds-server harness and mock
 * /api/* with stateful page.route handlers. They cover:
 *   1. JUDGE_PASSED  → Approve shown, Reset hidden; approve → drawer refreshes
 *      to DONE (badge) and the actions hide (DONE ⇒ no actions).
 *   2. JUDGE_REJECTED → Reset shown, Approve hidden; reset sends the task back
 *      to IN_PROGRESS (server-side), surfaced via toast.
 *   3. DONE → none of approve/reset/remove are shown.
 *   4. A failed approve surfaces an error toast (not a silent no-op).
 *
 * They FAIL on the previous read-only drawer because #btn-approve / #btn-reset /
 * #btn-remove did not exist there.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { startDsServer, seedToken, type DsServer } from './ds-server';

const PROJECT = 'opf-hub';

interface MockTask {
  key: string;
  title: string;
  state: string;
}

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function taskJson(task: MockTask): Record<string, unknown> {
  return { key: task.key, title: task.title, state: task.state, updated_at: new Date().toISOString() };
}

interface MockOpts {
  /** Override the approve endpoint (e.g. to simulate a server error). */
  onApprove?: (route: Route, task: MockTask) => Promise<void> | void;
  /** Override the reset endpoint. */
  onReset?: (route: Route, task: MockTask) => Promise<void> | void;
}

/** Mock /api/projects, the task list, task detail, approve and reset. */
async function mockApi(page: Page, task: MockTask, opts: MockOpts = {}): Promise<void> {
  await page.route(
    (url) => url.pathname.endsWith('/api/projects'),
    (route) => json(route, { projects: [{ id: 'p1', slug: PROJECT, name: PROJECT }] }),
  );
  await page.route(
    (url) => url.pathname.endsWith('/api/tasks'),
    (route) => json(route, { tasks: [taskJson(task)] }),
  );
  await page.route(
    (url) => url.pathname.endsWith(`/api/tasks/${task.key}`),
    (route) =>
      json(route, {
        task: { ...taskJson(task), body_md: 'Spec body for the tasks-drawer actions test.' },
        gitrefs: [],
        evidence: null,
        comments: [],
        timeline: [],
      }),
  );
  await page.route(
    (url) => url.pathname.endsWith(`/api/tasks/${task.key}/approve`),
    (route) => {
      if (opts.onApprove) return opts.onApprove(route, task);
      task.state = 'DONE';
      return json(route, { task: taskJson(task) });
    },
  );
  await page.route(
    (url) => url.pathname.endsWith(`/api/tasks/${task.key}/reset`),
    (route) => {
      if (opts.onReset) return opts.onReset(route, task);
      task.state = 'IN_PROGRESS';
      return json(route, { task: taskJson(task) });
    },
  );
  await page.route(
    (url) => url.pathname.endsWith(`/api/tasks/${task.key}/remove`),
    (route) => json(route, { removed: true }),
  );
}

/** Open /<project>/tasks.html, click the task row, wait for the drawer. */
async function openDrawer(page: Page, server: DsServer, task: MockTask): Promise<void> {
  await page.goto(server.url(`${PROJECT}/tasks.html`));
  const row = page.locator('#tasks-tbody tr').filter({ hasText: task.key });
  await expect(row).toBeVisible({ timeout: 10000 });
  await row.click();
  await expect(page.locator('#drawer')).not.toHaveClass(/translate-x-full/, { timeout: 5000 });
  await expect(page.locator('#drawer-state-badge')).toContainText(task.state);
}

test.describe('TASK-058: human actions in the tasks-list drawer', () => {
  let server: DsServer;

  test.beforeAll(async () => {
    server = await startDsServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  test.beforeEach(async ({ context }) => {
    await seedToken(context);
  });

  test('JUDGE_PASSED task shows Approve (not Reset); approve refreshes drawer to DONE', async ({ page }) => {
    const task: MockTask = { key: 'TASK-058A', title: 'Judge passed task', state: 'JUDGE_PASSED' };
    await mockApi(page, task);
    await openDrawer(page, server, task);

    await expect(page.locator('#btn-approve')).toBeVisible();
    await expect(page.locator('#btn-reset')).toBeHidden();
    await expect(page.locator('#btn-remove')).toBeVisible();

    await page.locator('#btn-approve').click();
    await expect(page.locator('#confirm')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm Approve' }).click();

    // Drawer refetches → DONE badge, and DONE ⇒ no actions.
    await expect(page.locator('#drawer-state-badge')).toContainText('DONE', { timeout: 5000 });
    await expect(page.locator('#btn-approve')).toBeHidden();
    await expect(page.locator('#btn-reset')).toBeHidden();
    await expect(page.locator('#btn-remove')).toBeHidden();
  });

  test('JUDGE_REJECTED task shows Reset (not Approve); reset sends it back to IN_PROGRESS', async ({ page }) => {
    const task: MockTask = { key: 'TASK-058B', title: 'Judge rejected task', state: 'JUDGE_REJECTED' };
    await mockApi(page, task);
    await openDrawer(page, server, task);

    await expect(page.locator('#btn-reset')).toBeVisible();
    await expect(page.locator('#btn-approve')).toBeHidden();
    await expect(page.locator('#btn-remove')).toBeVisible();

    await page.locator('#btn-reset').click();
    // Toast confirms the send-back; server state is now IN_PROGRESS.
    await expect(page.locator('#toast')).toContainText('reset to IN_PROGRESS', { timeout: 5000 });
    expect(task.state).toBe('IN_PROGRESS');
  });

  test('SELF_CHECK_FAILED task shows Reset', async ({ page }) => {
    const task: MockTask = { key: 'TASK-058C', title: 'Self-check failed task', state: 'SELF_CHECK_FAILED' };
    await mockApi(page, task);
    await openDrawer(page, server, task);

    await expect(page.locator('#btn-reset')).toBeVisible();
    await expect(page.locator('#btn-approve')).toBeHidden();
  });

  test('DONE task shows NO action buttons', async ({ page }) => {
    const task: MockTask = { key: 'TASK-058D', title: 'Done task', state: 'DONE' };
    await mockApi(page, task);
    await openDrawer(page, server, task);

    await expect(page.locator('#btn-approve')).toBeHidden();
    await expect(page.locator('#btn-reset')).toBeHidden();
    await expect(page.locator('#btn-remove')).toBeHidden();
  });

  test('a failed approve surfaces an error toast (not a silent no-op)', async ({ page }) => {
    const task: MockTask = { key: 'TASK-058E', title: 'Approve fails', state: 'JUDGE_PASSED' };
    await mockApi(page, task, {
      onApprove: (route) => json(route, { error: 'conflict' }, 409),
    });
    await openDrawer(page, server, task);

    await page.locator('#btn-approve').click();
    await expect(page.locator('#confirm')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm Approve' }).click();

    await expect(page.locator('#toast')).toContainText('Approve failed', { timeout: 5000 });
    // State did not flip and the action is still available to retry.
    await expect(page.locator('#drawer-state-badge')).toContainText('JUDGE_PASSED');
  });
});
