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
import { startDsServer, seedToken, type DsServer } from './ds-server';

let server: DsServer;

function pageUrl(file: string): string {
  return server.url(file);
}

test.describe('TASK-020: Screens switcher removed', () => {
  const pages = ['index.html', 'projects.html', 'tokens.html'];

  test.beforeAll(async () => {
    server = await startDsServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  for (const page of pages) {
    test(`${page} should not have #sw-btn or Screens button`, async ({ page: p }) => {
      // Fake token so the pages' auto API calls don't bounce to signin.html.
      await seedToken(p.context());
      await p.goto(pageUrl(page));
      // Assert #sw-btn does not exist
      await expect(p.locator('#sw-btn')).toHaveCount(0);
      // Assert no element with text "Screens" (the switcher button label)
      await expect(p.getByRole('button', { name: /Screens/i })).toHaveCount(0);
    });
  }
});
