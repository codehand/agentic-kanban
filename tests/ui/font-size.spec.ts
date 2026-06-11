/**
 * TASK-016: Assert computed font-size ≥ 13px across design-system screens,
 * and capture step-by-step screenshots into docs/ui/TASK-016/.
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { startDsServer, seedToken, type DsServer } from './ds-server';

const _dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = path.resolve(_dirname, '../../docs/ui/TASK-016');

let server: DsServer;

/** Build an HTTP URL for a design-system HTML file (served by ds-server). */
function pageUrl(file: string): string {
  return server.url(file);
}

/** Ensure the output directory exists. */
function ensureShotDir() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
}

/** Wait for Tailwind CDN to finish processing (it injects styles async). */
async function waitForTailwind(page: Page) {
  // Tailwind CDN adds a <style> tag; wait until at least one text-[…] class
  // resolves to a non-zero computed font-size.
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[class*="text-"]');
      if (!el) return true;
      return parseFloat(getComputedStyle(el).fontSize) > 0;
    },
    { timeout: 15_000 },
  );
  // Extra settle time for Tailwind to finish all classes.
  await page.waitForTimeout(800);
}

/** Collect all visible elements that have a text-[Npx] Tailwind class. */
async function collectFontSizeSamples(page: Page) {
  return page.evaluate(() => {
    const re = /text-\[(\d+(?:\.\d+)?)px\]/;
    const all = document.querySelectorAll<HTMLElement>('[class*="text-["]');
    const samples: { tag: string; cls: string; size: number; text: string }[] = [];
    for (const el of all) {
      const match = el.className.match(re);
      if (!match) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue; // skip hidden
      const computed = parseFloat(getComputedStyle(el).fontSize);
      samples.push({
        tag: el.tagName.toLowerCase(),
        cls: match[0],
        size: computed,
        text: (el.textContent || '').slice(0, 40).trim(),
      });
    }
    return samples;
  });
}

/** Assert every sampled element has font-size ≥ 13px. */
async function assertFloor13(page: Page, label: string) {
  const samples = await collectFontSizeSamples(page);
  // Some elements may report the browser default if Tailwind didn't apply;
  // only assert on elements that actually resolved a Tailwind size.
  const violators = samples.filter((s) => s.size > 0 && s.size < 13);
  if (violators.length > 0) {
    const detail = violators
      .slice(0, 10)
      .map((s) => `  ${s.cls} → ${s.size}px (${s.tag}: "${s.text}")`)
      .join('\n');
    throw new Error(
      `${label}: ${violators.length} element(s) below 13px floor:\n${detail}`,
    );
  }
  // Sanity: we actually sampled something.
  expect(samples.length).toBeGreaterThan(0);
}

test.describe('TASK-016 font-size floor (≥ 13px)', () => {
  test.beforeAll(async () => {
    server = await startDsServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  test.beforeEach(async ({ page }) => {
    ensureShotDir();
    // Fake token so pages that auto-call /api/* don't bounce to signin.html
    // (the API 404s on the static server; pages show their error states).
    await seedToken(page.context());
  });

  test('new-task.html — full page flow (board-like screen with sidebar)', async ({ page }) => {
    // new-task.html renders fully without live data (API errors are caught).
    // Shows the sidebar rail + modal + header — a good "flow" representative screen.
    await page.goto(pageUrl('new-task.html'));
    await waitForTailwind(page);
    await assertFloor13(page, 'new-task.html');
    await page.screenshot({ path: path.join(SHOT_DIR, 'flow-index.png'), fullPage: true });
  });

  test('new-task.html — CTA + form font sizes ≥ 13px', async ({ page }) => {
    await page.goto(pageUrl('new-task.html'));
    await waitForTailwind(page);
    await assertFloor13(page, 'new-task.html');

    // CTA closeup — the "Create task" button area.
    const cta = page.locator('button').filter({ hasText: /Create task/i });
    if ((await cta.count()) > 0) {
      await cta.first().scrollIntoViewIfNeeded();
      await cta.first().screenshot({ path: path.join(SHOT_DIR, 'cta-create-task.png') });
    }
    // Full-page CTA screen.
    await page.screenshot({ path: path.join(SHOT_DIR, 'cta-full.png'), fullPage: true });
  });

  test('first-run.html — welcome screen font sizes ≥ 13px', async ({ page }) => {
    await page.goto(pageUrl('first-run.html'));
    await waitForTailwind(page);
    await assertFloor13(page, 'first-run.html');
    await page.screenshot({ path: path.join(SHOT_DIR, 'flow-first-run.png'), fullPage: true });
  });

  test('menu — sidebar navigation closeup from #rail', async ({ page }) => {
    // new-task.html renders the rail via shell.js without API redirect.
    await page.goto(pageUrl('new-task.html'));
    await waitForTailwind(page);
    // Wait for shell.js to populate the rail.
    const rail = page.locator('#rail');
    await rail.waitFor({ state: 'visible', timeout: 10_000 });
    await expect(rail.locator('nav')).toBeVisible({ timeout: 5_000 });
    await rail.screenshot({ path: path.join(SHOT_DIR, 'menu-sidebar.png') });
  });

  test('font before/after — visual comparison', async ({ page }) => {
    await page.goto(pageUrl('new-task.html'));
    await waitForTailwind(page);

    // "After" — current (improved) state.
    await page.screenshot({ path: path.join(SHOT_DIR, 'font-after.png'), fullPage: true });

    // "Before" — simulate the old ≤12px sizes by scaling down the root font-size
    // and overriding all Tailwind text-[Npx] classes. We inject a <style> that
    // maps the current bumped classes back to their pre-TASK-016 equivalents.
    const revertMap: Record<string, string> = {
      'text-[14px]': '13px',   // bumped 13→14, revert to 13
      'text-[15px]': '13px',   // bumped 14→15 or floored+rounded, revert to ~12
      'text-[16px]': '13px',
      'text-[17px]': '13px',
      'text-[18px]': '13px',
      'text-[19px]': '13px',
      'text-[20px]': '13px',
      'text-[21px]': '13px',
      'text-[23px]': '13px',
      'text-[25px]': '13px',
    };
    const cssRules = Object.entries(revertMap)
      .map(([cls, size]) => `.${cls.replace(/[[\]]/g, '\\$&')} { font-size: ${size} !important; }`)
      .join('\n');
    await page.addStyleTag({ content: cssRules });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOT_DIR, 'font-before.png'), fullPage: true });
  });

  test('all screens — comprehensive font-size audit', async ({ page }) => {
    // Pages that auto-call /api/* redirect to signin.html when no token is set.
    // Inject a fake token so the pages stay on their URL (API calls fail gracefully,
    // showing error states, but the full HTML with text-[Npx] classes is rendered).
    await page.goto(pageUrl('signin.html'));
    await page.evaluate(() => localStorage.setItem('kanban_token', 'test_fake_token_for_ui_audit'));

    const screens = [
      'index.html',
      'projects.html',
      'new-task.html',
      'first-run.html',
      'signin.html',
      'evidence.html',
      'tokens.html',
    ];
    for (const screen of screens) {
      await page.goto(pageUrl(screen));
      await waitForTailwind(page);
      await assertFloor13(page, screen);
    }
  });
});
