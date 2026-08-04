/**
 * board-columns.spec.ts — column visibility menu on the board.
 *
 * The strip's three-dot button (next to the "live" chip) opens a checkbox list
 * of the six board columns. Done is unchecked on load, so the board opens
 * without the Done column; checking it reveals the column (cards included).
 *
 * Mocked mode only: ds-server serves design-system/ and /api/projects +
 * /api/tasks are routed, so the board renders one task per column.
 */
import { test, expect, type Page } from '@playwright/test';
import { startDsServer, seedToken, type DsServer } from './ds-server';

const PROJECT = 'opf-hub';
const TASKS = [
  { key: 'T-1', title: 'backlog task', state: 'TODO' },
  { key: 'T-2', title: 'in progress task', state: 'IN_PROGRESS' },
  { key: 'T-3', title: 'evidence task', state: 'EVIDENCE' },
  { key: 'T-4', title: 'verdict task', state: 'JUDGE_REJECTED' },
  { key: 'T-5', title: 'awaiting human task', state: 'JUDGE_PASSED' },
  { key: 'T-6', title: 'done task', state: 'DONE' },
];

function column(page: Page, col: string) {
  return page.locator(`[data-col="${col}"]`);
}

async function openBoard(page: Page, server: DsServer): Promise<void> {
  await seedToken(page);
  await page.route('**/api/projects', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ projects: [{ id: 'p1', slug: PROJECT, name: PROJECT }] }),
    }),
  );
  await page.route('**/api/tasks?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tasks: TASKS.map((t) => ({ ...t, updated_at: new Date().toISOString() })),
      }),
    }),
  );
  await page.goto(server.url('index.html'));
  await expect(page.locator('#board-columns')).toBeVisible({ timeout: 10000 });
}

test.describe('Board column visibility menu', () => {
  let server: DsServer;

  test.beforeEach(async () => {
    server = await startDsServer();
  });
  test.afterEach(async () => {
    await server.close();
  });

  test('Done column is hidden by default; the other five are visible', async ({ page }) => {
    await openBoard(page, server);

    for (const col of ['todo', 'in_progress', 'evidence', 'verdict', 'human']) {
      await expect(column(page, col)).toBeVisible();
    }
    await expect(column(page, 'done')).toBeHidden();
    // The card exists in the DOM but is not shown — it is the column that hides.
    await expect(page.locator('#col-done')).toContainText('T-6');
    await expect(page.getByText('done task')).toBeHidden();
    // Counts still render behind the hidden column.
    await expect(page.locator('#count-done')).toHaveText('1');
  });

  test('the three-dot menu toggles columns, including revealing Done', async ({ page }) => {
    await openBoard(page, server);

    const menuBtn = page.getByRole('button', { name: /show or hide columns/i });
    const menu = page.locator('#columns-menu');
    const doneBox = menu.locator('[data-col-toggle="done"]');
    const todoBox = menu.locator('[data-col-toggle="todo"]');

    await expect(menu).toBeHidden();
    await expect(menuBtn).toHaveAttribute('aria-expanded', 'false');

    await menuBtn.click();
    await expect(menu).toBeVisible();
    await expect(menuBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(doneBox).not.toBeChecked();
    await expect(todoBox).toBeChecked();

    // Reveal Done.
    await doneBox.check();
    await expect(column(page, 'done')).toBeVisible();
    await expect(page.getByText('done task')).toBeVisible();

    // Hide a column that starts visible.
    await todoBox.uncheck();
    await expect(column(page, 'todo')).toBeHidden();

    // Escape closes the menu and leaves the choices in place.
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(menuBtn).toHaveAttribute('aria-expanded', 'false');
    await expect(column(page, 'done')).toBeVisible();
    await expect(column(page, 'todo')).toBeHidden();

    // Clicking outside closes it too.
    await menuBtn.click();
    await expect(menu).toBeVisible();
    await page.locator('#board-strip-info').click();
    await expect(menu).toBeHidden();
  });

  test('a live refetch keeps the chosen columns (strip re-render does not reset them)', async ({
    page,
  }) => {
    await openBoard(page, server);

    await page.getByRole('button', { name: /show or hide columns/i }).click();
    await page.locator('#columns-menu [data-col-toggle="done"]').check();
    await page.keyboard.press('Escape');
    await expect(column(page, 'done')).toBeVisible();

    // loadBoard() rewrites the strip summary and the columns' cards.
    await page.evaluate(() => (window as unknown as { loadBoard(): void }).loadBoard());
    await expect(page.locator('#board-strip-info')).toContainText('awaiting you');

    await expect(column(page, 'done')).toBeVisible();
    await expect(page.getByRole('button', { name: /show or hide columns/i })).toBeVisible();
  });
});
