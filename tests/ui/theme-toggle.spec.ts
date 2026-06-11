/**
 * Playwright spec — TASK-018: CTA toggle theme light/dark.
 *
 * Verifies:
 *  - Clicking the CTA toggles `dark` class on <html>.
 *  - Computed background-color changes between two distinct values.
 *  - Theme choice persists across page reloads (localStorage).
 *
 * Run:
 *   npx playwright test tests/ui/theme-toggle.spec.ts
 */
import { test, expect } from '@playwright/test';
import { startDsServer, seedToken, type DsServer } from './ds-server';

test.describe('Theme toggle CTA', () => {
  let server: DsServer;

  test.beforeAll(async () => {
    server = await startDsServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  test.beforeEach(async ({ page }) => {
    // Each test gets a fresh browser context, so there is no prior 'ak-theme'
    // preference — every test starts from the OS default. (An init script that
    // removed the key on every document load would also wipe it on reload and
    // break the persistence test.)
    // Fake token so the board's auto API call doesn't bounce to signin.html.
    await seedToken(page.context());
  });

  test('CTA toggles dark class and background-color', async ({ page }) => {
    await page.goto(server.url('index.html'));
    // Wait for the theme script to apply the initial class.
    await page.waitForFunction(() => document.querySelector('#theme-toggle') != null);

    const html = page.locator('html');
    const toggleBtn = page.locator('#theme-toggle');

    // Capture the initial background-color.
    const bgBefore = await html.evaluate((el) => getComputedStyle(el).backgroundColor);

    // Click toggle.
    await toggleBtn.click();

    // The `dark` class should have flipped.
    const hasDarkAfter = await html.evaluate((el) => el.classList.contains('dark'));
    // background-color should have changed.
    const bgAfter = await html.evaluate((el) => getComputedStyle(el).backgroundColor);

    // We don't hard-code which mode we start in (depends on OS), but the two must differ.
    expect(bgBefore).not.toBe(bgAfter);

    // Click again — should revert.
    await toggleBtn.click();
    const bgRevert = await html.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bgRevert).toBe(bgBefore);
  });

  test('theme persists across reload via localStorage', async ({ page }) => {
    await page.goto(server.url('index.html'));
    await page.waitForFunction(() => document.querySelector('#theme-toggle') != null);

    const html = page.locator('html');
    const toggleBtn = page.locator('#theme-toggle');

    // Click to toggle once — whatever direction, just capture the state.
    await toggleBtn.click();
    const darkAfterClick = await html.evaluate((el) => el.classList.contains('dark'));

    // Reload — the theme should be the same as before reload.
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#theme-toggle') != null);
    const darkAfterReload = await html.evaluate((el) => el.classList.contains('dark'));

    expect(darkAfterReload).toBe(darkAfterClick);

    // Also verify localStorage holds the expected key.
    const stored = await page.evaluate(() => {
      try { return localStorage.getItem('ak-theme'); } catch (_) { return null; }
    });
    expect(stored).toBe(darkAfterReload ? 'dark' : 'light');
  });

  test('icon reflects current theme state', async ({ page }) => {
    await page.goto(server.url('index.html'));
    await page.waitForFunction(() => document.querySelector('#theme-toggle') != null);

    const icon = page.locator('#theme-toggle i');

    // When dark → moon icon; when light → sun icon.
    const html = page.locator('html');
    const isDark = await html.evaluate((el) => el.classList.contains('dark'));
    const cls = await icon.getAttribute('class') || '';

    if (isDark) {
      expect(cls).toContain('ph-moon');
    } else {
      expect(cls).toContain('ph-sun');
    }

    // Toggle — icon should flip.
    await page.locator('#theme-toggle').click();
    const clsAfter = await icon.getAttribute('class') || '';
    if (isDark) {
      expect(clsAfter).toContain('ph-sun');
    } else {
      expect(clsAfter).toContain('ph-moon');
    }
  });

  test('first run follows OS: light OS → no dark class', async ({ browser }) => {
    // Emulate light color scheme at context level so it applies before any script runs.
    const context = await browser.newContext({ colorScheme: 'light' });
    const page = await context.newPage();
    // Ensure no stored preference.
    await page.addInitScript(() => {
      try { localStorage.removeItem('ak-theme'); } catch (_) { /* noop */ }
    });
    await seedToken(context);

    await page.goto(server.url('index.html'));
    await page.waitForFunction(() => document.documentElement != null);

    const hasDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(hasDark).toBe(false);

    await context.close();
  });

  test('first run follows OS: dark OS → dark class', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    await page.addInitScript(() => {
      try { localStorage.removeItem('ak-theme'); } catch (_) { /* noop */ }
    });
    await seedToken(context);

    await page.goto(server.url('index.html'));
    await page.waitForFunction(() => document.documentElement != null);

    const hasDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(hasDark).toBe(true);

    await context.close();
  });
});
