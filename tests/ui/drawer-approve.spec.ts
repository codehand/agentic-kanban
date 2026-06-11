/**
 * drawer-approve.spec.ts — Playwright spec for TASK-035.
 *
 * The bug: approving a task from the detail drawer moved the card on the
 * board (SSE) but left the OPEN drawer stale — badge still JUDGE_PASSED,
 * Approve button still enabled, timeline missing the final
 * JUDGE_PASSED → DONE entry.
 *
 * These tests serve design-system/ over HTTP via the ds-server harness and
 * mock /api/* with stateful page.route handlers: the approve POST flips the
 * task to DONE server-side, and the drawer must pick that up via refetch of
 * the task detail (same data path the board uses) — no hardcoded state, no
 * page reload.
 *
 * Covered:
 *   1. Approve → Done → Confirm from the drawer: drawer updates in place to
 *      the DONE badge, hides the Approve button, and shows the
 *      JUDGE_PASSED → DONE timeline entry.
 *   2. The transition arrives via SSE while the drawer is open (e.g. approved
 *      via MCP task.approve from another client): same in-place update.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { startDsServer, type DsServer } from './ds-server';

const PROJECT = 'opf-hub';
const KEY = 'TASK-035E';
const TITLE = 'Drawer approve refresh test';

interface TimelineEntry {
  actor_role: string;
  from_state: string;
  to_state: string;
  at: string;
}

/** Mutable server-side task state shared by the route mocks. */
interface MockTask {
  state: string;
  timeline: TimelineEntry[];
}

function makeJudgePassedTask(): MockTask {
  const at = new Date().toISOString();
  return {
    state: 'JUDGE_PASSED',
    timeline: [
      { actor_role: 'implementer', from_state: 'TODO', to_state: 'IN_PROGRESS', at },
      { actor_role: 'judge', from_state: 'SELF_CHECK_PASSED', to_state: 'JUDGE_PASSED', at },
    ],
  };
}

/** What the real server does on approve: transition JUDGE_PASSED → DONE. */
function approveOnServer(task: MockTask): TimelineEntry {
  const entry: TimelineEntry = {
    actor_role: 'human',
    from_state: task.state,
    to_state: 'DONE',
    at: new Date().toISOString(),
  };
  task.timeline.push(entry);
  task.state = 'DONE';
  return entry;
}

function json(route: Route, body: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function taskJson(task: MockTask): Record<string, unknown> {
  return { key: KEY, title: TITLE, state: task.state, updated_at: new Date().toISOString() };
}

/** Mock /api/projects, board list, task detail and approve against `task`. */
async function mockApi(page: Page, task: MockTask): Promise<void> {
  await page.route(
    (url) => url.pathname.endsWith('/api/projects'),
    (route) => json(route, { projects: [{ id: 'p1', slug: PROJECT, name: PROJECT }] }),
  );
  await page.route(
    (url) => url.pathname.endsWith('/api/tasks'),
    (route) => json(route, { tasks: [taskJson(task)] }),
  );
  await page.route(
    (url) => url.pathname.endsWith(`/api/tasks/${KEY}`),
    (route) =>
      json(route, {
        task: { ...taskJson(task), body_md: 'Spec body for the drawer approve test.' },
        gitrefs: [],
        evidence: null,
        timeline: task.timeline,
      }),
  );
  await page.route(
    (url) => url.pathname.endsWith(`/api/tasks/${KEY}/approve`),
    (route) => {
      approveOnServer(task);
      return json(route, { task: taskJson(task) });
    },
  );
}

/** Open the board, click the JUDGE_PASSED card, wait for the drawer. */
async function openDrawer(page: Page, server: DsServer): Promise<void> {
  await page.goto(server.url('index.html'));
  const card = page.locator('#col-judge_passed article').filter({ hasText: KEY });
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.click();
  await expect(page.locator('#drawer')).not.toHaveClass(/translate-x-full/, { timeout: 5000 });
  // Drawer reflects the pre-approve state.
  await expect(page.locator('#drawer-state-badge')).toContainText('JUDGE_PASSED');
  await expect(page.locator('#btn-approve')).toBeVisible();
  // Marker to prove the later update happens without a full page reload.
  await page.evaluate(() => {
    (window as unknown as { __pwNoReload?: boolean }).__pwNoReload = true;
  });
}

/** Assert the open drawer now shows DONE + the final timeline entry. */
async function expectDrawerDone(page: Page): Promise<void> {
  await expect(page.locator('#drawer-state-badge')).toContainText('DONE', { timeout: 5000 });
  await expect(page.locator('#btn-approve')).toBeHidden();
  // Final timeline entry: JUDGE_PASSED → DONE (&rarr; renders as '→').
  await expect(
    page.locator('#drawer-body li').filter({ hasText: /JUDGE_PASSED\s*→\s*DONE/ }),
  ).toBeVisible();
  // Drawer is still open and no full reload happened.
  await expect(page.locator('#drawer')).not.toHaveClass(/translate-x-full/);
  expect(
    await page.evaluate(() => (window as unknown as { __pwNoReload?: boolean }).__pwNoReload),
  ).toBe(true);
}

test.describe('TASK-035: drawer refreshes after approve', () => {
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

  test('approving from the drawer updates badge + timeline in place', async ({ page }) => {
    const task = makeJudgePassedTask();
    await mockApi(page, task);
    // Quiet SSE stream: connected only, huge retry so it never reconnects
    // within the test. The drawer update must come from the approve refetch.
    await page.route(
      (url) => url.pathname.endsWith('/api/stream'),
      (route) =>
        route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
          body: 'retry: 600000\n\nevent: connected\ndata: {}\n\n',
        }),
    );

    await openDrawer(page, server);

    // Approve → Done → Confirm.
    await page.locator('#btn-approve').click();
    await expect(page.locator('#confirm')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm Approve' }).click();

    await expectDrawerDone(page);
  });

  test('SSE transition while drawer is open updates it (MCP approve)', async ({ page }) => {
    const task = makeJudgePassedTask();
    await mockApi(page, task);

    // Hold SSE connections pending until the "other client" approves, then
    // serve a real event-stream body with the transition event.
    const pendingSse: Route[] = [];
    let sseBody: string | null = null;
    await page.route(
      (url) => url.pathname.endsWith('/api/stream'),
      async (route) => {
        if (sseBody !== null) {
          await route.fulfill({
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
            body: sseBody,
          });
          return;
        }
        pendingSse.push(route);
      },
    );

    await openDrawer(page, server);

    // Approve happens elsewhere (MCP task.approve): flip the mock server
    // state, then deliver the SSE transition event to the open page.
    const entry = approveOnServer(task);
    sseBody =
      'retry: 600000\n\n' +
      'event: connected\ndata: {}\n\n' +
      `event: transition\ndata: ${JSON.stringify({
        task_id: 't1',
        project: PROJECT,
        key: KEY,
        from_state: entry.from_state,
        to_state: entry.to_state,
        actor_role: entry.actor_role,
        at: entry.at,
      })}\n\n`;
    for (const route of pendingSse) {
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

    await expectDrawerDone(page);
  });
});
