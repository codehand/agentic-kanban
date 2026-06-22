/**
 * drawer-comments.spec.ts — Playwright spec for TASK-057.
 *
 * Wires comments into the task detail drawer (tasks.js / tasks.html) in both
 * directions: render existing comments AND post a new one from the composer.
 *
 * Serves design-system/ over HTTP via the ds-server harness and mocks /api/*
 * with stateful page.route handlers: the comments POST appends a comment
 * server-side, and the drawer must re-fetch the task detail (same path it uses
 * to load) so the new comment appears — no page reload.
 *
 * Covered:
 *   1. Opening a task with existing comments renders them (author role, kind,
 *      verdict badge, markdown body, relative time).
 *   2. Posting from the composer appends the comment and it appears in place.
 *   3. The submit button is disabled on empty input.
 *   4. A forbidden (403) POST surfaces an inline error instead of silent no-op.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { startDsServer, seedToken, type DsServer } from './ds-server';

const PROJECT = 'opf-hub';
const KEY = 'TASK-057C';
const TITLE = 'Drawer comments test';

interface MockComment {
  id: string;
  author_role: string;
  kind: string;
  verdict: string | null;
  body_md: string;
  created_at: string;
}

interface MockState {
  comments: MockComment[];
  forbid: boolean; // when true, the POST returns 403
}

function seededComment(): MockComment {
  return {
    id: 'cm_seed',
    author_role: 'judge',
    kind: 'verdict',
    verdict: 'PASS',
    body_md: '**Approved** by the judge.',
    created_at: new Date().toISOString(),
  };
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function taskJson(): Record<string, unknown> {
  return { key: KEY, title: TITLE, state: 'IN_PROGRESS', updated_at: new Date().toISOString() };
}

async function mockApi(page: Page, state: MockState): Promise<void> {
  await page.route(
    (url) => url.pathname.endsWith('/api/projects'),
    (route) => json(route, 200, { projects: [{ id: 'p1', slug: PROJECT, name: PROJECT }] }),
  );
  await page.route(
    (url) => url.pathname.endsWith('/api/tasks'),
    (route) => json(route, 200, { tasks: [taskJson()] }),
  );
  await page.route(
    (url) => url.pathname.endsWith(`/api/tasks/${KEY}/comments`),
    async (route) => {
      if (state.forbid) {
        await json(route, 403, { error: 'Forbidden' });
        return;
      }
      const post = JSON.parse(route.request().postData() || '{}') as { body_md?: string };
      const c: MockComment = {
        id: 'cm_' + state.comments.length,
        author_role: 'human',
        kind: 'review',
        verdict: null,
        body_md: post.body_md || '',
        created_at: new Date().toISOString(),
      };
      state.comments.push(c);
      await json(route, 201, { comment: c });
    },
  );
  await page.route(
    (url) => url.pathname.endsWith(`/api/tasks/${KEY}`),
    (route) =>
      json(route, 200, {
        task: { ...taskJson(), body_md: 'Spec body for the comments test.' },
        gitrefs: [],
        evidence: null,
        comments: state.comments,
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
  await page.evaluate(() => {
    (window as unknown as { __pwNoReload?: boolean }).__pwNoReload = true;
  });
}

test.describe('TASK-057: comments in the task detail drawer', () => {
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

  test('renders existing comments with role, verdict badge and body', async ({ page }) => {
    await mockApi(page, { comments: [seededComment()], forbid: false });
    await openDrawer(page, server);

    const list = page.locator('#drawer-body [data-comments-list] li').first();
    await expect(list).toContainText('judge');
    await expect(list).toContainText('verdict');
    await expect(list).toContainText('PASS');
    await expect(list).toContainText('Approved');
  });

  test('empty-comments state renders cleanly', async ({ page }) => {
    await mockApi(page, { comments: [], forbid: false });
    await openDrawer(page, server);
    await expect(page.locator('#drawer-body [data-comments-empty]')).toBeVisible();
  });

  test('submit is disabled on empty input and posting appends the comment', async ({ page }) => {
    await mockApi(page, { comments: [], forbid: false });
    await openDrawer(page, server);

    const submit = page.locator('#comment-submit');
    await expect(submit).toBeDisabled();

    await page.locator('#comment-input').fill('Please rebase onto main.');
    await expect(submit).toBeEnabled();
    await submit.click();

    // Drawer re-fetched (no full reload) and shows the new comment.
    await expect(
      page.locator('#drawer-body [data-comments-list] li').filter({ hasText: 'Please rebase onto main.' }),
    ).toBeVisible({ timeout: 5000 });
    expect(
      await page.evaluate(() => (window as unknown as { __pwNoReload?: boolean }).__pwNoReload),
    ).toBe(true);
  });

  test('a forbidden POST surfaces an inline error', async ({ page }) => {
    await mockApi(page, { comments: [], forbid: true });
    await openDrawer(page, server);

    await page.locator('#comment-input').fill('not allowed');
    await page.locator('#comment-submit').click();

    await expect(page.locator('#comment-error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#comment-error')).toContainText('Forbidden');
  });
});
