/**
 * evidence-render.spec.ts — Playwright spec for TASK-056.
 *
 * The bug: design-system/evidence.html was a P7 prototype mock — all content
 * (title "Evidence TASK-002", H1 "Wire FREE subscribe e2e flow", coverage
 * 84.2%, fake sha256 rows) was hardcoded, and its inline script only
 * console.log'd the fetched evidence instead of rendering it. The fix replaces
 * the mock with a real client-side renderer driven by api.getEvidence().
 *
 * This spec serves design-system/ over HTTP (ds-server helper) and mocks the
 * /api/* endpoints the page needs — including /api/evidence/:key and
 * /api/tasks/:key — for a task with DISTINCTIVE evidence values (a unique
 * coverage % and a unique manifest filename). It opens evidence.html#<key> and
 * asserts the page renders THOSE live values (task key in title/breadcrumb +
 * the distinctive coverage and manifest filename), NOT the old mock. It fails
 * on the unpatched (mock) page and passes after the fix.
 */
import { test, expect } from '@playwright/test';
import { startDsServer, type DsServer } from './ds-server';

let server: DsServer;

const PROJECT = 'evid-render-proj';
const TASK_KEY = 'TASK-056-EV';
const TASK_TITLE = 'Renderer wires evidence to live data';
const DISTINCTIVE_COVERAGE = 73.6; // not the mock's 84.2%
const DISTINCTIVE_FILE = 'DISTINCTIVE-evid056.log'; // not any mock filename

async function mockApi(page: any) {
  await page.addInitScript(
    (cfg: {
      project: string;
      key: string;
      title: string;
      coverage: number;
      file: string;
    }) => {
      const PROJECTS = JSON.stringify({
        projects: [{ id: cfg.project, slug: cfg.project, name: cfg.project }],
      });
      const TASK = JSON.stringify({
        task: { key: cfg.key, title: cfg.title, state: 'JUDGE_PASSED' },
        gitrefs: [],
        evidence: null,
        timeline: [],
      });
      // Evidence list, oldest-first (created_at ASC). The page must pick the
      // LATEST row — give it an older decoy row plus the distinctive newest.
      const EVIDENCE = JSON.stringify({
        evidence: [
          {
            id: 'ev_old',
            build_exit: 0,
            test_exit: 0,
            lint_exit: 0,
            ac_exit: 0,
            coverage_pct: 50.0,
            manifest_json: JSON.stringify({ files: { 'old.log': 'aaaa' } }),
            logs_json: '{}',
            manifest_checksum: 'oldsum',
            created_at: '2026-06-01T00:00:00Z',
            submitted_by_token_id: 'runner-old',
          },
          {
            id: 'ev_new',
            build_exit: 0,
            test_exit: 0,
            lint_exit: null,
            ac_exit: 0,
            coverage_pct: cfg.coverage,
            manifest_json: JSON.stringify({ files: { [cfg.file]: 'deadbeef0123' } }),
            logs_json: JSON.stringify({ 'test.log': 'sha256:cafef00d' }),
            manifest_checksum: 'newsum-abc123',
            created_at: '2026-06-20T12:00:00Z',
            submitted_by_token_id: 'runner-new',
          },
        ],
      });

      const origFetch = window.fetch.bind(window);
      window.fetch = async function (input: any, init?: any) {
        const url = typeof input === 'string' ? input : input.url;
        if (url.includes('/api/evidence/')) {
          return new Response(EVIDENCE, { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('/api/tasks/')) {
          return new Response(TASK, { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('/api/projects')) {
          return new Response(PROJECTS, { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('/api/tokens')) {
          return new Response(JSON.stringify({ tokens: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return origFetch(input, init);
      };
    },
    { project: PROJECT, key: TASK_KEY, title: TASK_TITLE, coverage: DISTINCTIVE_COVERAGE, file: DISTINCTIVE_FILE },
  );
}

test.describe('TASK-056: evidence page renders live evidence data', () => {
  test.beforeAll(async () => {
    server = await startDsServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  test.beforeEach(async ({ context }) => {
    // Seed a token so api.js doesn't redirect to signin.html.
    await context.addInitScript(() => {
      localStorage.setItem('kanban_token', 'test-token');
    });
  });

  test('renders the task key, title, distinctive coverage + manifest filename (not the mock)', async ({ page }) => {
    await mockApi(page);
    await page.goto(`${server.baseUrl}/${PROJECT}/evidence.html#${TASK_KEY}`);

    // Live content renders into #ev-content.
    const content = page.locator('#ev-content');
    await expect(content).toBeVisible({ timeout: 10000 });

    // Title (tab + summary header) reflects the LIVE task, not "TASK-002".
    await expect(page).toHaveTitle(new RegExp(TASK_KEY));
    await expect(page.locator('#ev-title')).toHaveText(TASK_TITLE);
    await expect(page.locator('#ev-crumb-key')).toHaveText(TASK_KEY);

    // Distinctive coverage from the LATEST row (73.6%), not the mock 84.2% or
    // the older decoy row's 50%.
    await expect(page.locator('#ev-coverage')).toContainText('73.6%');

    // Distinctive manifest filename from the latest row.
    await expect(content).toContainText(DISTINCTIVE_FILE);

    // The old mock content must be gone.
    await expect(content).not.toContainText('Wire FREE subscribe');
    await expect(content).not.toContainText('opf-auto-e2e');
    await expect(content).not.toContainText('84.2%');
  });

  test('shows the empty state when the task has no evidence', async ({ page }) => {
    await page.addInitScript(() => {
      const origFetch = window.fetch.bind(window);
      window.fetch = async function (input: any, init?: any) {
        const url = typeof input === 'string' ? input : input.url;
        if (url.includes('/api/evidence/')) {
          return new Response(JSON.stringify({ evidence: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('/api/tasks/')) {
          return new Response(JSON.stringify({ task: { key: 'TASK-056-NONE', title: 'No evidence yet' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('/api/projects')) {
          return new Response(JSON.stringify({ projects: [{ id: 'p', slug: 'p', name: 'p' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('/api/tokens')) {
          return new Response(JSON.stringify({ tokens: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return origFetch(input, init);
      };
    });
    await page.goto(`${server.baseUrl}/p/evidence.html#TASK-056-NONE`);
    await expect(page.locator('#ev-empty')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#ev-content')).toBeHidden();
  });
});
