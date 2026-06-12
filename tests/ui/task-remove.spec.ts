/**
 * task-remove.spec.ts — Playwright spec for TASK-039.
 *
 * E2E coverage for the drawer's "Remove task (guarded)" flow that previously
 * had only server-side unit tests: the real button is clicked, the native
 * confirm() guard is answered, and the board/drawer/API reactions are
 * asserted — no direct fetch to the remove endpoint stands in for the click.
 *
 * Like drawer-approve.spec.ts, these tests serve design-system/ over HTTP via
 * the ds-server harness and mock /api/* with STATEFUL page.route handlers:
 * the remove POST flips `removed` server-side (mirroring the real
 * `POST /api/tasks/:key/remove` → DELETE + SSE `removed` broadcast in
 * server/src/api/routes.ts), and afterwards the board list excludes the task
 * and the task detail GET returns 404 — exactly like the real server. The
 * `removed` flag can ONLY flip via that POST, so every post-removal assertion
 * proves the UI actually drove the endpoint.
 *
 * Covered:
 *   1. Happy path: open drawer → click Remove → accept the guard → card
 *      disappears from the board WITHOUT a page reload (SSE `removed` +
 *      soft refetch), drawer closes, GET /api/tasks/:key now 404s.
 *   2. Cancel path: click Remove → dismiss the guard → no POST is sent, the
 *      card stays on the board, GET /api/tasks/:key still returns the task.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { startDsServer, seedToken, type DsServer } from './ds-server';

const PROJECT = 'opf-hub';
const KEY = 'TASK-039E';
const TITLE = 'Drawer remove guard test';

/** Mutable mock server state + counters shared by the route handlers. */
interface MockState {
  removed: boolean;
  removeCalls: number;
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function taskJson(): Record<string, unknown> {
  return { key: KEY, title: TITLE, state: 'TODO', updated_at: new Date().toISOString() };
}

/**
 * Mock /api/projects, board list, task detail and remove against `state`,
 * mirroring the real server: after removal the list is empty and the detail
 * GET returns 404 (the row was DELETEd).
 */
async function mockApi(page: Page, state: MockState, onRemoved?: () => Promise<void>): Promise<void> {
  await page.route(
    (url) => url.pathname.endsWith('/api/projects'),
    (route) => json(route, 200, { projects: [{ id: 'p1', slug: PROJECT, name: PROJECT }] }),
  );
  await page.route(
    (url) => url.pathname.endsWith('/api/tasks'),
    (route) => json(route, 200, { tasks: state.removed ? [] : [taskJson()] }),
  );
  await page.route(
    (url) => url.pathname.endsWith(`/api/tasks/${KEY}`),
    (route) => {
      if (state.removed) return json(route, 404, { error: `Task not found: ${KEY}` });
      return json(route, 200, {
        task: { ...taskJson(), body_md: 'Spec body for the drawer remove test.' },
        gitrefs: [],
        evidence: null,
        timeline: [],
      });
    },
  );
  await page.route(
    (url) => url.pathname.endsWith(`/api/tasks/${KEY}/remove`),
    async (route) => {
      state.removeCalls += 1;
      state.removed = true;
      await json(route, 200, { removed: true, key: KEY });
      // Real server broadcasts SSE 'removed' right after the DELETE.
      if (onRemoved) await onRemoved();
    },
  );
}

/** Open the board, click the TODO card, wait for the drawer + remove button. */
async function openDrawer(page: Page, server: DsServer): Promise<void> {
  await page.goto(server.url('index.html'));
  const card = page.locator('#col-todo article').filter({ hasText: KEY });
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.click();
  await expect(page.locator('#drawer')).not.toHaveClass(/translate-x-full/, { timeout: 5000 });
  await expect(page.locator('#drawer-title')).toHaveText(TITLE);
  await expect(page.locator('#btn-remove')).toBeVisible();
  // Marker to prove later updates happen without a full page reload.
  await page.evaluate(() => {
    (window as unknown as { __pwNoReload?: boolean }).__pwNoReload = true;
  });
}

/** In-page GET /api/tasks/:key (goes through the route mocks) → HTTP status. */
function getTaskStatus(page: Page): Promise<number> {
  return page.evaluate(
    async ({ key, project }) => {
      const res = await fetch(`/api/tasks/${key}?project=${project}`, {
        headers: { Authorization: 'Bearer test-token' },
      });
      return res.status;
    },
    { key: KEY, project: PROJECT },
  );
}

test.describe('TASK-039: remove task from the drawer (guarded)', () => {
  let server: DsServer;

  test.beforeAll(async () => {
    server = await startDsServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  test.beforeEach(async ({ context }) => {
    // Seed a token so api.js doesn't redirect to signin.html.
    await seedToken(context, 'test-token');
  });

  test('accepting the guard removes the card live and 404s the task API', async ({ page }) => {
    const state: MockState = { removed: false, removeCalls: 0 };

    // Hold SSE connections pending; once the remove POST lands, serve the
    // real-shaped `removed` event (what broadcastRemoved emits) so the board
    // reacts the same way it does against the production server.
    const pendingSse: Route[] = [];
    let sseBody = 'retry: 600000\n\nevent: connected\ndata: {}\n\n';
    const flushSse = async () => {
      for (const route of pendingSse.splice(0)) {
        try {
          await route.fulfill({
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
            body: sseBody,
          });
        } catch {
          // Connection from a pre-redirect page that navigated away — ignore.
        }
      }
    };
    await page.route(
      (url) => url.pathname.endsWith('/api/stream'),
      async (route) => {
        pendingSse.push(route);
        if (state.removed) await flushSse();
      },
    );

    await mockApi(page, state, async () => {
      sseBody +=
        `event: removed\ndata: ${JSON.stringify({
          task_id: 't1',
          project: PROJECT,
          key: KEY,
          at: new Date().toISOString(),
        })}\n\n`;
      await flushSse();
    });

    await openDrawer(page, server);
    expect(await getTaskStatus(page)).toBe(200); // sanity: task exists before

    // Click the real drawer button and ACCEPT the native confirm() guard.
    const dialogMessages: string[] = [];
    page.on('dialog', (dialog) => {
      dialogMessages.push(dialog.message());
      void dialog.accept();
    });
    await page.locator('#btn-remove').click();

    // The guard actually fired and named the task.
    await expect.poll(() => dialogMessages.length).toBe(1);
    expect(dialogMessages[0]).toContain(KEY);

    // Card disappears from the board (column hidden / list empty) without a
    // reload; the empty state takes its place.
    const card = page.locator('#col-todo article').filter({ hasText: KEY });
    await expect(card).toBeHidden({ timeout: 10000 });
    await expect(page.locator('#board-empty')).toBeVisible({ timeout: 10000 });

    // Drawer closed after the removal.
    await expect(page.locator('#drawer')).toHaveClass(/translate-x-full/, { timeout: 5000 });

    // The endpoint was hit exactly once, by the button click.
    expect(state.removeCalls).toBe(1);

    // GET /api/tasks/:key no longer returns the task.
    expect(await getTaskStatus(page)).toBe(404);

    // No full page reload happened: the pre-removal marker survived.
    expect(
      await page.evaluate(() => (window as unknown as { __pwNoReload?: boolean }).__pwNoReload),
    ).toBe(true);
  });

  test('cancelling the guard keeps the task on the board and in the API', async ({ page }) => {
    const state: MockState = { removed: false, removeCalls: 0 };

    // Quiet SSE stream: connected only, huge retry so it never reconnects.
    await page.route(
      (url) => url.pathname.endsWith('/api/stream'),
      (route) =>
        route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
          body: 'retry: 600000\n\nevent: connected\ndata: {}\n\n',
        }),
    );
    await mockApi(page, state);

    await openDrawer(page, server);

    // Click the real drawer button and DISMISS the native confirm() guard.
    const dialogMessages: string[] = [];
    page.on('dialog', (dialog) => {
      dialogMessages.push(dialog.message());
      void dialog.dismiss();
    });
    await page.locator('#btn-remove').click();
    await expect.poll(() => dialogMessages.length).toBe(1);
    expect(dialogMessages[0]).toContain(KEY);

    // Give the (would-be) remove flow more than its 800ms close-drawer window.
    await page.waitForTimeout(1000);

    // No POST was sent; drawer stayed open; card is still on the board.
    expect(state.removeCalls).toBe(0);
    await expect(page.locator('#drawer')).not.toHaveClass(/translate-x-full/);
    const card = page.locator('#col-todo article').filter({ hasText: KEY });
    await expect(card).toBeVisible();

    // The API still returns the task.
    expect(await getTaskStatus(page)).toBe(200);

    // And no reload happened either.
    expect(
      await page.evaluate(() => (window as unknown as { __pwNoReload?: boolean }).__pwNoReload),
    ).toBe(true);
  });
});
