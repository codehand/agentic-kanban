/**
 * tasks-enhancements.spec.ts — Playwright spec for TASK-040.
 *
 * Asserts on the Tasks list page (design-system/tasks.html + tasks.js):
 *   1. Sort: clicking a column header sorts the rows, clicking again toggles
 *      asc/desc, `aria-sort` is set on the active column only, headers are
 *      keyboard-operable, and sorting composes with search + state filter.
 *   2. Full width: the table wrapper no longer has the max-w-[1200px] cap
 *      (table actually exceeds 1200px on a wide viewport) and a 375px
 *      viewport produces no page-level horizontal overflow.
 *   3. State pipeline column: each row renders a 6-node step indicator with
 *      the correct number of active nodes, a fail-colored node for failure
 *      states, and the exact state name in the accessible name + title.
 *
 * Serves design-system/ over HTTP (ds-server helper) and mocks /api/* by
 * overriding window.fetch in the page (same pattern as tasks-view.spec.ts).
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startDsServer, type DsServer } from './ds-server';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_DIR = path.resolve(__dirname, '../../docs/ui/TASK-040');

let server: DsServer;

/* Fixture rows. Orders are all distinct on purpose:
 *   default (API) order : 201, 104, 300, 150
 *   key asc             : 104, 150, 201, 300
 *   title asc           : 300, 104, 201, 150
 *   updated asc (oldest): 150, 300, 201, 104
 */
async function mockApi(page: Page) {
  await page.addInitScript(() => {
    const now = Date.now();
    const PROJECTS_RESP = JSON.stringify({ projects: [{ id: 'p1', slug: 'opf-hub', name: 'opf-hub' }] });
    const TASKS_RESP = JSON.stringify({
      tasks: [
        { key: 'TASK-201', title: 'Charlie board polish', state: 'DONE', updated_at: new Date(now - 2 * 3600_000).toISOString() },
        { key: 'TASK-104', title: 'Bravo drawer fix', state: 'IN_PROGRESS', updated_at: new Date(now - 60_000).toISOString() },
        { key: 'TASK-300', title: 'Alpha api retry', state: 'SELF_CHECK_FAILED', updated_at: new Date(now - 24 * 3600_000).toISOString() },
        { key: 'TASK-150', title: 'Delta cleanup', state: 'TODO', updated_at: new Date(now - 3 * 24 * 3600_000).toISOString() },
      ],
    });
    const origFetch = window.fetch.bind(window);
    window.fetch = async function (input: any, init?: any) {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/api/projects')) {
        return new Response(PROJECTS_RESP, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/tasks')) {
        return new Response(TASKS_RESP, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return origFetch(input, init);
    };
  });
}

async function openTasksPage(page: Page) {
  await mockApi(page);
  await page.goto(server.url('tasks.html'));
  await page.waitForSelector('#tasks-tbody tr', { timeout: 5000 });
}

function rowKeys(page: Page): Promise<string[]> {
  return page.$$eval('#tasks-tbody tr td:first-child', (tds) => tds.map((td) => (td.textContent || '').trim()));
}

test.describe('TASK-040: Tasks list sort / full-width / pipeline', () => {
  test.beforeAll(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    server = await startDsServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      localStorage.setItem('kanban_token', 'test-token');
    });
  });

  test('default order is unchanged and no column is marked sorted', async ({ page }) => {
    await openTasksPage(page);
    expect(await rowKeys(page)).toEqual(['TASK-201', 'TASK-104', 'TASK-300', 'TASK-150']);
    await expect(page.locator('th[aria-sort]')).toHaveCount(0);
  });

  test('clicking Key header sorts asc, clicking again toggles desc, aria-sort follows', async ({ page }) => {
    await openTasksPage(page);
    const keyTh = page.locator('th[data-col="key"]');

    await keyTh.locator('button').click();
    expect(await rowKeys(page)).toEqual(['TASK-104', 'TASK-150', 'TASK-201', 'TASK-300']);
    await expect(keyTh).toHaveAttribute('aria-sort', 'ascending');
    await expect(keyTh.locator('[data-sort-icon]')).toBeVisible();
    await expect(keyTh.locator('[data-sort-icon]')).toHaveClass(/ph-caret-up/);
    // Only the active column carries aria-sort.
    await expect(page.locator('th[aria-sort]')).toHaveCount(1);

    await keyTh.locator('button').click();
    expect(await rowKeys(page)).toEqual(['TASK-300', 'TASK-201', 'TASK-150', 'TASK-104']);
    await expect(keyTh).toHaveAttribute('aria-sort', 'descending');
    await expect(keyTh.locator('[data-sort-icon]')).toHaveClass(/ph-caret-down/);
  });

  test('headers are keyboard-operable and aria-sort moves between columns', async ({ page }) => {
    await openTasksPage(page);
    const keyTh = page.locator('th[data-col="key"]');
    const titleTh = page.locator('th[data-col="title"]');

    await keyTh.locator('button').click();
    await expect(keyTh).toHaveAttribute('aria-sort', 'ascending');

    // Activate the Title header with the keyboard only.
    await titleTh.locator('button').focus();
    await page.keyboard.press('Enter');
    expect(await rowKeys(page)).toEqual(['TASK-300', 'TASK-104', 'TASK-201', 'TASK-150']); // title asc
    await expect(titleTh).toHaveAttribute('aria-sort', 'ascending');
    await expect(keyTh).not.toHaveAttribute('aria-sort');
  });

  test('sorting by Updated orders rows by recency', async ({ page }) => {
    await openTasksPage(page);
    const updTh = page.locator('th[data-col="updated"]');

    await updTh.locator('button').click(); // asc = oldest first
    expect(await rowKeys(page)).toEqual(['TASK-150', 'TASK-300', 'TASK-201', 'TASK-104']);
    await expect(updTh).toHaveAttribute('aria-sort', 'ascending');

    await updTh.locator('button').click(); // desc = newest first
    expect(await rowKeys(page)).toEqual(['TASK-104', 'TASK-201', 'TASK-300', 'TASK-150']);
    await expect(updTh).toHaveAttribute('aria-sort', 'descending');
  });

  test('sort composes with the state filter and the search box', async ({ page }) => {
    await openTasksPage(page);
    const keyTh = page.locator('th[data-col="key"]');

    await keyTh.locator('button').click(); // key asc
    await page.locator('#state-filter').selectOption('TODO');
    expect(await rowKeys(page)).toEqual(['TASK-150']);

    await page.locator('#state-filter').selectOption(''); // clear filter — sort persists
    expect(await rowKeys(page)).toEqual(['TASK-104', 'TASK-150', 'TASK-201', 'TASK-300']);

    await keyTh.locator('button').click(); // toggle to desc
    await page.locator('#task-search').fill('TASK-1'); // matches 104 + 150 only
    expect(await rowKeys(page)).toEqual(['TASK-150', 'TASK-104']);
  });

  test('table fills the main column (1200px cap removed)', async ({ page }) => {
    // Wide enough that the old max-w-[1200px] cap would visibly bite
    // (rail is 244px, so the main column is ~1628px after padding).
    await page.setViewportSize({ width: 1920, height: 900 });
    await openTasksPage(page);
    // The wrapper markup must not reintroduce the old cap.
    const wrapHtml = await page.locator('#tasks-table-wrap').evaluate((el) => el.outerHTML);
    expect(wrapHtml).not.toContain('max-w-[1200px]');
    // Behavioral check: the table is wider than the old cap allowed.
    const box = await page.locator('#tasks-table-wrap table').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(1200);
  });

  test('no page-level horizontal overflow at 375px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openTasksPage(page);
    await expect(page.locator('#tasks-tbody tr')).toHaveCount(4);
    const overflow = await page.evaluate(() => ({
      html: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(overflow.html).toBeLessThanOrEqual(overflow.viewport);
    expect(overflow.body).toBeLessThanOrEqual(overflow.viewport);
  });

  test('state pipeline: 6 nodes, active count per state, fail node for failures', async ({ page }) => {
    await openTasksPage(page);

    // DONE — all 6 steps active, exact state in accessible name + tooltip.
    const done = page.locator('#tasks-tbody tr', { hasText: 'TASK-201' }).locator('[data-pipeline]');
    await expect(done).toHaveAttribute('aria-label', 'State: DONE');
    await expect(done).toHaveAttribute('title', 'DONE');
    await expect(done.locator('[data-step]')).toHaveCount(6);
    await expect(done.locator('[data-step="active"]')).toHaveCount(6);
    await expect(done.locator('[data-step="fail"]')).toHaveCount(0);

    // IN_PROGRESS — TODO + IN_PROGRESS active, 4 upcoming.
    const prog = page.locator('#tasks-tbody tr', { hasText: 'TASK-104' }).locator('[data-pipeline]');
    await expect(prog).toHaveAttribute('aria-label', 'State: IN_PROGRESS');
    await expect(prog.locator('[data-step]')).toHaveCount(6);
    await expect(prog.locator('[data-step="active"]')).toHaveCount(2);
    await expect(prog.locator('[data-step="upcoming"]')).toHaveCount(4);

    // SELF_CHECK_FAILED — 3 earlier steps active, SELF_CHECK node fail-colored.
    const failed = page.locator('#tasks-tbody tr', { hasText: 'TASK-300' }).locator('[data-pipeline]');
    await expect(failed).toHaveAttribute('aria-label', 'State: SELF_CHECK_FAILED');
    await expect(failed).toHaveAttribute('title', 'SELF_CHECK_FAILED');
    await expect(failed.locator('[data-step]')).toHaveCount(6);
    await expect(failed.locator('[data-step="active"]')).toHaveCount(3);
    await expect(failed.locator('[data-step="fail"]')).toHaveCount(1);
    await expect(failed.locator('[data-step="fail"]')).toHaveAttribute('data-stage', 'SELF_CHECK');
    await expect(failed.locator('[data-step="upcoming"]')).toHaveCount(2);

    // Fail color is actually distinct from active + upcoming (computed styles).
    const colors = await failed.evaluate((el) => {
      const bg = (sel: string) => getComputedStyle(el.querySelector(sel)!).backgroundColor;
      return { active: bg('[data-step="active"]'), fail: bg('[data-step="fail"]'), upcoming: bg('[data-step="upcoming"]') };
    });
    expect(colors.fail).not.toEqual(colors.active);
    expect(colors.fail).not.toEqual(colors.upcoming);
    expect(colors.active).not.toEqual(colors.upcoming);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`screenshot for visual review — ${theme} theme`, async ({ page }) => {
      await page.addInitScript((t: string) => {
        localStorage.setItem('ak-theme', t);
      }, theme);
      await openTasksPage(page);
      await page.screenshot({ path: path.join(OUT_DIR, `tasks-pipeline-${theme}.png`), fullPage: false });
    });
  }
});
