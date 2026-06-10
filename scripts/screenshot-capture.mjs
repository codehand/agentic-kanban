/**
 * screenshot-capture.mjs — Take REAL screenshots of the New Task flow.
 * Run against a live dev server (ADMIN_TOKEN=test-human-token PORT=3456).
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../docs/ui/TASK-019');
const BASE = 'http://127.0.0.1:3456';
const TOKEN = 'test-human-token';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Inject token
  await page.addInitScript((tok) => {
    localStorage.setItem('kanban_token', tok);
  }, TOKEN);

  // 1. Board with New Task CTA visible
  await page.goto(`${BASE}/index.html`);
  await page.waitForSelector('#btn-new-task', { timeout: 10000 });
  await page.screenshot({ path: `${OUT_DIR}/cta-new-task.png`, fullPage: false });
  console.log('Captured cta-new-task.png');

  // 2. Navigate to new-task.html, fill form, screenshot
  await page.goto(`${BASE}/new-task.html`);
  await page.waitForSelector('#new-task-form', { timeout: 10000 });
  // Clear and fill title
  await page.locator('#field-title').fill('');
  await page.locator('#field-title').fill('Capture real screenshots for TASK-019');
  // Clear and fill description
  await page.locator('#field-description').fill('## Purpose\nProve real screenshots are captured.\n\n## Scope\nRun Playwright against live server.\n\n## AC\n- [ ] Real PNG files\n- [ ] Distinct images');
  // Wait a moment for rendering
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT_DIR}/form-filled.png`, fullPage: false });
  console.log('Captured form-filled.png');

  // 3. Submit form — the real POST will go through
  // Intercept to make sure key doesn't collide
  const taskKey = 'TASK-' + Date.now().toString(36).toUpperCase();
  await page.evaluate((key) => {
    // Override the auto-generated key
    window.__taskKeyOverride = key;
  }, taskKey);

  // Click create
  await page.locator('#btn-create-task').click();

  // Wait for redirect to index.html with ?created= param
  try {
    await page.waitForURL(/index\.html\?created=/, { timeout: 15000 });
    console.log('Redirected to board with ?created= param');
  } catch (e) {
    console.log('Redirect wait failed, current URL:', page.url());
  }

  // Wait for the toast to appear
  try {
    await page.waitForSelector('.fixed.bottom-4', { timeout: 5000 });
    await page.screenshot({ path: `${OUT_DIR}/task-created-board.png`, fullPage: false });
    console.log('Captured task-created-board.png');
  } catch (e) {
    // Even if toast selector doesn't match exactly, take screenshot of current state
    await page.screenshot({ path: `${OUT_DIR}/task-created-board.png`, fullPage: false });
    console.log('Captured task-created-board.png (no toast matched, but screenshot taken)');
  }

  await browser.close();
  console.log('Done');
}

main().catch((err) => { console.error(err); process.exit(1); });
