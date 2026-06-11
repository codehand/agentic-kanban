/**
 * Playwright spec — TASK-020: take before/after screenshots of the bottom-right corner.
 *
 * "before" — injects the prototype screen-switcher (the code that was removed)
 *            via page.evaluate so the floating "Screens" button is visible.
 * "after"  — loads the page as-is (switcher removed) and captures the same area.
 *
 * Run:
 *   npx playwright test tests/ui/take-screenshots.spec.ts
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startDsServer, seedToken, type DsServer } from './ds-server';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_DIR = path.resolve(__dirname, '../../docs/ui/TASK-020');

let server: DsServer;

function pageUrl(file: string): string {
  return server.url(file);
}

// The switcher code that was removed in TASK-020 (recreates the "before" state).
// Uses inline styles (no CSS classes) so it renders independently of the
// app's stylesheet.
const SWITCHER_INJECT = `
(function () {
  var body = document.body;
  var screens = [
    ['index.html', 'squares-four', 'S1 Board + S2 Detail'],
    ['projects.html', 'folders', 'S3 Projects Overview'],
    ['new-task.html', 'plus-circle', 'S4 Create Task'],
    ['tokens.html', 'key', 'S7 Token Management'],
  ];
  var here = location.pathname.split('/').pop() || 'index.html';
  var sw = document.createElement('div');
  sw.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:80;';
  sw.innerHTML = '<div id="sw-panel" style="margin-bottom:8px;width:240px;border-radius:12px;border:1px solid #374151;background:#1f2937;padding:6px;box-shadow:0 25px 50px -12px rgba(0,0,0,.5)">' +
    '<p style="padding:2px 8px 6px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af">Prototype screens</p>' +
    screens.map(function(e) {
      var on = e[0] === here;
      return '<a href="' + e[0] + '" style="display:flex;align-items:center;gap:8px;border-radius:6px;padding:4px 8px;font-size:13px;' +
        (on ? 'background:rgba(30,58,138,.3);color:white' : 'color:#9ca3af') +
        '"><i class="ph ph-' + e[1] + '" style="font-size:15px' + (on ? ';color:#60a5fa' : '') + '"></i> ' + e[2] + '</a>';
    }).join('') +
    '</div>' +
    '<button id="sw-btn" style="margin-left:auto;display:flex;align-items:center;gap:6px;border-radius:9999px;border:1px solid #374151;background:#1f2937;padding:0 14px;height:40px;font-size:13px;color:white;box-shadow:0 20px 25px -5px rgba(0,0,0,.2)">' +
    '<i class="ph ph-stack" style="font-size:16px;color:#60a5fa"></i> Screens</button>';
  body.appendChild(sw);
})();
`;

test.describe('TASK-020: take before/after screenshots', () => {
  // Clip a 260x180 area of the bottom-right corner (large enough to show the button + context)
  const clip = { x: 1180, y: 720, width: 260, height: 180 };

  test.beforeAll(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    server = await startDsServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  test.beforeEach(async ({ page }) => {
    // Fake token so the board's auto API call doesn't bounce to signin.html.
    await seedToken(page.context());
  });

  test('before: bottom-right corner WITH switcher', async ({ page }) => {
    await page.goto(pageUrl('index.html'));
    await page.waitForTimeout(800);

    // Inject the switcher to recreate the "before removal" state
    await page.evaluate(SWITCHER_INJECT);
    await page.waitForSelector('#sw-btn', { timeout: 5000 });

    await page.screenshot({
      path: path.join(OUT_DIR, 'before-remove-switcher.png'),
      clip,
    });

    // Sanity: the switcher is actually there
    await expect(page.locator('#sw-btn')).toHaveCount(1);
  });

  test('after: bottom-right corner WITHOUT switcher', async ({ page }) => {
    await page.goto(pageUrl('index.html'));
    await page.waitForTimeout(800);

    await page.screenshot({
      path: path.join(OUT_DIR, 'after-remove-switcher.png'),
      clip,
    });

    // Sanity: the switcher is NOT there
    await expect(page.locator('#sw-btn')).toHaveCount(0);
  });
});
