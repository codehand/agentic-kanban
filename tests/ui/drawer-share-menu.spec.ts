/**
 * drawer-share-menu.spec.ts — Playwright spec for TASK-077.
 *
 * The board drawer (index.html) and the Tasks drawer (/<project>/tasks.html)
 * get the same three-dots menu (Share + Remove) and Share dialog as the
 * full-screen task page, from the shared design-system/share-dialog.js.
 * Every case runs against BOTH drawers:
 *   (1) the menu holds exactly Share + Remove (no standalone trash button);
 *       keyboard Enter/arrows/Esc; click outside closes; Remove dismissed ->
 *       no POST and focus back on the trigger; Remove accepted -> exactly one
 *       POST, the card/row disappears and the drawer closes. The trigger is
 *       hidden while the drawer is still loading (no item visible), and a
 *       DONE task keeps Share only.
 *   (2) Share opens the dialog ON TOP of the drawer, default 5m, URL starts
 *       with location.origin + '/s/', and the POST carries {token, ttl} for
 *       the drawer's task.
 *   (3) served from 127.0.0.1 the localhost warning shows and nothing calls
 *       /api/share-origin; served from a non-loopback host name the warning
 *       is hidden and the link uses that host.
 *   (4) copy disabled before Share; after Share the dialog stays open with an
 *       Active status, TTL + Share disabled, copy enabled + focused; clicking
 *       copy puts the URL on the clipboard, flips the icon to ph-check and
 *       shows the "Link copied." toast.
 *   (5) Close / Esc return focus to the three-dots trigger; Esc over the
 *       drawer closes only the dialog (the drawer stays open).
 *
 * Non-loopback host: Chromium's --host-resolver-rules maps SHARE_HOST to
 * 127.0.0.1, so the page really loads from http://share-host.test:<port> and
 * location.hostname / location.origin are genuinely that host (no stubbing
 * of `location`). The flag is browser-wide, hence the file-level test.use.
 *
 * Serves design-system/ via the ds-server harness and mocks /api/* with a
 * stateful page.route that records every request (same pattern as
 * task-remove.spec.ts / task-share.spec.ts).
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { startDsServer, seedToken, type DsServer } from './ds-server';

const SHARE_HOST = 'share-host.test';
test.use({ launchOptions: { args: [`--host-resolver-rules=MAP ${SHARE_HOST} 127.0.0.1`] } });

const PROJECT = 'opf-hub';
const KEY = 'TASK-077D';
const TITLE = 'Drawer share menu task';
const TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/;

interface Call {
  method: string;
  path: string;
  project: string | null;
  body: Record<string, unknown> | null;
}

interface Mock {
  calls: Call[];
  state: string;
  removed: boolean;
  /** When set, task-detail GETs wait for it (drawer stays in its loading state). */
  detailGate: Promise<void> | null;
}

interface Drawer {
  name: string;
  path: string;
  /** The board card / Tasks row that opens the drawer. */
  item(page: Page): ReturnType<Page['locator']>;
}

const DRAWERS: Drawer[] = [
  { name: 'board', path: 'index.html', item: (page) => page.locator('#col-todo article').filter({ hasText: KEY }) },
  { name: 'Tasks', path: `${PROJECT}/tasks.html`, item: (page) => page.locator('#tasks-tbody tr').filter({ hasText: KEY }) },
];

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockApi(page: Page, state = 'TODO'): Promise<Mock> {
  const m: Mock = { calls: [], state, removed: false, detailGate: null };
  const task = () => ({ key: KEY, title: TITLE, state: m.state, updated_at: new Date().toISOString() });
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      let body: Record<string, unknown> | null = null;
      try { body = req.postData() ? (JSON.parse(req.postData() as string) as Record<string, unknown>) : null; } catch { body = null; }
      m.calls.push({ method: req.method(), path: url.pathname, project: url.searchParams.get('project'), body });

      if (url.pathname === '/api/stream') {
        return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: 'retry: 600000\n\nevent: connected\ndata: {}\n\n' });
      }
      if (url.pathname === '/api/projects') return json(route, 200, { projects: [{ id: 'p1', slug: PROJECT, name: PROJECT }] });
      if (url.pathname === '/api/tasks') return json(route, 200, { tasks: m.removed ? [] : [task()] });
      if (url.pathname === `/api/tasks/${KEY}`) {
        if (m.detailGate) await m.detailGate;
        if (m.removed) return json(route, 404, { error: `Task not found: ${KEY}` });
        return json(route, 200, { task: { ...task(), body_md: 'Spec body.' }, gitrefs: [], evidence: null, timeline: [], comments: [] });
      }
      if (url.pathname === `/api/tasks/${KEY}/remove`) {
        m.removed = true;
        return json(route, 200, { removed: true, key: KEY });
      }
      if (url.pathname === `/api/tasks/${KEY}/shares`) {
        const ttl = body?.ttl as number | null;
        return json(route, 201, { expires_at: ttl === null ? null : new Date(Date.now() + ttl * 1000).toISOString() });
      }
      return json(route, 404, { error: 'unmocked' });
    },
  );
  return m;
}

/** Open the page (on `base`), click the card/row, wait for the loaded drawer. */
async function openDrawer(page: Page, d: Drawer, base: string): Promise<void> {
  await page.goto(`${base}/${d.path}`);
  const item = d.item(page);
  await expect(item).toBeVisible({ timeout: 15000 });
  await item.click();
  await expect(page.locator('#drawer')).not.toHaveClass(/translate-x-full/, { timeout: 5000 });
  await expect(page.locator('#drawer-title')).toHaveText(TITLE);
}

const drawerOpen = (page: Page) => expect(page.locator('#drawer')).not.toHaveClass(/translate-x-full/);
const sharePosts = (m: Mock) => m.calls.filter((c) => c.method === 'POST' && c.path === `/api/tasks/${KEY}/shares`);
const removePosts = (m: Mock) => m.calls.filter((c) => c.method === 'POST' && c.path === `/api/tasks/${KEY}/remove`);
const shareOriginCalls = (m: Mock) => m.calls.filter((c) => c.path === '/api/share-origin');

for (const d of DRAWERS) {
  test.describe(`TASK-077: ${d.name} drawer three-dots menu + share dialog`, () => {
    let server: DsServer;

    test.beforeAll(async () => { server = await startDsServer(); });
    test.afterAll(async () => { await server.close(); });
    test.beforeEach(async ({ context }) => { await seedToken(context); });

    test('(1) menu = Share + Remove; keyboard + click-outside; Remove dismiss -> no POST, accept -> 1 POST, item gone, drawer closed', async ({ page }) => {
      const m = await mockApi(page);
      await openDrawer(page, d, server.baseUrl);

      // No standalone trash button: the only trash icon is the menu's Remove item.
      await expect(page.locator('i.ph-trash')).toHaveCount(1);
      await expect(page.locator('#more-menu [role="menuitem"] i.ph-trash')).toHaveCount(1);
      await expect(page.locator('i.ph-trash')).toBeHidden();

      const more = page.locator('#drawer #btn-more');
      await expect(more).toBeVisible();
      await expect(more.locator('i')).toHaveClass(/\bph-dots-three\b/);
      await expect(more).toHaveAttribute('aria-haspopup', 'menu');
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      await more.click();
      await expect(more).toHaveAttribute('aria-expanded', 'true');
      const menu = page.getByRole('menu', { name: 'Task actions' });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitem')).toHaveText(['Share', 'Remove']);

      // Click outside (inside the drawer) closes the menu, not the drawer.
      await page.locator('#drawer-title').click();
      await expect(menu).toBeHidden();
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      await drawerOpen(page);

      // Keyboard: Enter opens + focuses Share, arrows move, Esc closes the menu only.
      await more.focus();
      await page.keyboard.press('Enter');
      await expect(menu).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Share' })).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('menuitem', { name: 'Remove' })).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('menuitem', { name: 'Share' })).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await expect(page.getByRole('menuitem', { name: 'Remove' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(more).toBeFocused();
      await drawerOpen(page);

      // Remove, guard dismissed: no POST, drawer stays, focus back on the trigger.
      const messages: string[] = [];
      page.once('dialog', (dlg) => { messages.push(dlg.message()); void dlg.dismiss(); });
      await more.click();
      await page.getByRole('menuitem', { name: 'Remove' }).click();
      await expect.poll(() => messages.length).toBe(1);
      expect(messages[0]).toContain(KEY);
      await page.waitForTimeout(1000); // longer than the 800ms close-drawer window
      expect(removePosts(m)).toHaveLength(0);
      await expect(menu).toBeHidden();
      await expect(more).toBeFocused();
      await drawerOpen(page);
      await expect(d.item(page)).toBeVisible();

      // Remove, guard accepted: exactly one POST for this task, item gone, drawer closed.
      page.once('dialog', (dlg) => void dlg.accept());
      await more.click();
      await page.getByRole('menuitem', { name: 'Remove' }).click();
      await expect(d.item(page)).toBeHidden({ timeout: 10000 });
      await expect(page.locator('#drawer')).toHaveClass(/translate-x-full/, { timeout: 5000 });
      expect(removePosts(m)).toHaveLength(1);
      expect(removePosts(m)[0]!.project).toBe(PROJECT);
    });

    test('(1b) trigger hidden while the drawer loads; DONE keeps Share and gates Remove away', async ({ page }) => {
      // The card/row is listed as TODO (the board hides its Done column by
      // default); the task detail then answers DONE.
      const m = await mockApi(page, 'TODO');
      let release!: () => void;
      m.detailGate = new Promise<void>((r) => { release = r; });
      await page.goto(`${server.baseUrl}/${d.path}`);
      await expect(d.item(page)).toBeVisible({ timeout: 15000 });
      await d.item(page).click();
      await drawerOpen(page);
      // Loading: every menu item is hidden, so the trigger is too.
      await expect(page.locator('#drawer-title')).toHaveText('Loading…');
      await expect(page.locator('#btn-more')).toBeHidden();
      m.state = 'DONE';
      release();
      await expect(page.locator('#drawer-title')).toHaveText(TITLE);
      await expect(page.locator('#drawer-state-badge')).toContainText('DONE');
      await expect(page.locator('#btn-more')).toBeVisible();
      await page.locator('#btn-more').click();
      await expect(page.getByRole('menu', { name: 'Task actions' }).getByRole('menuitem')).toHaveText(['Share']);
      await expect(page.locator('#btn-remove')).toBeHidden();
    });

    test('(2)(3)(4)(5) Share: dialog above the drawer, 5m, location.origin URL, POST {token, ttl}, copy, focus + Esc layering', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const m = await mockApi(page);
      await openDrawer(page, d, server.baseUrl);
      const more = page.locator('#btn-more');
      await more.click();
      await page.getByRole('menuitem', { name: 'Share' }).click();

      // (2) The dialog is visible and sits on top of the open drawer.
      const share = page.locator('#share');
      await expect(share).toBeVisible();
      await drawerOpen(page);
      const onTop = await page.evaluate(() => {
        const panel = document.querySelector('#share [role="dialog"]')!.getBoundingClientRect();
        const hit = document.elementFromPoint(panel.left + panel.width / 2, panel.top + 12);
        const z = (id: string) => Number(getComputedStyle(document.getElementById(id)!).zIndex);
        return { hitInShare: !!hit && document.getElementById('share')!.contains(hit), share: z('share'), drawer: z('drawer') };
      });
      expect(onTop.hitInShare).toBe(true);
      expect(onTop.share).toBeGreaterThan(onTop.drawer);
      await expect(page.locator('#share-title')).toHaveText(`Share ${KEY}`);
      await expect(page.getByRole('radio', { name: '5m', exact: true })).toBeChecked();
      await expect(page.getByRole('radio', { name: '5m', exact: true })).toBeFocused();
      const origin = await page.evaluate(() => location.origin);
      const url = await page.locator('#share-url').inputValue();
      expect(url.startsWith(origin + '/s/')).toBe(true);
      const token = new URL(url).pathname.replace(/^\/s\//, '');
      expect(token).toMatch(TOKEN_RE);

      // (3) Served from 127.0.0.1: localhost warning, and no LAN lookup at all.
      expect(new URL(origin).hostname).toBe('127.0.0.1');
      await expect(page.locator('#share-local-warning')).toBeVisible();
      await expect(page.locator('#share-local-warning')).toContainText('You opened this page via localhost');
      expect(shareOriginCalls(m)).toHaveLength(0);

      // (4) Copy disabled until the link is activated.
      const copy = page.locator('#share-copy');
      await expect(copy).toBeDisabled();
      await expect(copy).toHaveAttribute('aria-label', 'Copy link');

      // (2) Share POSTs {token, ttl} for the drawer's task.
      await page.locator('#share-submit').click();
      await expect(page.locator('#share-status')).toContainText(/^Active until .+/);
      expect(sharePosts(m)).toHaveLength(1);
      expect(sharePosts(m)[0]!.project).toBe(PROJECT);
      expect(sharePosts(m)[0]!.body).toEqual({ token, ttl: 300 });

      // (4) Dialog stays open; TTL + Share locked; copy enabled and focused.
      await expect(share).toBeVisible();
      for (const r of await page.locator('#share input[name="share-ttl"]').all()) await expect(r).toBeDisabled();
      await expect(page.locator('#share-submit')).toBeDisabled();
      await expect(copy).toBeEnabled();
      await expect(copy).toBeFocused();
      await expect(page.locator('#share-cancel')).toHaveText('Close');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url); // auto-copied

      await page.evaluate(() => navigator.clipboard.writeText(''));
      await copy.click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
      await expect(copy.locator('i')).toHaveClass(/\bph-check\b/);
      await expect(page.locator('#toast-msg')).toHaveText('Link copied.');

      // (5) Close -> focus back on the trigger; drawer still open.
      await page.locator('#share-cancel').click();
      await expect(share).toBeHidden();
      await expect(more).toBeFocused();
      await drawerOpen(page);

      // (5) Esc over the drawer closes only the dialog; a second Esc closes the drawer.
      await more.click();
      await page.getByRole('menuitem', { name: 'Share' }).click();
      await expect(share).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(share).toBeHidden();
      await expect(more).toBeFocused();
      await drawerOpen(page);
      await page.keyboard.press('Escape');
      await expect(page.locator('#drawer')).toHaveClass(/translate-x-full/);

      expect(sharePosts(m)).toHaveLength(1); // the re-opened dialog was never activated
      expect(shareOriginCalls(m)).toHaveLength(0);
    });

    test('(3b) non-loopback host: no localhost warning, link on that host', async ({ page }) => {
      const m = await mockApi(page);
      const port = new URL(server.baseUrl).port;
      await openDrawer(page, d, `http://${SHARE_HOST}:${port}`);
      expect(await page.evaluate(() => location.hostname)).toBe(SHARE_HOST);
      await page.locator('#btn-more').click();
      await page.getByRole('menuitem', { name: 'Share' }).click();
      await expect(page.locator('#share')).toBeVisible();
      await expect(page.locator('#share-url')).toHaveValue(new RegExp(`^http://${SHARE_HOST.replace(/\./g, '\\.')}:${port}/s/[A-Za-z0-9_-]{22,64}$`));
      await expect(page.locator('#share-local-warning')).toBeHidden();
      expect(shareOriginCalls(m)).toHaveLength(0);
    });
  });
}
