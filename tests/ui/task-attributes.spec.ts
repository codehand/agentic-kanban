/**
 * task-attributes.spec.ts — Playwright UI test for TASK-021.
 *
 * Verifies that the 5 task attributes (priority, complexity, estimate_hours,
 * tags, link_document) are present in the create form, displayed in the
 * detail drawer, and rendered as badges on board cards.
 *
 * Uses file:// protocol with window.__kanban_api mocks (no live server needed).
 * Screenshots are captured to docs/ui/TASK-021/.
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DS_DIR = path.resolve(__dirname, '../../design-system');
const OUT_DIR = path.resolve(__dirname, '../../docs/ui/TASK-021');

function pageUrl(file: string): string {
  return `file://${path.join(DS_DIR, file)}`;
}

// Mock task with all attributes set — used for board + drawer views
const MOCK_TASK = {
  id: 'task_attr_demo',
  key: 'TASK-ATTR-DEMO',
  title: 'Demonstrate task attributes',
  state: 'IN_PROGRESS',
  project: 'opf-hub',
  priority: 'P1',
  complexity: 'L',
  estimate_hours: 16,
  tags: ['feature', 'search', 'backend'],
  link_document: 'https://docs.example.com/search-spec',
  body_md: '## Purpose\nDemo task to show all 5 attributes.\n',
  created_at: '2026-06-10T10:00:00Z',
  updated_at: '2026-06-10T12:30:00Z',
};

/**
 * Inject mock __kanban_api via addInitScript so the board and drawer
 * render with mock data instead of hitting a real API server.
 */
async function injectMockApi(page: Page) {
  await page.addInitScript((task) => {
    // Set token so api.js won't redirect to signin
    localStorage.setItem('kanban_token', 'mock-human-token');
    // Override the api object once api.js sets it
    const origDescriptor = Object.getOwnPropertyDescriptor(window, '__kanban_api');
    let _api: any = null;
    Object.defineProperty(window, '__kanban_api', {
      get() { return _api; },
      set(v: any) {
        _api = v;
        // Replace methods with mocks
        if (v) {
          v.listProjects = () => Promise.resolve({ projects: [{ id: 'proj_1', slug: 'opf-hub', name: 'opf-hub' }] });
          v.listTasks = (_proj: string, _state?: string) => Promise.resolve({ tasks: [task] });
          v.getTask = (_proj: string, _key: string) => Promise.resolve({
            task,
            gitrefs: [{ repo: '.', branch: 'fix/TASK-021', mr_url: 'https://github.com/example/repo/pull/42' }],
            comments: [],
            evidence: [],
            timeline: [],
          });
          v.updateTask = (_proj: string, _key: string, patch: any) => Promise.resolve({ task: { ...task, ...patch } });
        }
      },
      configurable: true,
    });
  }, MOCK_TASK);
}

test.describe('TASK-021: Task Attributes UI', () => {
  test.beforeAll(() => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  });

  test('new-task form has all attribute fields with correct options', async ({ page }) => {
    await page.goto(pageUrl('new-task.html'));

    // Priority select with P0–P3 options
    const priority = page.locator('#field-priority');
    await expect(priority).toBeVisible();
    const prioOptions = await priority.locator('option').allTextContents();
    expect(prioOptions.some((t) => t.includes('P0'))).toBeTruthy();
    expect(prioOptions.some((t) => t.includes('P3'))).toBeTruthy();

    // Complexity select with XS–XL options
    const complexity = page.locator('#field-complexity');
    await expect(complexity).toBeVisible();
    const compOptions = await complexity.locator('option').allTextContents();
    expect(compOptions.some((t) => t.includes('XS'))).toBeTruthy();
    expect(compOptions.some((t) => t.includes('XL'))).toBeTruthy();

    // Estimate hours input (type=number, min=0)
    const estimate = page.locator('#field-estimate_hours');
    await expect(estimate).toBeVisible();
    await expect(estimate).toHaveAttribute('type', 'number');
    await expect(estimate).toHaveAttribute('min', '0');

    // Tags input
    await expect(page.locator('#field-tags')).toBeVisible();

    // Link document input (type=url)
    const linkDoc = page.locator('#field-link_document');
    await expect(linkDoc).toBeVisible();
    await expect(linkDoc).toHaveAttribute('type', 'url');

    // Fill values and verify they persist in the form
    await priority.selectOption('P1');
    await complexity.selectOption('M');
    await estimate.fill('8');
    await page.locator('#field-tags').fill('backend, api');
    await linkDoc.fill('https://docs.example.com/test');

    expect(await priority.inputValue()).toBe('P1');
    expect(await complexity.inputValue()).toBe('M');
    expect(await estimate.inputValue()).toBe('8');
    expect(await page.locator('#field-tags').inputValue()).toBe('backend, api');
    expect(await linkDoc.inputValue()).toBe('https://docs.example.com/test');

    await page.screenshot({ path: path.join(OUT_DIR, 'form-attributes.png'), fullPage: true });
  });

  test('board card renders priority badge and tags from task data', async ({ page }) => {
    await injectMockApi(page);
    await page.goto(pageUrl('index.html'));

    // Wait for the mock task card to appear on the board (rendered by loadBoard)
    await page.waitForFunction(
      () => document.body.innerHTML.includes('TASK-ATTR-DEMO'),
      { timeout: 15000 },
    );

    // Priority badge is rendered on the card
    await expect(page.locator('article span', { hasText: /^P1$/ }).first()).toBeVisible();

    // Tag badges are rendered on the card
    await expect(page.locator('article span', { hasText: /^feature$/ }).first()).toBeVisible();
    await expect(page.locator('article span', { hasText: /^search$/ }).first()).toBeVisible();

    await page.screenshot({ path: path.join(OUT_DIR, 'board-card-badges.png'), fullPage: true });
  });

  test('detail drawer shows all attributes with correct values', async ({ page }) => {
    await injectMockApi(page);
    await page.goto(pageUrl('index.html'));

    // Wait for board to render mock task
    await page.waitForFunction(
      () => document.body.innerHTML.includes('TASK-ATTR-DEMO'),
      { timeout: 15000 },
    );

    // Click the task card to open the drawer
    await page.locator('article', { hasText: 'TASK-ATTR-DEMO' }).first().click();

    // Wait for drawer to open and show the task title
    await page.waitForFunction(
      () => {
        const drawer = document.getElementById('drawer');
        return drawer && !drawer.classList.contains('translate-x-full')
          && (document.getElementById('drawer-title')?.textContent || '').includes('Demonstrate');
      },
      { timeout: 15000 },
    );

    // Verify attribute display section in drawer body
    const drawerBody = page.locator('#drawer-body');

    // Priority P1 badge displayed
    await expect(drawerBody.locator('span', { hasText: /^P1$/ }).first()).toBeVisible();

    // Complexity L displayed
    await expect(drawerBody.locator('span', { hasText: /^L$/ }).first()).toBeVisible();

    // Estimate 16h displayed
    await expect(drawerBody.locator('span', { hasText: /^16h$/ }).first()).toBeVisible();

    // Tags displayed
    await expect(drawerBody.locator('span', { hasText: /^feature$/ }).first()).toBeVisible();
    await expect(drawerBody.locator('span', { hasText: /^search$/ }).first()).toBeVisible();
    await expect(drawerBody.locator('span', { hasText: /^backend$/ }).first()).toBeVisible();

    // Link document link displayed
    await expect(drawerBody.locator('a[href="https://docs.example.com/search-spec"]').first()).toBeVisible();

    await page.screenshot({ path: path.join(OUT_DIR, 'detail-attributes-view.png'), fullPage: true });
  });

  test('detail drawer edit form has attribute fields with current values populated', async ({ page }) => {
    await injectMockApi(page);
    await page.goto(pageUrl('index.html'));

    // Wait for board to render mock task
    await page.waitForFunction(
      () => document.body.innerHTML.includes('TASK-ATTR-DEMO'),
      { timeout: 15000 },
    );

    // Click card to open drawer
    await page.locator('article', { hasText: 'TASK-ATTR-DEMO' }).first().click();

    // Wait for drawer to open
    await page.waitForFunction(
      () => {
        const drawer = document.getElementById('drawer');
        return drawer && !drawer.classList.contains('translate-x-full')
          && (document.getElementById('drawer-title')?.textContent || '').includes('Demonstrate');
      },
      { timeout: 15000 },
    );

    // Click the Edit button to toggle to edit mode
    const editBtn = page.locator('#btn-edit-attrs');
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    // Wait for edit form to appear (attrs-edit loses .hidden)
    await page.waitForFunction(
      () => {
        const editEl = document.getElementById('attrs-edit');
        return editEl && !editEl.classList.contains('hidden');
      },
      { timeout: 5000 },
    );

    // Verify all 5 edit fields are present
    await expect(page.locator('#edit-priority')).toBeVisible();
    await expect(page.locator('#edit-complexity')).toBeVisible();
    await expect(page.locator('#edit-estimate_hours')).toBeVisible();
    await expect(page.locator('#edit-tags')).toBeVisible();
    await expect(page.locator('#edit-link_document')).toBeVisible();

    // Verify current values are populated
    expect(await page.locator('#edit-priority').inputValue()).toBe('P1');
    expect(await page.locator('#edit-complexity').inputValue()).toBe('L');
    expect(await page.locator('#edit-estimate_hours').inputValue()).toBe('16');
    expect(await page.locator('#edit-tags').inputValue()).toBe('feature, search, backend');
    expect(await page.locator('#edit-link_document').inputValue()).toBe('https://docs.example.com/search-spec');

    await page.screenshot({ path: path.join(OUT_DIR, 'detail-drawer-priority-tags.png'), fullPage: true });
  });
});
