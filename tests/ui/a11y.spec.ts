/**
 * a11y.spec.ts — axe-core accessibility scan for TASK-036.
 *
 * Lighthouse scored the board Accessibility 89 with three failing audits:
 *   - button-name                  (icon-only buttons with no accessible name)
 *   - color-contrast               (insufficient text contrast)
 *   - label-content-name-mismatch  (visible label not contained in the
 *                                   accessible name, e.g. project switcher)
 *
 * This spec serves design-system/ over HTTP via the ds-server harness, mocks
 * /api/* with page.route (same pattern as drawer-approve.spec.ts) so the board
 * renders cards in every column — including priority/tag badges and the
 * lease chip — and runs @axe-core/playwright against:
 *   1. the sign-in page,
 *   2. the board,
 *   3. the board with the task detail drawer open,
 * in BOTH the light and dark themes (theme.js reads localStorage 'ak-theme').
 *
 * The scan runs the full WCAG A/AA rule set (which includes button-name,
 * color-contrast and label-content-name-mismatch) and asserts ZERO
 * violations. No rule is disabled and no element is excluded.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startDsServer, type DsServer } from './ds-server';

const PROJECT = 'opf-hub';
const DRAWER_KEY = 'A11Y-5';

/** WCAG A/AA tags — cover the three Lighthouse rules without best-practice noise. */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** The three audits Lighthouse flagged; they must be part of the scan. */
const REQUIRED_RULES = ['button-name', 'color-contrast', 'label-content-name-mismatch'];

async function expectNoViolations(page: Page, context: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    // .options() replaces all axe.run options, so the WCAG tag filter lives
    // here too. label-content-name-mismatch is tagged "experimental" in
    // axe-core and ships disabled — turn it ON explicitly (the opposite of
    // disabling a rule).
    .options({
      runOnly: { type: 'tag', values: WCAG_TAGS },
      rules: { 'label-content-name-mismatch': { enabled: true } },
    })
    .analyze();

  // Sanity: the required rules are in the executed rule set (not disabled).
  const executed = new Set(
    [...results.passes, ...results.violations, ...results.incomplete, ...results.inapplicable].map(
      (r) => r.id,
    ),
  );
  for (const rule of REQUIRED_RULES) {
    expect(executed.has(rule), `${context}: rule '${rule}' must be part of the scan`).toBe(true);
  }

  // Readable failure output: rule id + offending selectors.
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
  expect(summary, `${context}: axe WCAG A/AA violations`).toEqual([]);
}

/** Board fixtures: one card per column, with priority/tags/lease rendering. */
function boardTasks(): Array<Record<string, unknown>> {
  const now = new Date().toISOString();
  const lease = new Date(Date.now() + 25 * 60000).toISOString();
  return [
    { key: 'A11Y-1', title: 'Backlog card', state: 'TODO', priority: 'P0', tags: ['a11y', 'board'], updated_at: now },
    { key: 'A11Y-2', title: 'In progress card', state: 'IN_PROGRESS', priority: 'P1', lease_until: lease, updated_at: now },
    { key: 'A11Y-3', title: 'Evidence card', state: 'EVIDENCE', priority: 'P2', updated_at: now },
    { key: 'A11Y-4', title: 'Rejected card', state: 'JUDGE_REJECTED', priority: 'P3', tags: ['one', 'two', 'three', 'four'], updated_at: now },
    { key: DRAWER_KEY, title: 'Awaiting human card', state: 'JUDGE_PASSED', priority: 'P1', tags: ['drawer'], updated_at: now },
    { key: 'A11Y-6', title: 'Done card', state: 'DONE', updated_at: now },
  ];
}

function json(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Mock /api/* so the board + drawer render fully (no live server needed). */
async function mockApi(page: Page): Promise<void> {
  const now = new Date().toISOString();
  await page.route(
    (url) => url.pathname.endsWith('/api/projects'),
    (route) => json(route, { projects: [{ id: 'p1', slug: PROJECT, name: PROJECT }] }),
  );
  await page.route(
    (url) => url.pathname.endsWith('/api/tasks'),
    (route) => json(route, { tasks: boardTasks() }),
  );
  await page.route(
    (url) => url.pathname.endsWith(`/api/tasks/${DRAWER_KEY}`),
    (route) =>
      json(route, {
        task: {
          key: DRAWER_KEY,
          title: 'Awaiting human card',
          state: 'JUDGE_PASSED',
          updated_at: now,
          body_md: 'Spec body for the a11y drawer scan.',
          priority: 'P1',
          complexity: '3',
          estimate_hours: 4,
          tags: ['drawer', 'a11y'],
          link_document: 'https://example.com/spec',
        },
        gitrefs: [
          {
            repo: '.',
            branch: 'fix/TASK-036-a11y',
            head_sha: 'abc1234def5678',
            mr_url: 'https://example.com/mr/1',
          },
        ],
        evidence: { build_exit: 0, test_exit: 1 },
        timeline: [
          { actor_role: 'implementer', from_state: 'TODO', to_state: 'IN_PROGRESS', at: now },
          { actor_role: 'judge', from_state: 'SELF_CHECK_PASSED', to_state: 'JUDGE_PASSED', at: now, note: 'VERDICT: PASS' },
        ],
      }),
  );
  // Tokens page (TASK-041): one card per status — live / idle / never / revoked.
  await page.route(
    (url) => url.pathname.endsWith('/api/tokens'),
    (route) =>
      json(route, {
        tokens: [
          { id: 'tk_h', role: 'human', project_id: null, label: 'op-root', created_at: now, revoked_at: null, last_used_at: now },
          { id: 'tk_i', role: 'implementer', project_id: 'p1', label: 'idle-agent', created_at: now, revoked_at: null, last_used_at: new Date(Date.now() - 2 * 86400000).toISOString() },
          { id: 'tk_n', role: 'runner', project_id: null, label: 'fresh-runner', created_at: now, revoked_at: null, last_used_at: null },
          { id: 'tk_r', role: 'judge', project_id: null, label: 'retired-judge', created_at: now, revoked_at: now, last_used_at: now },
        ],
      }),
  );
  // Quiet SSE stream; huge retry so EventSource never reconnects mid-test.
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

for (const theme of ['light', 'dark'] as const) {
  test.describe(`a11y (axe, WCAG A/AA) — ${theme} theme`, () => {
    let server: DsServer;

    test.beforeAll(async () => {
      server = await startDsServer();
    });

    test.afterAll(async () => {
      await server.close();
    });

    test.beforeEach(async ({ page }) => {
      // Force the theme deterministically (theme.js honors 'ak-theme').
      await page.addInitScript((t: string) => {
        localStorage.setItem('ak-theme', t);
      }, theme);
    });

    test('sign-in page has no violations', async ({ page }) => {
      // No kanban_token seeded: signin.html redirects away when one exists.
      await page.goto(server.url('signin.html'));
      await expect(page.getByRole('heading', { name: 'Operator access' })).toBeVisible();
      await expectNoViolations(page, `signin/${theme}`);
    });

    test('board has no violations', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('kanban_token', 'a11y-test-token');
      });
      await mockApi(page);
      await page.goto(server.url('index.html'));
      // shell.js redirects to /opf-hub/index.html; wait for rendered columns.
      await expect(page.locator('#board-columns')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('#col-judge_passed article')).toBeVisible();
      await expectNoViolations(page, `board/${theme}`);
    });

    test('board with drawer open has no violations', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('kanban_token', 'a11y-test-token');
      });
      await mockApi(page);
      await page.goto(server.url('index.html'));
      const card = page.locator('#col-judge_passed article').filter({ hasText: DRAWER_KEY });
      await expect(card).toBeVisible({ timeout: 10000 });
      await card.click();
      await expect(page.locator('#drawer')).not.toHaveClass(/translate-x-full/, { timeout: 5000 });
      // Wait for the drawer body (attributes, gitrefs, evidence, timeline).
      await expect(page.locator('#drawer-state-badge')).toContainText('JUDGE_PASSED');
      await expect(page.locator('#drawer-body')).toContainText('Timeline');
      await expect(page.locator('#btn-approve')).toBeVisible();
      await expectNoViolations(page, `board+drawer/${theme}`);
    });

    test('tokens page (card grid, all statuses) has no violations', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('kanban_token', 'a11y-test-token');
      });
      await mockApi(page);
      await page.goto(server.url('tokens.html'));
      // All four status renderings present: live, idle, never used, revoked.
      await expect(page.locator('#tokens-grid [data-status="live"]')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('#tokens-grid [data-status="idle"]')).toBeVisible();
      await expect(page.locator('#tokens-grid [data-status="never"]')).toBeVisible();
      await expect(page.locator('#tokens-grid [data-status="revoked"]')).toBeVisible();
      await expectNoViolations(page, `tokens/${theme}`);
    });

    test('tokens page with revoke dialog open has no violations', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('kanban_token', 'a11y-test-token');
      });
      await mockApi(page);
      await page.goto(server.url('tokens.html'));
      await expect(page.locator('#tokens-grid [data-revoke-id]').first()).toBeVisible({ timeout: 10000 });
      await page.locator('#tokens-grid [data-revoke-id]').first().click();
      await expect(page.locator('#revoke-confirm')).toBeVisible();
      await expectNoViolations(page, `tokens+revoke-dialog/${theme}`);
    });

    test('workflow page (state machine diagram) has no violations', async ({ page }) => {
      test.slow(); // CDN-loaded CSS/fonts can make the cold page load crawl in full runs
      await page.addInitScript(() => {
        localStorage.setItem('kanban_token', 'a11y-test-token');
      });
      await mockApi(page);
      await page.goto(server.url('workflow.html'));
      // Inline SVG diagram + role table rendered before the scan.
      await expect(page.locator('#workflow-diagram svg')).toBeVisible({ timeout: 10000 });
      await expect(page.getByRole('table')).toBeVisible();
      await expectNoViolations(page, `workflow/${theme}`);
    });
  });
}
