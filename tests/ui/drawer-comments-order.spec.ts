/**
 * drawer-comments-order.spec.ts — Playwright spec for TASK-062.
 *
 * Proves that the shared Comments renderer (design-system/drawer-sections.js
 * renderComments) displays comments newest-first, regardless of the order the
 * server returns them. Seeds ≥2 comments with distinct created_at values,
 * opens the drawer, and asserts the DOM order of [data-comments-list] li is
 * newest → oldest.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { startDsServer, seedToken, type DsServer } from './ds-server';

const PROJECT = 'opf-hub';
const KEY = 'TASK-062O';
const TITLE = 'Drawer comments order test';

interface MockComment {
  id: string;
  author_role: string;
  kind: string;
  verdict: string | null;
  body_md: string;
  created_at: string;
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function taskJson(): Record<string, unknown> {
  return { key: KEY, title: TITLE, state: 'IN_PROGRESS', updated_at: new Date().toISOString() };
}

async function mockApi(page: Page, comments: MockComment[]): Promise<void> {
  await page.route(
    (url) => url.pathname.endsWith('/api/projects'),
    (route) => json(route, 200, { projects: [{ id: 'p1', slug: PROJECT, name: PROJECT }] }),
  );
  await page.route(
    (url) => url.pathname.endsWith('/api/tasks'),
    (route) => json(route, 200, { tasks: [taskJson()] }),
  );
  await page.route(
    (url) => url.pathname.endsWith(`/api/tasks/${KEY}`),
    (route) =>
      json(route, 200, {
        task: { ...taskJson(), body_md: 'Spec body for the ordering test.' },
        gitrefs: [],
        evidence: null,
        comments,
        timeline: [],
      }),
  );
  await page.route(
    (url) => url.pathname.endsWith(`/api/tasks/${KEY}/comments`),
    (route) => json(route, 200, { comment: {} }),
  );
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

test.describe('TASK-062: comments render newest-first in the drawer', () => {
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

  test('DOM order is newest → oldest, regardless of input order', async ({ page }) => {
    // Seed comments in CHRONOLOGICAL order (oldest first) — the renderer
    // must reverse them to newest-first in the DOM.
    const comments: MockComment[] = [
      {
        id: 'cm_oldest',
        author_role: 'implementer',
        kind: 'review',
        verdict: null,
        body_md: 'first-oldest-comment-body',
        created_at: '2026-06-01T10:00:00.000Z',
      },
      {
        id: 'cm_middle',
        author_role: 'judge',
        kind: 'verdict',
        verdict: 'PASS',
        body_md: 'second-middle-comment-body',
        created_at: '2026-06-15T12:00:00.000Z',
      },
      {
        id: 'cm_newest',
        author_role: 'human',
        kind: 'review',
        verdict: null,
        body_md: 'third-newest-comment-body',
        created_at: '2026-06-22T18:30:00.000Z',
      },
    ];
    await mockApi(page, comments);
    await openDrawer(page, server);

    const items = page.locator('#drawer-body [data-comments-list] li');
    await expect(items).toHaveCount(3, { timeout: 10000 });

    // Assert DOM order: newest first, oldest last. Each li contains its
    // seeded body_md, so we can check position via textContent.
    const texts = await items.allTextContents();
    expect(texts[0]).toContain('third-newest-comment-body');
    expect(texts[1]).toContain('second-middle-comment-body');
    expect(texts[2]).toContain('first-oldest-comment-body');
  });
});
