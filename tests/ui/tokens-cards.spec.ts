/**
 * tokens-cards.spec.ts — Playwright spec for TASK-041.
 *
 * Unlike the mocked specs, these tests run the REAL server (createHttpServer
 * with an in-memory DB): real bearer auth, the real last_used_at touch in
 * resolveBearer, and the real DELETE /api/tokens/:id with its 409 guards.
 * The server also serves design-system/ statically, so the page under test
 * is the production page wired to the production API.
 *
 * Covered:
 *   1. The tokens page renders a card grid — no <table>, no max-w-[920px] cap.
 *   2. No horizontal page overflow at a 375px viewport.
 *   3. Status semantics from last_used_at:
 *      - freshly minted token  → "never used"
 *      - after an API call authenticated with that token + reload → "live"
 *      - token last used 2 days ago → "last seen 2d ago" (idle)
 *      - revoked token → "revoked" (takes precedence)
 *   4. Revoke flow: card button → confirm dialog (names role + label) →
 *      card flips to revoked WITHOUT a full page reload; cancel sends nothing.
 *   5. Revoking the last active human token: the server's 409 error is
 *      surfaced visibly in the dialog and the card stays active.
 */
import { test, expect, type Page } from '@playwright/test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { openMemoryDb, type Db } from '../../server/src/db/connection';
import { runMigrations } from '../../server/src/db/migrate';
import { createHttpServer } from '../../server/src/http/server';
import { mintToken } from '../../server/src/auth/mint';
import { revokeToken } from '../../server/src/db/repositories/token';

interface App {
  db: Db;
  server: Server;
  base: string;
  human: { tokenId: string; secret: string };
  fresh: { tokenId: string; secret: string };  // implementer, never used
  idle: { tokenId: string; secret: string };   // judge, last used 2 days ago
  retired: { tokenId: string; secret: string }; // runner, revoked
}

/** Format a Date the way the server does: %Y-%m-%dT%H:%M:%SZ. */
function isoSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function startApp(): Promise<App> {
  const db = openMemoryDb();
  runMigrations(db);

  const human = mintToken(db, 'human', 'op-root');
  const fresh = mintToken(db, 'implementer', 'fresh-agent');
  const idle = mintToken(db, 'judge', 'old-judge');
  const retired = mintToken(db, 'runner', 'retired-runner');

  // Backdate the judge 2 days so it renders as idle ("last seen 2d ago").
  db.prepare(`UPDATE token SET last_used_at = ? WHERE id = ?`).run(
    isoSeconds(new Date(Date.now() - 2 * 86400 * 1000)),
    idle.tokenId,
  );
  revokeToken(db, retired.tokenId);

  const server = createHttpServer(db);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { db, server, base: `http://127.0.0.1:${port}`, human, fresh, idle, retired };
}

function closeApp(app: App): Promise<void> {
  return new Promise<void>((resolve) => {
    app.server.closeAllConnections(); // drop SSE/keep-alive so close() returns
    app.server.close(() => resolve());
  });
}

/** Sign in as the human operator and open the tokens page. */
async function openTokensPage(page: Page, app: App): Promise<void> {
  await page.addInitScript((tok: string) => {
    localStorage.setItem('kanban_token', tok);
  }, app.human.secret);
  await page.goto(`${app.base}/tokens.html`);
  // Cards rendered from the real GET /api/tokens.
  await expect(page.locator('#tokens-grid > li[data-token-id]')).toHaveCount(4, { timeout: 10000 });
}

function card(page: Page, tokenId: string) {
  return page.locator(`#tokens-grid > li[data-token-id="${tokenId}"]`);
}

/** Marker that survives only while the page does NOT fully reload. */
async function setNoReloadMarker(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __pwNoReload?: boolean }).__pwNoReload = true;
  });
}
function hasNoReloadMarker(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (window as unknown as { __pwNoReload?: boolean }).__pwNoReload === true,
  );
}

test.describe('TASK-041: tokens page — card grid + live status + revoke', () => {
  let app: App;

  test.beforeEach(async () => {
    app = await startApp();
  });
  test.afterEach(async () => {
    await closeApp(app);
  });

  test('renders a full-width card grid — no <table>, no max-w-[920px] cap', async ({ page }) => {
    await openTokensPage(page, app);

    await expect(page.locator('table')).toHaveCount(0);
    await expect(page.locator('[class*="max-w-[920px]"]')).toHaveCount(0);

    const display = await page
      .locator('#tokens-grid')
      .evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe('grid');
  });

  test('no horizontal page overflow at 375px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openTokensPage(page, app);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      overflow.scrollWidth,
      `page must not overflow horizontally (scrollWidth ${overflow.scrollWidth} vs clientWidth ${overflow.clientWidth})`,
    ).toBeLessThanOrEqual(overflow.clientWidth);

    // Cards stack to one usable column and stay visible.
    await expect(card(page, app.fresh.tokenId)).toBeVisible();
  });

  test('status: never used → live after real authenticated use; idle + revoked render honestly', async ({ page }) => {
    await openTokensPage(page, app);

    // Freshly minted, never authenticated → "never used".
    await expect(card(page, app.fresh.tokenId).locator('[data-status="never"]')).toHaveText('never used');

    // The page itself just authenticated with the human token → live (dot + text).
    await expect(card(page, app.human.tokenId).locator('[data-status="live"]')).toHaveText('live');

    // Last used 2 days ago → idle with relative time.
    await expect(card(page, app.idle.tokenId).locator('[data-status="idle"]')).toHaveText('last seen 2d ago');

    // Revoked → "revoked", and no Revoke button on that card.
    await expect(card(page, app.retired.tokenId).locator('[data-status="revoked"]')).toContainText('revoked');
    await expect(card(page, app.retired.tokenId).locator('[data-revoke-id]')).toHaveCount(0);

    // Real authenticated request with the fresh token (server-side touch)…
    const res = await fetch(`${app.base}/api/tokens`, {
      headers: { Authorization: `Bearer ${app.fresh.secret}` },
    });
    expect(res.status).toBe(200);

    // …then reload: the card now reports live (within the 5 min window).
    await page.reload();
    await expect(card(page, app.fresh.tokenId).locator('[data-status="live"]')).toHaveText('live', { timeout: 10000 });
  });

  test('revoke flow: confirm dialog names role+label, card flips to revoked without reload; cancel is a no-op', async ({ page }) => {
    await openTokensPage(page, app);
    await setNoReloadMarker(page);

    const judgeCard = card(page, app.idle.tokenId);
    const dialog = page.locator('#revoke-confirm');

    // Cancel path first: nothing happens.
    await judgeCard.locator('[data-revoke-id]').click();
    await expect(dialog).toBeVisible();
    await expect(page.locator('#revoke-title')).toHaveText('Revoke judge "old-judge"?');
    await page.locator('#revoke-cancel').click();
    await expect(dialog).toBeHidden();
    await expect(judgeCard.locator('[data-status="idle"]')).toBeVisible();

    // Happy path: confirm → real DELETE /api/tokens/:id → card flips in place.
    await judgeCard.locator('[data-revoke-id]').click();
    await expect(dialog).toBeVisible();
    await page.locator('#revoke-do').click();
    await expect(dialog).toBeHidden();
    await expect(judgeCard.locator('[data-status="revoked"]')).toContainText('revoked');
    await expect(judgeCard.locator('[data-revoke-id]')).toHaveCount(0);

    // No full page reload happened.
    expect(await hasNoReloadMarker(page)).toBe(true);

    // The real server state changed: the row is revoked (and a repeat revoke
    // over HTTP now answers 409 "already revoked").
    const repeat = await fetch(`${app.base}/api/tokens/${app.idle.tokenId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${app.human.secret}` },
    });
    expect(repeat.status).toBe(409);
  });

  test('revoking the last active human token surfaces the 409 visibly and the card stays active', async ({ page }) => {
    await openTokensPage(page, app);
    await setNoReloadMarker(page);

    const humanCard = card(page, app.human.tokenId);
    await humanCard.locator('[data-revoke-id]').click();
    await expect(page.locator('#revoke-confirm')).toBeVisible();
    await expect(page.locator('#revoke-title')).toHaveText('Revoke human "op-root"?');
    await page.locator('#revoke-do').click();

    // The server answers 409 (lockout guard) — shown visibly, not silently.
    const err = page.locator('#revoke-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText(/last active human token/i);

    // Dialog stays open for the operator to read; closing it leaves the card active.
    await page.locator('#revoke-cancel').click();
    await expect(page.locator('#revoke-confirm')).toBeHidden();
    await expect(humanCard.locator('[data-status="live"]')).toBeVisible();
    await expect(humanCard.locator('[data-revoke-id]')).toHaveCount(1);
    expect(await hasNoReloadMarker(page)).toBe(true);

    // And the operator is not locked out: the bearer still authenticates.
    const check = await fetch(`${app.base}/api/tokens`, {
      headers: { Authorization: `Bearer ${app.human.secret}` },
    });
    expect(check.status).toBe(200);
  });
});
