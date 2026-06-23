/**
 * drawer-reject-cta.spec.ts — Playwright spec for TASK-063.
 *
 * At the human-review gate (JUDGE_PASSED / READY_TO_REVIEW) the task detail
 * drawer must offer BOTH an Approve CTA (→ Done) and a Reject CTA
 * (→ JUDGE_REJECTED). Reject requires a reason, so its Confirm button stays
 * disabled until the note textarea is non-empty.
 *
 * Served over HTTP via the ds-server harness with /api/* mocked by stateful
 * page.route handlers (same approach as drawer-comments.spec.ts). A successful
 * reject moves the mocked task to JUDGE_REJECTED and the drawer re-fetches.
 *
 * Covered:
 *   1. Opening a JUDGE_PASSED task shows Approve AND Reject CTAs together.
 *   2. The reject dialog's Confirm button is disabled on an empty note and
 *      becomes enabled once a reason is typed.
 *   3. Confirming the reject calls /reject with the note and the drawer
 *      reflects the new JUDGE_REJECTED state.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { startDsServer, seedToken, type DsServer } from './ds-server';

const PROJECT = 'opf-hub';
const KEY = 'TASK-063R';
const TITLE = 'Reject CTA test';

interface MockState {
  state: string;
  rejectNote: string | null;
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function taskJson(state: string): Record<string, unknown> {
  return { key: KEY, title: TITLE, state, updated_at: new Date().toISOString() };
}

async function mockApi(page: Page, state: MockState): Promise<void> {
  await page.route(
    (url) => url.pathname.endsWith('/api/projects'),
    (route) => json(route, 200, { projects: [{ id: 'p1', slug: PROJECT, name: PROJECT }] }),
  );
  await page.route(
    (url) => url.pathname.endsWith('/api/tasks'),
    (route) => json(route, 200, { tasks: [taskJson(state.state)] }),
  );
  await page.route(
    (url) => url.pathname.endsWith(`/api/tasks/${KEY}/reject`),
    async (route) => {
      const post = JSON.parse(route.request().postData() || '{}') as { note?: string };
      if (!post.note || !post.note.trim()) {
        await json(route, 400, { error: 'note is required' });
        return;
      }
      state.rejectNote = post.note;
      state.state = 'JUDGE_REJECTED';
      await json(route, 200, { task: taskJson(state.state) });
    },
  );
  await page.route(
    (url) => url.pathname.endsWith(`/api/tasks/${KEY}`),
    (route) =>
      json(route, 200, {
        task: { ...taskJson(state.state), body_md: 'Spec body for the reject test.' },
        gitrefs: [],
        evidence: null,
        comments: [],
        timeline: [],
      }),
  );
  // Quiet SSE: connected only, huge retry so it never reconnects mid-test.
  await page.route(
    (url) => url.pathname.endsWith('/api/stream'),
    (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: 'retry: 600000\n\nevent: connected\ndata: {}\n\n',
      }),
  );
}

async function openDrawer(page: Page, server: DsServer): Promise<void> {
  await page.goto(server.url(`${PROJECT}/tasks.html`));
  const row = page.locator('#tasks-tbody tr').filter({ hasText: KEY });
  await expect(row).toBeVisible({ timeout: 10000 });
  await row.click();
  await expect(page.locator('#drawer')).not.toHaveClass(/translate-x-full/, { timeout: 5000 });
}

test.describe('TASK-063: human reject CTA at the review stage', () => {
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

  test('JUDGE_PASSED task shows both Approve and Reject CTAs', async ({ page }) => {
    await mockApi(page, { state: 'JUDGE_PASSED', rejectNote: null });
    await openDrawer(page, server);

    await expect(page.locator('#btn-approve')).toBeVisible();
    await expect(page.locator('#btn-reject')).toBeVisible();
  });

  test('reject Confirm is disabled on empty note and enables once a reason is typed', async ({ page }) => {
    await mockApi(page, { state: 'JUDGE_PASSED', rejectNote: null });
    await openDrawer(page, server);

    await page.locator('#btn-reject').click();
    const submit = page.locator('#reject-submit');
    await expect(submit).toBeVisible();
    await expect(submit).toBeDisabled();

    await page.locator('#reject-note').fill('Missing integration test for the error path.');
    await expect(submit).toBeEnabled();
  });

  test('confirming reject calls /reject and the drawer reflects JUDGE_REJECTED', async ({ page }) => {
    const state: MockState = { state: 'JUDGE_PASSED', rejectNote: null };
    await mockApi(page, state);
    await openDrawer(page, server);

    await page.locator('#btn-reject').click();
    await page.locator('#reject-note').fill('Please add an integration test before merge.');
    await page.locator('#reject-submit').click();

    await expect(page.locator('#drawer-state-badge')).toContainText('JUDGE_REJECTED', { timeout: 5000 });
    expect(state.rejectNote).toContain('integration test');
  });
});
