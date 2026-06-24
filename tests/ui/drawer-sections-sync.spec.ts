/**
 * drawer-sections-sync.spec.ts — Playwright spec for TASK-060.
 *
 * Both task-detail drawers must render BOTH a Timeline section and a Comments
 * section (list + composer), identically, regardless of entry point:
 *   - the board drawer (index.html), opened by clicking a card
 *   - the tasks-list drawer (tasks.html), opened by clicking a table row
 *
 * Before TASK-060 the board had Timeline but no Comments, and the tasks-list
 * had Comments but no Timeline — so each parametrised case fails on the old
 * code for the section its drawer was missing. The shared renderers live in
 * design-system/drawer-sections.js, included by both pages.
 *
 * Serves design-system/ over HTTP via the ds-server harness and mocks /api/*
 * with stateful page.route handlers (same pattern as drawer-comments.spec.ts):
 * the comments POST appends a comment server-side and the drawer re-fetches
 * the task detail so the new comment appears without a full reload.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { startDsServer, seedToken, type DsServer } from './ds-server';

const PROJECT = 'opf-hub';
const KEY = 'TASK-060X';
const TITLE = 'Drawer sync test';

interface MockComment {
  id: string;
  author_role: string;
  kind: string;
  verdict: string | null;
  body_md: string;
  created_at: string;
}

interface MockTransition {
  from_state: string;
  to_state: string;
  actor_role: string;
  at: string;
}

interface MockState {
  comments: MockComment[];
}

function timeline(): MockTransition[] {
  const now = Date.now();
  return [
    { from_state: 'TODO', to_state: 'IN_PROGRESS', actor_role: 'implementer', at: new Date(now - 10800000).toISOString() },
    { from_state: 'IN_PROGRESS', to_state: 'IMPLEMENTED', actor_role: 'implementer', at: new Date(now - 3600000).toISOString() },
    { from_state: 'JUDGE_PASSED', to_state: 'DONE', actor_role: 'human', at: new Date(now - 1800000).toISOString() },
  ];
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
  return { key: KEY, title: TITLE, state: 'IMPLEMENTED', updated_at: new Date().toISOString() };
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
        task: { ...taskJson(), body_md: 'Spec body for the sync test.' },
        gitrefs: [],
        evidence: null,
        comments: state.comments,
        timeline: timeline(),
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

interface Entry {
  name: string;
  page: string; // page path under the project
  open: (page: Page) => Promise<void>;
}

const ENTRIES: Entry[] = [
  {
    name: 'board drawer (index.html)',
    page: 'index.html',
    open: async (page) => {
      const card = page.locator('article').filter({ hasText: KEY });
      await expect(card).toBeVisible({ timeout: 10000 });
      await card.click();
    },
  },
  {
    name: 'tasks-list drawer (tasks.html)',
    page: 'tasks.html',
    open: async (page) => {
      const row = page.locator('#tasks-tbody tr').filter({ hasText: KEY });
      await expect(row).toBeVisible({ timeout: 10000 });
      await row.click();
    },
  },
];

test.describe('TASK-060: both drawers render Timeline + Comments', () => {
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

  for (const entry of ENTRIES) {
    test(`${entry.name} shows a populated Timeline and a working Comments composer`, async ({ page }) => {
      await mockApi(page, { comments: [seededComment()] });
      await page.goto(server.url(`${PROJECT}/${entry.page}`));
      await entry.open(page);
      await expect(page.locator('#drawer')).not.toHaveClass(/translate-x-full/, { timeout: 5000 });

      // --- Timeline: present, populated, newest-first ---
      const tl = page.locator('#drawer-body [data-timeline]');
      await expect(tl).toBeVisible();
      await expect(tl).toContainText('Timeline');
      const tlRows = tl.locator('ol > li');
      await expect(tlRows).toHaveCount(3);
      // Newest-first: the DONE transition (human) is first.
      await expect(tlRows.first()).toContainText('DONE');

      // --- TASK-065: agent icon + state chips ---
      // Each row has an icon with data-agent-icon.
      const icons = tl.locator('[data-agent-icon]');
      await expect(icons).toHaveCount(3);
      // Newest row is 'human' role -> ph-user; older rows are 'implementer' -> ph-robot.
      await expect(icons.first()).toHaveClass(/ph-user/);
      await expect(icons.nth(1)).toHaveClass(/ph-robot/);
      // Each row has two state chips (data-state-chip); first row has DONE.
      const chips = tlRows.first().locator('[data-state-chip]');
      await expect(chips).toHaveCount(2);
      await expect(chips.first()).toHaveText('JUDGE_PASSED');
      await expect(chips.nth(1)).toHaveText('DONE');
      // Chip carries a state-colored class (st_done text color for DONE).
      await expect(chips.nth(1)).toHaveClass(/text-st_done/);

      // --- Comments: existing comment rendered, composer present ---
      const comments = page.locator('#drawer-body [data-comments]');
      await expect(comments).toBeVisible();
      await expect(comments).toContainText('Comments');
      const firstComment = page.locator('#drawer-body [data-comments-list] li').first();
      await expect(firstComment).toContainText('judge');
      await expect(firstComment).toContainText('PASS');
      await expect(firstComment).toContainText('Approved');

      // Composer: disabled empty, enabled with text, posting appends + refreshes.
      const submit = page.locator('#comment-submit');
      await expect(submit).toBeDisabled();
      await page.locator('#comment-input').fill('Looks good from the board/list.');
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect(
        page.locator('#drawer-body [data-comments-list] li').filter({ hasText: 'Looks good from the board/list.' }),
      ).toBeVisible({ timeout: 5000 });
    });
  }
});
