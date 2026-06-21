/**
 * workflow-page.spec.ts — Playwright spec for TASK-043 / TASK-054.
 *
 * The "Workflow" page documents the no-self-certification lifecycle with an
 * inline SVG state machine diagram. These tests run on the ds-server harness
 * (design-system/ served over HTTP, /api/* mocked with page.route) and cover:
 *
 *   1. The centralized sidebar nav (shell.js) shows a "Workflow" entry on
 *      other pages, clicking it navigates to workflow.html, and the entry
 *      carries the active-state styling only on the workflow page itself.
 *   2. The inline diagram renders ALL 9 state names of the state machine
 *      (asserted as SVG text, scoped to the diagram — not page prose).
 *   3. At a 375px viewport the page has no horizontal overflow; the diagram
 *      scrolls inside its own container instead of breaking the layout.
 *   4. The pr-bot edge label is present in the diagram, and the direct
 *      JUDGE_PASSED → DONE human edge is retained (optional-path semantics).
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { startDsServer, seedToken, type DsServer } from './ds-server';

const PROJECT = 'opf-hub';

/** All 9 states of the gate's state machine (.ai/WORKFLOW_DESIGN.md §4 + TASK-051). */
const STATES = [
  'TODO',
  'IN_PROGRESS',
  'IMPLEMENTED',
  'SELF_CHECK_PASSED',
  'SELF_CHECK_FAILED',
  'JUDGE_PASSED',
  'JUDGE_REJECTED',
  'READY_TO_REVIEW',
  'DONE',
] as const;

function json(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Quiet /api/* mocks so shell.js (rail, awaiting badge) renders without a server. */
async function mockApi(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname.endsWith('/api/projects'),
    (route) => json(route, { projects: [{ id: 'p1', slug: PROJECT, name: PROJECT }] }),
  );
  await page.route(
    (url) => url.pathname.endsWith('/api/tasks'),
    (route) => json(route, { tasks: [] }),
  );
  await page.route(
    (url) => url.pathname.endsWith('/api/tokens'),
    (route) => json(route, { tokens: [] }),
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

test.describe('TASK-043: workflow explainer page', () => {
  let server: DsServer;

  test.beforeAll(async () => {
    server = await startDsServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  test.beforeEach(async ({ context, page }) => {
    await seedToken(context); // api.js signin gate: token present -> no redirect
    await mockApi(page);
  });

  test('sidebar shows a Workflow entry on other pages and it navigates to workflow.html', async ({ page }) => {
    test.slow(); // two cold page loads -> double the CDN-loaded CSS/font fetches
    await page.goto(server.url('tokens.html'));
    const link = page.locator('#rail nav a', { hasText: 'Workflow' });
    await expect(link).toBeVisible({ timeout: 10000 });
    await expect(link).toHaveAttribute('href', 'workflow.html');
    // Not the active entry while on the tokens page.
    await expect(link).not.toHaveClass(/bg-accent\/12/);

    await link.click();
    await expect(page).toHaveURL(/\/workflow\.html$/);
    await expect(page.getByRole('heading', { name: 'State machine' })).toBeVisible();

    // On its own page the entry carries the active-state styling.
    const active = page.locator('#rail nav a', { hasText: 'Workflow' });
    await expect(active).toHaveClass(/bg-accent\/12/);
  });

  test('inline SVG diagram renders all 9 state names', async ({ page }) => {
    await page.goto(server.url('workflow.html'));
    const svg = page.locator('#workflow-diagram svg');
    await expect(svg).toBeVisible();
    for (const state of STATES) {
      await expect(
        svg.locator('text').filter({ hasText: new RegExp(`^${state}$`) }),
        `diagram node for ${state}`,
      ).toBeVisible();
    }
  });

  test('SVG diagram shows the pr-bot edge label and retains the direct JUDGE_PASSED → DONE path', async ({ page }) => {
    await page.goto(server.url('workflow.html'));
    const diagram = page.locator('#workflow-diagram');

    // pr-bot actor is referenced on the JUDGE_PASSED → READY_TO_REVIEW edge.
    await expect(
      diagram.locator('text').filter({ hasText: /pr-bot/ }),
      'pr-bot edge label in the SVG diagram',
    ).toBeVisible();

    // Direct human-approve path JUDGE_PASSED → DONE is retained (optional path
    // semantics: the human must never be blocked when the pr-bot is offline).
    await expect(
      diagram.getByText(/human.*approve.*direct/i),
      'direct JUDGE_PASSED → DONE edge label in the SVG diagram',
    ).toBeVisible();
  });

  test('no horizontal page overflow at 375px; diagram scrolls in its own container', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(server.url('workflow.html'));
    await expect(page.locator('#workflow-diagram svg')).toBeVisible();

    // The page layout itself never overflows horizontally.
    const overflow = await page.evaluate(() => {
      const el = document.scrollingElement || document.documentElement;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflow, 'page horizontal overflow in px').toBeLessThanOrEqual(0);

    // The 840px-wide diagram is NOT squashed away: it overflows (and scrolls)
    // inside its own dedicated container instead of the page.
    const scroller = page.locator('#workflow-diagram [tabindex="0"]');
    const inner = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(inner, 'diagram container scrollable width').toBeGreaterThan(0);
  });
});
