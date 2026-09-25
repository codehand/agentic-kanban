/**
 * task-share.spec.ts — Playwright spec for TASK-076 (read-only share links).
 *
 * Owner side (design-system/task.html at /<project>/t/<KEY>):
 *   (1) the three-dots #btn-more menu shows exactly Share + Remove; Remove in
 *       the menu runs the guarded flow (accept -> POST remove, dismiss -> none);
 *       keyboard: Enter opens, arrows move, Esc closes and refocuses #btn-more.
 *   (2) the Share dialog: default 5m, all 5 TTL options, a NEW /s/<token> URL
 *       (never the detail URL), LAN origin (mocked) used when opened via a
 *       loopback host, and Share POSTs exactly {token, ttl} for the chosen ttl.
 * Viewer side (design-system/share.html at /s/<token>):
 *   (3) no kanban_token, no signin redirect, task content rendered, every CTA
 *       and every rail link disabled / non-navigating, and no /api/* request
 *       other than GET /api/share/<token>.
 *   (4) API 404 -> denied message ("Contact your admin"), no task content.
 *   (5) page open when expires_at passes (page.clock) -> denied, content gone.
 *
 * Serves design-system/ via the ds-server harness (production static routing)
 * and mocks /api/* with page.route, recording every call (same pattern as
 * task-page.spec.ts / task-remove.spec.ts).
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startDsServer, seedToken, type DsServer } from './ds-server';

const PROJECT = 'opf-hub';
const KEY = 'TASK-076A';
const TITLE = 'Shareable task';
const DEP = 'TASK-076DEP';
const LAN = 'http://192.168.77.5:3000';
const SHARE_TOKEN = 'AbCdEfGhIjKlMnOpQrStUv_-0123456789';
const TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/;
const DENIED = "This link has expired or you don't have permission to view it. Contact your admin.";

interface Call {
  method: string;
  path: string;
  project: string | null;
  body: Record<string, unknown> | null;
  auth: string | undefined;
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function taskJson(state: string): Record<string, unknown> {
  return {
    key: KEY,
    title: TITLE,
    state,
    updated_at: new Date().toISOString(),
    body_md: '## Purpose\nShared spec with **bold** text.',
    depends_on: [DEP],
    priority: 'P1',
    tags: ['share'],
    pr_url: 'https://example.com/pr/76',
  };
}

function detailPayload(state: string): Record<string, unknown> {
  return {
    task: taskJson(state),
    gitrefs: [{ repo: '.', branch: 'fix/TASK-076-task-share-link', head_sha: 'abcdef1234567', mr_url: 'https://example.com/mr/76' }],
    evidence: { build_exit: 0, test_exit: 0 },
    timeline: [{ actor_role: 'judge', from_state: 'SELF_CHECK_PASSED', to_state: 'JUDGE_PASSED', at: new Date().toISOString(), note: 'VERDICT: PASS' }],
    comments: [{ author_role: 'judge', kind: 'verdict', verdict: 'PASS', body_md: 'Shared comment body.', created_at: new Date().toISOString() }],
  };
}

interface OwnerMock {
  calls: Call[];
  removed: boolean;
  shareStatus: number;
}

/** Owner-page /api/* mock (bearer present): detail, remove, share-origin, shares. */
async function mockOwnerApi(page: Page, state = 'JUDGE_PASSED'): Promise<OwnerMock> {
  const m: OwnerMock = { calls: [], removed: false, shareStatus: 201 };
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      let body: Record<string, unknown> | null = null;
      try { body = req.postData() ? (JSON.parse(req.postData() as string) as Record<string, unknown>) : null; } catch { body = null; }
      m.calls.push({ method: req.method(), path: url.pathname, project: url.searchParams.get('project'), body, auth: req.headers()['authorization'] });

      if (url.pathname === '/api/stream') {
        return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: 'retry: 600000\n\nevent: connected\ndata: {}\n\n' });
      }
      if (url.pathname === '/api/projects') return json(route, 200, { projects: [{ id: 'p1', slug: PROJECT, name: PROJECT }] });
      if (url.pathname === '/api/tasks') return json(route, 200, { tasks: m.removed ? [] : [taskJson(state)] });
      if (url.pathname === '/api/share-origin') return json(route, 200, { origin: LAN });
      if (url.pathname === `/api/tasks/${KEY}`) {
        if (m.removed) return json(route, 404, { error: `Task not found: ${KEY}` });
        return json(route, 200, detailPayload(state));
      }
      if (url.pathname === `/api/tasks/${KEY}/remove`) {
        m.removed = true;
        return json(route, 200, { removed: true, key: KEY });
      }
      if (url.pathname === `/api/tasks/${KEY}/shares`) {
        if (m.shareStatus !== 201) return json(route, m.shareStatus, { error: 'Share token already exists' });
        const ttl = body?.ttl as number | null;
        return json(route, 201, { expires_at: ttl === null ? null : new Date(Date.now() + ttl * 1000).toISOString() });
      }
      return json(route, 404, { error: 'unmocked' });
    },
  );
  return m;
}

async function openOwnerPage(page: Page, server: DsServer): Promise<void> {
  await page.goto(server.url(`${PROJECT}/t/${KEY}`));
  await expect(page.locator('#task-detail')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#task-title')).toHaveText(TITLE);
}

async function openShareDialog(page: Page): Promise<void> {
  await page.locator('#btn-more').click();
  await page.getByRole('menuitem', { name: 'Share' }).click();
  await expect(page.locator('#share')).toBeVisible();
}

/** Viewer-page mock: records EVERY /api/* request; only /api/share/<token> answers. */
async function mockViewerApi(page: Page, share: { status: number; body?: unknown }): Promise<string[]> {
  const seen: string[] = [];
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.pathname.startsWith('/api/')) seen.push(`${req.method()} ${u.pathname}`);
  });
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === `/api/share/${SHARE_TOKEN}`) {
        expect(route.request().headers()['authorization'], 'share fetch must not send a bearer').toBeUndefined();
        return json(route, share.status, share.body ?? { error: 'Not found' });
      }
      return json(route, 500, { error: 'viewer must not call this' });
    },
  );
  return seen;
}

function sharePayload(expiresAt: string | null): Record<string, unknown> {
  return { ...detailPayload('JUDGE_PASSED'), project: PROJECT, expires_at: expiresAt };
}

test.describe('TASK-076: share link (owner: menu + dialog)', () => {
  let server: DsServer;

  test.beforeAll(async () => { server = await startDsServer(); });
  test.afterAll(async () => { await server.close(); });
  test.beforeEach(async ({ context }) => { await seedToken(context); });

  test('(1) three-dots menu shows Share + Remove; Remove runs the guarded flow', async ({ page }) => {
    const m = await mockOwnerApi(page, 'IN_PROGRESS');
    await openOwnerPage(page, server);

    // No standalone trash button: every trash icon sits inside the menu.
    const trash = page.locator('i.ph-trash');
    await expect(trash).toHaveCount(1);
    await expect(page.locator('#more-menu i.ph-trash')).toHaveCount(1);
    await expect(trash).toBeHidden();

    const more = page.locator('#btn-more');
    await expect(more).toHaveAttribute('aria-haspopup', 'menu');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    const menu = page.getByRole('menu', { name: 'Task actions' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText(['Share', 'Remove']);

    // Click outside closes.
    await page.locator('#task-title').click();
    await expect(menu).toBeHidden();

    // Keyboard: Enter opens + focuses Share, ArrowDown -> Remove, Esc closes and refocuses #btn-more.
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Share' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Remove' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(more).toBeFocused();

    // Dismiss the guard: no POST.
    page.once('dialog', (d) => { expect(d.message()).toContain(KEY); void d.dismiss(); });
    await more.click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    await page.waitForTimeout(300);
    expect(m.calls.filter((c) => c.path === `/api/tasks/${KEY}/remove`)).toHaveLength(0);
    await expect(page.locator('#task-detail')).toBeVisible();
    await expect(menu).toBeHidden();
    await expect(more).toBeFocused(); // focus back on the trigger, not <body>

    // Same dismiss path driven by the keyboard: Enter, ArrowDown, Enter.
    page.once('dialog', (d) => void d.dismiss());
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Share' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    expect(m.calls.filter((c) => c.path === `/api/tasks/${KEY}/remove`)).toHaveLength(0);
    await expect(menu).toBeHidden();
    await expect(more).toBeFocused();

    // Accept the guard: exactly one POST, back to the board.
    page.once('dialog', (d) => void d.accept());
    await more.click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    await page.waitForURL(`**/${PROJECT}/index.html`);
    const removes = m.calls.filter((c) => c.method === 'POST' && c.path === `/api/tasks/${KEY}/remove`);
    expect(removes).toHaveLength(1);
    expect(removes[0]!.project).toBe(PROJECT);
  });

  test('(1b) DONE task: menu keeps Share, Remove is gated away', async ({ page }) => {
    await mockOwnerApi(page, 'DONE');
    await openOwnerPage(page, server);
    await page.locator('#btn-more').click();
    await expect(page.getByRole('menuitem', { name: 'Share' })).toBeVisible();
    await expect(page.locator('#btn-remove')).toBeHidden();
  });

  test('(2) share dialog: 5 TTLs (default 5m), fresh /s/<token> URL on the LAN origin, POST {token, ttl}', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const m = await mockOwnerApi(page);
    await openOwnerPage(page, server);
    await openShareDialog(page);

    await expect(page.locator('#share-title')).toHaveText(`Share ${KEY}`);
    const radios = page.locator('#share input[name="share-ttl"]');
    await expect(radios).toHaveCount(5);
    await expect(page.locator('#share-ttl label')).toHaveText(['5m', '15m', '1h', '24h', 'Forever']);
    await expect(page.getByRole('radio', { name: '5m', exact: true })).toBeChecked();
    await expect(page.getByRole('radio', { name: '5m', exact: true })).toBeFocused();

    // Served from 127.0.0.1 -> the (mocked) LAN origin replaces location.origin.
    const urlBox = page.locator('#share-url');
    await expect(urlBox).toHaveAttribute('readonly', '');
    await expect(urlBox).toHaveValue(new RegExp(`^${LAN.replace(/[.]/g, '\\.')}/s/`));
    expect(m.calls.filter((c) => c.path === '/api/share-origin')).toHaveLength(1);
    const first = await urlBox.inputValue();
    const u1 = new URL(first);
    const token1 = u1.pathname.replace(/^\/s\//, '');
    expect(u1.pathname).toMatch(/^\/s\/[^/]+$/);
    expect(token1).toMatch(TOKEN_RE);
    expect(first).not.toContain(`/t/${KEY}`);
    expect(first).not.toBe(page.url());

    // Changing TTL keeps the token; the link is not active until Share.
    await page.getByText('1h', { exact: true }).click();
    await expect(page.getByRole('radio', { name: '1h', exact: true })).toBeChecked();
    await expect(urlBox).toHaveValue(first);
    expect(m.calls.filter((c) => c.path === `/api/tasks/${KEY}/shares`)).toHaveLength(0);

    await page.locator('#share-submit').click();
    await expect(page.locator('#share')).toBeHidden();
    await expect(page.locator('#toast-msg')).toContainText('Share link active until');
    let posts = m.calls.filter((c) => c.method === 'POST' && c.path === `/api/tasks/${KEY}/shares`);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.project).toBe(PROJECT);
    expect(posts[0]!.body).toEqual({ token: token1, ttl: 3600 });
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first);
    await expect(page.locator('#btn-more')).toBeFocused(); // focus returns after close

    // Re-open: new token, TTL back to 5m; Forever posts ttl null.
    await openShareDialog(page);
    await expect(page.getByRole('radio', { name: '5m', exact: true })).toBeChecked();
    const second = await urlBox.inputValue();
    expect(second).not.toBe(first);
    const token2 = new URL(second).pathname.replace(/^\/s\//, '');
    expect(token2).toMatch(TOKEN_RE);
    await page.getByText('Forever', { exact: true }).click();
    await page.locator('#share-submit').click();
    await expect(page.locator('#toast-msg')).toContainText('never expires');
    posts = m.calls.filter((c) => c.method === 'POST' && c.path === `/api/tasks/${KEY}/shares`);
    expect(posts[1]!.body).toEqual({ token: token2, ttl: null });

    // Default 5m posts 300; a failed activation shows an error and keeps the dialog.
    m.shareStatus = 409;
    await openShareDialog(page);
    const third = new URL(await urlBox.inputValue()).pathname.replace(/^\/s\//, '');
    await page.locator('#share-submit').focus();
    await page.keyboard.press('Enter'); // keyboard activation: the button disables while pending
    await expect(page.locator('#toast-msg')).toContainText('Share failed');
    await expect(page.locator('#share')).toBeVisible();
    // Focus must come back inside the open aria-modal dialog, and Tab stays trapped there.
    await expect(page.locator('#share-submit')).toBeEnabled();
    await expect(page.locator('#share-submit')).toBeFocused();
    const focusInShare = () => page.evaluate(() => document.getElementById('share')!.contains(document.activeElement));
    await page.keyboard.press('Tab');
    expect(await focusInShare()).toBe(true);
    await page.keyboard.press('Shift+Tab');
    expect(await focusInShare()).toBe(true);
    posts = m.calls.filter((c) => c.method === 'POST' && c.path === `/api/tasks/${KEY}/shares`);
    expect(posts[2]!.body).toEqual({ token: third, ttl: 300 });

    // Esc closes the dialog and returns focus to #btn-more.
    await page.keyboard.press('Escape');
    await expect(page.locator('#share')).toBeHidden();
    await expect(page.locator('#btn-more')).toBeFocused();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`share dialog + menu have no axe WCAG A/AA violations (${theme})`, async ({ page }) => {
      await page.addInitScript((t: string) => localStorage.setItem('ak-theme', t), theme);
      await mockOwnerApi(page);
      await openOwnerPage(page, server);
      await page.locator('#btn-more').click();
      await expect(page.locator('#more-menu')).toBeVisible();
      let results = await new AxeBuilder({ page }).include('#more-menu').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(results.violations.map((v) => v.id), `menu/${theme}`).toEqual([]);
      await page.getByRole('menuitem', { name: 'Share' }).click();
      await expect(page.locator('#share-url')).toHaveValue(/\/s\//);
      results = await new AxeBuilder({ page }).include('#share').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(results.violations.map((v) => v.id), `dialog/${theme}`).toEqual([]);
    });
  }
});

test.describe('TASK-076: share link (viewer at /s/<token>)', () => {
  let server: DsServer;

  test.beforeAll(async () => { server = await startDsServer(); });
  test.afterAll(async () => { await server.close(); });

  test('(3) read-only view: no token, no signin, content shown, every CTA + rail disabled, only /api/share called', async ({ page }) => {
    const expires = new Date(Date.now() + 3600_000).toISOString();
    const seen = await mockViewerApi(page, { status: 200, body: sharePayload(expires) });
    const res = await page.goto(server.url(`s/${SHARE_TOKEN}`));
    expect(res?.status()).toBe(200);
    expect(await page.evaluate(() => localStorage.getItem('kanban_token'))).toBeNull();

    await expect(page.locator('#task-detail')).toBeVisible({ timeout: 15000 });
    expect(new URL(page.url()).pathname).toBe(`/s/${SHARE_TOKEN}`); // no signin redirect
    await expect(page.locator('#task-key')).toHaveText(KEY);
    await expect(page.locator('#task-title')).toHaveText(TITLE);
    await expect(page.locator('#task-project')).toHaveText(PROJECT);
    await expect(page.locator('#share-banner')).toContainText('Read-only');
    await expect(page.locator('#share-banner')).toContainText('Expires');
    const body = page.locator('#task-body');
    for (const h of ['Attributes', 'Spec', 'Depends on', 'Repos & MR', 'Evidence', 'Timeline', 'Comments']) {
      await expect(body.getByRole('heading', { name: h })).toBeVisible();
    }
    await expect(body.locator('strong', { hasText: 'bold' })).toBeVisible();
    await expect(body.locator('[data-comments]')).toContainText('Shared comment body.');

    // CTAs: approve/reject shown by state gating but disabled; no three-dots/remove.
    for (const id of ['#btn-approve', '#btn-reject']) {
      await expect(page.locator(id)).toBeVisible();
      await expect(page.locator(id)).toBeDisabled();
      await expect(page.locator(id)).toHaveAttribute('aria-disabled', 'true');
    }
    await expect(page.locator('#btn-reset')).toBeDisabled();
    await expect(page.locator('#btn-more')).toHaveCount(0);
    await expect(page.locator('#btn-remove')).toHaveCount(0);
    await expect(page.locator('#btn-edit-attrs')).toBeDisabled();
    await expect(page.locator('#comment-input')).toBeDisabled();
    await expect(page.locator('#comment-submit')).toBeDisabled();

    // Internal links are dead: depends-on, view evidence, topbar Board.
    for (const loc of [
      body.locator('a', { hasText: DEP }),
      body.locator('a', { hasText: 'View full evidence' }),
      page.locator('#back-to-board'),
    ]) {
      await expect(loc).toHaveAttribute('aria-disabled', 'true');
      await expect(loc).not.toHaveAttribute('href', /./);
    }
    // External PR/MR links stay normal links.
    await expect(body.locator('a', { hasText: 'PR/MR link' })).toHaveAttribute('href', 'https://example.com/mr/76');
    await expect(body.locator('a', { hasText: 'Open PR' })).toHaveAttribute('href', 'https://example.com/pr/76');

    // Whole rail: every link dead, every button disabled.
    const railLinks = page.locator('#rail a');
    expect(await railLinks.count()).toBeGreaterThanOrEqual(6);
    for (const a of await railLinks.all()) {
      await expect(a).toHaveAttribute('aria-disabled', 'true');
      await expect(a).not.toHaveAttribute('href', /./);
    }
    const railButtons = page.locator('#rail button');
    expect(await railButtons.count()).toBeGreaterThanOrEqual(1);
    for (const b of await railButtons.all()) await expect(b).toBeDisabled();
    await expect(page.locator('#project-switcher-label')).toHaveText(PROJECT);

    // Clicking a rail link / Board / depends-on navigates nowhere.
    const before = page.url();
    await page.locator('#rail nav a').first().click({ force: true });
    await page.locator('#back-to-board').click({ force: true });
    await body.locator('a', { hasText: DEP }).click({ force: true });
    await page.waitForTimeout(300);
    expect(page.url()).toBe(before);
    await expect(page.locator('#project-menu')).toBeHidden();

    // Theme toggle still works (local display only).
    const wasDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    await page.locator('#theme-toggle').click();
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(!wasDark);

    expect([...new Set(seen)]).toEqual([`GET /api/share/${SHARE_TOKEN}`]);
  });

  test('(3b) even with a kanban_token stored, the viewer calls nothing but /api/share', async ({ page, context }) => {
    await seedToken(context, 'owner-token');
    const seen = await mockViewerApi(page, { status: 200, body: sharePayload(null) });
    await page.goto(server.url(`s/${SHARE_TOKEN}`));
    await expect(page.locator('#task-detail')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#share-banner')).toContainText('Never expires');
    await page.waitForTimeout(500);
    expect([...new Set(seen)]).toEqual([`GET /api/share/${SHARE_TOKEN}`]);
  });

  test('(3c) task data is escaped on the share page (no attribute breakout)', async ({ page }) => {
    const payload = sharePayload(null) as { task: Record<string, unknown> };
    payload.task.title = '<img src=x onerror="window.__pwned=1">';
    payload.task.tags = ['x" onmouseover="window.__pwned=1'];
    payload.task.link_document = 'https://example.com/"autofocus onfocus="window.__pwned=1';
    await mockViewerApi(page, { status: 200, body: payload });
    await page.goto(server.url(`s/${SHARE_TOKEN}`));
    await expect(page.locator('#task-detail')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#task-title')).toHaveText('<img src=x onerror="window.__pwned=1">');
    await page.locator('#task-body a', { hasText: 'example.com' }).hover();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(await page.locator('[onmouseover], [onfocus], [onerror]').count()).toBe(0);
  });

  test('(4) API 404 -> denied message, no task content', async ({ page }) => {
    const seen = await mockViewerApi(page, { status: 404 });
    await page.goto(server.url(`s/${SHARE_TOKEN}`));
    const denied = page.locator('#share-denied');
    await expect(denied).toBeVisible({ timeout: 15000 });
    await expect(denied).toContainText('Contact your admin');
    await expect(page.locator('#share-denied-msg')).toHaveText(DENIED);
    await expect(page.locator('#task-detail')).toHaveCount(0);
    await expect(page.locator('#task-loading')).toBeHidden();
    await expect(page.getByText(TITLE)).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(`/s/${SHARE_TOKEN}`);
    expect([...new Set(seen)]).toEqual([`GET /api/share/${SHARE_TOKEN}`]);
  });

  test('(5) page open when expires_at passes -> switches to denied and drops the content', async ({ page }) => {
    const t0 = new Date('2026-09-25T10:00:00Z');
    await page.clock.install({ time: t0 });
    const expires = new Date(t0.getTime() + 5 * 60_000).toISOString();
    await mockViewerApi(page, { status: 200, body: sharePayload(expires) });
    await page.goto(server.url(`s/${SHARE_TOKEN}`));
    await expect(page.locator('#task-detail')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#task-title')).toHaveText(TITLE);

    // Not yet: 4 minutes in, still readable.
    await page.clock.fastForward('04:00');
    await expect(page.locator('#task-detail')).toBeVisible();

    // Past expires_at: denied, and the task content is gone from the DOM.
    await page.clock.fastForward('01:05');
    await expect(page.locator('#share-denied')).toBeVisible();
    await expect(page.locator('#share-denied')).toContainText('Contact your admin');
    await expect(page.locator('#task-detail')).toHaveCount(0);
    await expect(page.getByText(TITLE)).toHaveCount(0);
    expect(await page.content()).not.toContain('Shared comment body.');
  });
});
