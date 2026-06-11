/**
 * live-update.spec.ts — Playwright E2E test for TASK-017.
 *
 * Verifies that creating a task via the API causes the board UI to
 * soft-refetch (new card appears) and a toast to be shown — without
 * a full page reload.
 *
 * Modes:
 *   - Default (no env): serves design-system/ over HTTP via the ds-server
 *     harness (ephemeral port). /api/projects and /api/tasks are mocked with
 *     page.route, and /api/stream is answered with a REAL text/event-stream
 *     body, so the production EventSource → CustomEvent('kanban:created') →
 *     soft-refetch path in api.js/index.html is exercised inside the page.
 *   - E2E_BASE_URL set: runs against a REAL dev server (real POST /api/tasks,
 *     real SSE stream).
 */
import { test, expect, type Route } from '@playwright/test';
import { startDsServer, type DsServer } from './ds-server';

const REAL_BASE = process.env.E2E_BASE_URL || '';
const MOCK_PROJECT = 'opf-hub';
const TITLE = 'Playwright live test';

function sseStreamBody(key: string): string {
  // retry: 600000 keeps EventSource from reconnecting (and re-delivering the
  // event) within the lifetime of the test once the fulfilled body ends.
  return (
    'retry: 600000\n\n' +
    'event: connected\ndata: {}\n\n' +
    `event: created\ndata: ${JSON.stringify({ project: MOCK_PROJECT, key, title: TITLE })}\n\n`
  );
}

test.describe('Live update — SSE → UI (TASK-017)', () => {
  test('creating a task via API adds card + shows toast', async ({ page, request }) => {
    const key = 'LIVEPW-' + Date.now().toString(36).toUpperCase();
    let server: DsServer | null = null;
    let createTask: () => Promise<void>;

    if (REAL_BASE) {
      // ---- Real mode: mint/reuse a token and drive the real server. ----
      const tokenResp = await request.post('/api/tokens', {
        headers: { 'Content-Type': 'application/json' },
        data: { role: 'human', label: 'pw-live-test' },
      });
      // If the server requires auth to mint, fall back to env tokens.
      let token = '';
      if (tokenResp.ok()) {
        const body = await tokenResp.json();
        token = body.secret;
      } else {
        token = process.env.E2E_TOKEN || process.env.KANBAN_ADMIN_TOKEN || '';
      }
      test.skip(!token, 'No token available — skipping live-update spec');

      // Sign in: seed the token before any page script runs, then open the
      // board. The shell redirects '/' to '/<project>/index.html'.
      await page.addInitScript((t) => {
        localStorage.setItem('kanban_token', t);
      }, token);
      await page.goto('/');
      await page.waitForURL(/\/[^/]+\/index\.html/, { timeout: 15000 });
      // 'networkidle' never fires here — the page keeps the SSE connection
      // open. Wait for the board to finish rendering and for the EventSource
      // to be OPEN (server has registered the client) before creating.
      await expect(page.locator('#board-loading')).toBeHidden({ timeout: 15000 });
      await page.waitForFunction(
        () => {
          const es = (window as unknown as { __kanban_sse?: EventSource }).__kanban_sse;
          return !!es && es.readyState === 1; // EventSource.OPEN
        },
        undefined,
        { timeout: 15000 },
      );

      // Create the task in the project the board is actually showing (from
      // the URL path), not a hardcoded slug — SSE handlers filter on it.
      const project = await page.evaluate(
        () => (window as unknown as { projectFromPath(): string }).projectFromPath() || '',
      );
      expect(project).not.toBe('');

      createTask = async () => {
        // Create a task via the API (simulating MCP / external actor)
        const createResp = await request.post('/api/tasks', {
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token,
          },
          data: { project, key, title: TITLE },
        });
        expect(createResp.status()).toBe(201);
      };
    } else {
      // ---- Mocked mode: ds-server static HTTP + routed /api mocks. ----
      server = await startDsServer();
      await page.addInitScript(() => {
        localStorage.setItem('kanban_token', 'mock-token');
      });

      // Board data: starts empty; the "created" task appears in the list the
      // soft-refetch fetches after the SSE event.
      const tasks: Array<Record<string, unknown>> = [];
      await page.route('**/api/projects', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ projects: [{ id: 'p1', slug: MOCK_PROJECT, name: MOCK_PROJECT }] }),
        }),
      );
      await page.route('**/api/tasks?*', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ tasks }),
        }),
      );

      // SSE: hold the page's EventSource connection(s) pending until the test
      // "creates" the task, then serve a real event-stream body through them.
      const pendingSse: Route[] = [];
      let sseBody: string | null = null;
      await page.route('**/api/stream', async (route) => {
        if (sseBody !== null) {
          await route.fulfill({
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
            body: sseBody,
          });
          return;
        }
        pendingSse.push(route);
      });

      await page.goto(server.url('index.html'));
      // The shell redirects to /opf-hub/index.html; with no tasks yet the
      // board renders its empty state — proves the initial load had no card.
      await expect(page.locator('#board-empty')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('#col-todo')).not.toContainText(key);

      createTask = async () => {
        tasks.push({ key, title: TITLE, state: 'TODO', updated_at: new Date().toISOString() });
        sseBody = sseStreamBody(key);
        for (const route of pendingSse) {
          try {
            await route.fulfill({
              status: 200,
              headers: { 'Content-Type': 'text/event-stream' },
              body: sseBody,
            });
          } catch {
            // Connection belonged to a page that already navigated away
            // (e.g. the pre-redirect /index.html load) — ignore.
          }
        }
      };
    }

    try {
      // Marker to prove the live update happens WITHOUT a full page reload:
      // a reload would wipe this flag from the window.
      await page.evaluate(() => {
        (window as unknown as { __pwNoReload?: boolean }).__pwNoReload = true;
      });

      await createTask();

      // Assert the new card appears in the TODO column (soft-refetch via SSE)
      const todoCol = page.locator('#col-todo');
      await expect(todoCol.getByText(key)).toBeVisible({ timeout: 5000 });

      // Assert the toast appears with the task key
      const toast = page.locator('#toast');
      await expect(toast).toBeVisible({ timeout: 5000 });
      await expect(toast.locator('#toast-msg')).toContainText(key);

      // Verify no full page reload happened: the marker set before the create
      // survived, and the page is still on the board URL.
      expect(
        await page.evaluate(() => (window as unknown as { __pwNoReload?: boolean }).__pwNoReload),
      ).toBe(true);
      expect(page.url()).toContain('/');
    } finally {
      if (server) await server.close();
    }
  });
});
