#!/usr/bin/env node
/**
 * Take screenshots for TASK-018 — light, dark, CTA close-up.
 * Usage: node scripts/take-screenshots.cjs
 *
 * Uses first-run.html (static, no API dependency) to avoid the
 * auth redirect in api.js.  Sets a fake kanban_token via
 * addInitScript so the board page can also load its shell.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUT = path.resolve(__dirname, '../docs/ui/TASK-018');
const DIR = path.resolve(__dirname, '../design-system');
const INDEX = 'file://' + path.join(DIR, 'index.html');
const FIRST_RUN = 'file://' + path.join(DIR, 'first-run.html');

async function screenshotPage(browser, url, { theme, filename }) {
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('  PAGE ERROR:', err.message));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('dark', t === 'dark');
    try { localStorage.setItem('ak-theme', t); } catch (_) {}
  }, theme);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, filename), fullPage: false });
  console.log('  -> ' + filename);
  await page.close();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // --- Dark screenshot ---
  await screenshotPage(browser, FIRST_RUN, { theme: 'dark', filename: 'dark-theme.png' });

  // --- Light screenshot ---
  await screenshotPage(browser, FIRST_RUN, { theme: 'light', filename: 'light-theme.png' });

  // --- CTA close-up from the board page ---
  // Set a fake token so api.js doesn't redirect to signin.html.
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  context.addInitScript(() => {
    try { localStorage.setItem('kanban_token', 'fake-token-for-screenshot'); } catch (_) {}
    try { localStorage.setItem('ak-theme', 'dark'); } catch (_) {}
  });
  const page = await context.newPage();
  page.on('pageerror', err => console.log('  PAGE ERROR:', err.message));
  await page.goto(INDEX, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);
  // Force dark class.
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
    try { localStorage.setItem('ak-theme', 'dark'); } catch (_) {}
  });
  await page.waitForTimeout(500);

  const btn = page.locator('#theme-toggle');
  if (await btn.count() > 0) {
    await btn.screenshot({ path: path.join(OUT, 'cta-toggle-closeup.png') });
    console.log('  -> cta-toggle-closeup.png');
  } else {
    // Crop the top-right corner where the CTA lives.
    await page.screenshot({
      path: path.join(OUT, 'cta-toggle-closeup.png'),
      clip: { x: 1200, y: 0, width: 240, height: 56 },
    });
    console.log('  -> cta-toggle-closeup.png (clip fallback)');
  }
  await page.close();
  await browser.close();
  console.log('Done. Screenshots in', OUT);
}

main().catch((err) => { console.error(err); process.exit(1); });
