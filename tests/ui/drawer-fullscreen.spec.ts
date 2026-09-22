/**
 * drawer-fullscreen.spec.ts — Playwright spec for TASK-069.
 *
 * The task-detail drawer used to be pinned to `sm:w-[520px]`. It must now:
 *   - open at ~2/3 of the viewport width on desktop (`w-full sm:w-2/3`),
 *   - expose a [data-drawer-fullscreen] header toggle that widens it to the
 *     full viewport and back, with the icon and aria-pressed tracking state,
 *   - remember the chosen mode across a reload,
 * identically on BOTH drawers (board index.html + task-list tasks.html), whose
 * shared toggle lives in design-system/drawer-sections.js.
 *
 * On the old code every case fails: the drawer measures 520px instead of 2/3
 * of the viewport and the toggle button does not exist.
 *
 * Serves design-system/ over HTTP via the ds-server harness and mocks /api/*
 * (same pattern as drawer-sections-sync.spec.ts).
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { startDsServer, seedToken, type DsServer } from './ds-server';

const PROJECT = 'opf-hub';
const KEY = 'TASK-069X';
const TITLE = 'Drawer fullscreen test';

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function taskJson(): Record<string, unknown> {
  return { key: KEY, title: TITLE, state: 'IMPLEMENTED', updated_at: new Date().toISOString() };
}

async function mockApi(page: Page): Promise<void> {
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
        task: { ...taskJson(), body_md: 'Spec body for the fullscreen test.' },
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

/** Rendered width of #drawer in CSS pixels. */
async function drawerWidth(page: Page): Promise<number> {
  const box = await page.locator('#drawer').boundingBox();
  if (!box) throw new Error('#drawer has no bounding box');
  return box.width;
}

async function viewportWidth(page: Page): Promise<number> {
  return page.evaluate(() => window.innerWidth);
}

/** Open the drawer and wait for its slide-in transform to settle. */
async function openDrawer(page: Page, entry: Entry): Promise<void> {
  await entry.open(page);
  const drawer = page.locator('#drawer');
  await expect(drawer).not.toHaveClass(/translate-x-full/, { timeout: 5000 });
  await expect(drawer).toBeVisible();
  // The 260ms transform transition must finish before widths are measured.
  await page.waitForTimeout(400);
}

test.describe('TASK-069: drawer defaults to 2/3 width and toggles fullscreen', () => {
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
    test(`${entry.name}: opens at ~2/3 viewport, toggles to full width and back`, async ({ page }) => {
      await mockApi(page);
      await page.goto(server.url(`${PROJECT}/${entry.page}`));
      await openDrawer(page, entry);

      const vw = await viewportWidth(page);
      const toggle = page.locator('#drawer [data-drawer-fullscreen]');
      const icon = toggle.locator('i');

      // --- default: ~2/3 of the viewport (NOT the old fixed 520px) ---
      expect(await drawerWidth(page)).toBeCloseTo((vw * 2) / 3, -1);
      await expect(page.locator('#drawer')).toHaveClass(/sm:w-2\/3/);
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await expect(toggle).toHaveAttribute('aria-label', /expand/i);
      await expect(icon).toHaveClass(/ph-arrows-out/);

      // --- toggle on: full viewport width, state reflected in a11y + icon ---
      await toggle.click();
      await page.waitForTimeout(100);
      expect(await drawerWidth(page)).toBeCloseTo(vw, -1);
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await expect(toggle).toHaveAttribute('aria-label', /exit/i);
      await expect(icon).toHaveClass(/ph-arrows-in/);
      await expect(icon).not.toHaveClass(/ph-arrows-out/);

      // --- toggle off: back to 2/3 ---
      await toggle.click();
      await page.waitForTimeout(100);
      expect(await drawerWidth(page)).toBeCloseTo((vw * 2) / 3, -1);
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await expect(icon).toHaveClass(/ph-arrows-out/);
    });

    test(`${entry.name}: fullscreen choice survives a reload`, async ({ page }) => {
      await mockApi(page);
      await page.goto(server.url(`${PROJECT}/${entry.page}`));
      await openDrawer(page, entry);

      const vw = await viewportWidth(page);
      await page.locator('#drawer [data-drawer-fullscreen]').click();
      await page.waitForTimeout(100);
      expect(await drawerWidth(page)).toBeCloseTo(vw, -1);

      // Reload: the stored mode is applied on load, before/independently of
      // the drawer being reopened.
      await page.reload();
      await openDrawer(page, entry);
      const toggle = page.locator('#drawer [data-drawer-fullscreen]');
      expect(await drawerWidth(page)).toBeCloseTo(vw, -1);
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await expect(toggle.locator('i')).toHaveClass(/ph-arrows-in/);

      // And turning it back off also persists.
      await toggle.click();
      await page.waitForTimeout(100);
      await page.reload();
      await openDrawer(page, entry);
      expect(await drawerWidth(page)).toBeCloseTo((vw * 2) / 3, -1);
      await expect(page.locator('#drawer [data-drawer-fullscreen]')).toHaveAttribute('aria-pressed', 'false');
    });
  }

  test('mobile viewport keeps the drawer full width by default', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockApi(page);
    await page.goto(server.url(`${PROJECT}/index.html`));
    await openDrawer(page, ENTRIES[0]);
    expect(await drawerWidth(page)).toBeCloseTo(await viewportWidth(page), -1);
  });
});
