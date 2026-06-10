/**
 * Playwright spec — TASK-020: assert the prototype Screens switcher is gone.
 *
 * Verifies:
 *  - #sw-btn does not exist on any design-system page.
 *  - No button with the accessible name "Screens" exists.
 *
 * Run:
 *   npx playwright test tests/ui/remove-screens.spec.ts
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DS_DIR = path.resolve(__dirname, '../../design-system');

function pageUrl(file: string): string {
  return `file://${path.join(DS_DIR, file)}`;
}

test.describe('TASK-020: Screens switcher removed', () => {
  const pages = ['index.html', 'projects.html', 'tokens.html'];

  for (const page of pages) {
    test(`${page} should not have #sw-btn or Screens button`, async ({ page: p }) => {
      await p.goto(pageUrl(page));
      // Assert #sw-btn does not exist
      await expect(p.locator('#sw-btn')).toHaveCount(0);
      // Assert no element with text "Screens" (the switcher button label)
      await expect(p.getByRole('button', { name: /Screens/i })).toHaveCount(0);
    });
  }
});
