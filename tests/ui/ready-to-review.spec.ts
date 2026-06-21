/**
 * ready-to-review.spec.ts — Playwright spec for TASK-051.
 *
 * Drives the board UI for a task in the new READY_TO_REVIEW state (the pr-bot
 * has opened a PR and recorded its link via pr_url) and asserts the human
 * review affordances:
 *   1. the task renders on the board with the READY_TO_REVIEW badge,
 *   2. opening the drawer shows the "Open PR" link built from pr_url
 *      (safeHttpHref + esc), and
 *   3. the Approve → Done button is shown (un-hidden for READY_TO_REVIEW, not
 *      only JUDGE_PASSED).
 *
 * Served via the ds-server harness (production static routing on a real
 * ephemeral port); /api/* is answered with stateful route handlers exactly
 * like drawer-approve.spec.ts.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { startDsServer, type DsServer } from './ds-server';

const PROJECT = 'opf-hub';
const KEY = 'TASK-051E';
const TITLE = 'Ready-to-review PR link test';
const PR_URL = 'https://git.example.com/opf-hub/merge_requests/51';

function json(route: Route, body: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

/** Task payload in the READY_TO_REVIEW state with a recorded pr_url. */
function taskJson(): Record<string, unknown> {
  return {
    key: KEY,
    title: TITLE,
    state: 'READY_TO_REVIEW',
    pr_url: PR_URL,
    priority: null,
    complexity: null,
    estimate_hours: null,
    tags: [],
    link_document: null,
    depends_on: [],
    updated_at: new Date().toISOString(),
  };
}

async function mockApi(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname.endsWith('/api/projects'),
    (route) => json(route, { projects: [{ id: 'p1', slug: PROJECT, name: PROJECT }] }),
  );
  await page.route(
    (url) => url.pathname.endsWith('/api/tasks'),
    (route) => json(route, { tasks: [taskJson()] }),
  );
  await page.route(
    (url) => url.pathname.endsWith(`/api/tasks/${KEY}`),
    (route) =>
      json(route, {
        task: { ...taskJson(), body_md: 'Spec body for the ready-to-review test.' },
        gitrefs: [],
        evidence: null,
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

test.describe('TASK-051: READY_TO_REVIEW drawer shows PR link + Approve', () => {
  let server: DsServer;

  test.beforeAll(async () => {
    server = await startDsServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  test.beforeEach(async ({ context }) => {
    // Seed a token so api.js doesn't redirect to signin.html.
    await context.addInitScript(() => {
      localStorage.setItem('kanban_token', 'test-token');
    });
  });

  test('READY_TO_REVIEW task: drawer renders Open PR link and Approve button', async ({ page }) => {
    await mockApi(page);

    await page.goto(server.url('index.html'));

    // READY_TO_REVIEW maps to the human-review column; the card carries the badge.
    const card = page.locator('#col-judge_passed article').filter({ hasText: KEY });
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(card).toContainText('READY_TO_REVIEW');
    await card.click();

    await expect(page.locator('#drawer')).not.toHaveClass(/translate-x-full/, { timeout: 5000 });
    await expect(page.locator('#drawer-state-badge')).toContainText('READY_TO_REVIEW');

    // "Open PR" link is built from pr_url and points at the recorded URL.
    const prLink = page.locator('#drawer-body a', { hasText: 'Open PR' });
    await expect(prLink).toBeVisible();
    await expect(prLink).toHaveAttribute('href', PR_URL);
    await expect(prLink).toHaveAttribute('target', '_blank');
    await expect(prLink).toHaveAttribute('rel', /noopener/);

    // Approve → Done is shown for READY_TO_REVIEW (not only JUDGE_PASSED).
    await expect(page.locator('#btn-approve')).toBeVisible();
  });
});
