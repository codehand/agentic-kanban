/**
 * task-page.spec.ts — Playwright spec for TASK-073.
 *
 * Task detail used to exist only as a drawer (board + tasks list) with no URL
 * of its own. TASK-073 adds a full-screen page, design-system/task.html, served
 * by the static router at /<project>/t/<KEY> (and bare /t/<KEY>, which resolves
 * the project itself), and turns every task-key surface into a real link to it:
 * the board card key, the tasks-list key cell, the drawer header #drawer-key
 * (both drawers) and the Depends-on chips. Clicking elsewhere on a card / row
 * still opens the drawer.
 *
 * Covers the spec's cases (a)–(h) plus the action flows, error states, the
 * axe scan of the new page and its narrow-viewport layout. Serves
 * design-system/ over HTTP via the ds-server harness (production static
 * routing) and mocks /api/* statefully with page.route (same pattern as
 * drawer-fullscreen.spec.ts), recording every API call so the specs can
 * assert what the page actually sent.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startDsServer, seedToken, type DsServer } from './ds-server';

const PROJECT = 'opf-hub';
const OTHER = 'beta-proj';
const KEY = 'TASK-073A';
const TITLE = 'Full-screen task page';
const DEP = 'TASK-073DEP';
const DEP_TITLE = 'Upstream dependency';
const OTHER_KEY = 'TASK-073B';
const BETA_ONLY = 'BETA-7';

interface MockTask {
  key: string;
  title: string;
  state: string;
  updated_at: string;
  body_md?: string;
  depends_on?: string[];
  priority?: string;
  complexity?: string;
  estimate_hours?: number;
  tags?: string[];
  link_document?: string;
}

interface MockComment {
  author_role: string;
  kind: string;
  verdict: string | null;
  body_md: string;
  created_at: string;
}

interface Call {
  method: string;
  path: string;
  project: string | null;
  body: Record<string, unknown> | null;
}

interface MockDb {
  projects: string[];
  tasks: Record<string, MockTask[]>;
  comments: MockComment[];
  calls: Call[];
  /** getTask response override: status for a key (e.g. 403), or 'abort' for a network error. */
  fail: Record<string, number | 'abort'>;
}

function newDb(state = 'JUDGE_PASSED'): MockDb {
  const now = new Date().toISOString();
  return {
    projects: [PROJECT, OTHER],
    tasks: {
      [PROJECT]: [
        {
          key: KEY,
          title: TITLE,
          state,
          updated_at: now,
          body_md: '## Purpose\nSpec body of the **full-screen** page.',
          depends_on: [DEP],
          priority: 'P1',
          complexity: '3',
          estimate_hours: 4,
          tags: ['ui', 'route'],
          link_document: 'https://example.com/spec',
        },
        { key: DEP, title: DEP_TITLE, state: 'DONE', updated_at: now, body_md: 'Dependency spec.' },
        { key: OTHER_KEY, title: 'Second task', state: 'TODO', updated_at: now, body_md: 'Second spec.' },
      ],
      [OTHER]: [{ key: BETA_ONLY, title: 'Only in beta', state: 'TODO', updated_at: now, body_md: 'Beta spec.' }],
    },
    comments: [{ author_role: 'judge', kind: 'verdict', verdict: 'PASS', body_md: 'Seeded judge comment.', created_at: now }],
    calls: [],
    fail: {},
  };
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Stateful /api/* mock: actions mutate the db so refetches see the new state. */
async function mockApi(page: Page, db: MockDb): Promise<void> {
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const project = url.searchParams.get('project');
      let body: Record<string, unknown> | null = null;
      try { body = req.postData() ? (JSON.parse(req.postData() as string) as Record<string, unknown>) : null; } catch { body = null; }
      db.calls.push({ method: req.method(), path: url.pathname, project, body });

      if (url.pathname === '/api/stream') {
        return route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
          body: 'retry: 600000\n\nevent: connected\ndata: {}\n\n',
        });
      }
      if (url.pathname === '/api/projects') {
        return json(route, 200, { projects: db.projects.map((slug, i) => ({ id: 'p' + i, slug, name: slug })) });
      }
      const list = db.tasks[project || ''] || [];
      if (url.pathname === '/api/tasks') {
        const state = url.searchParams.get('state');
        return json(route, 200, { tasks: list.filter((t) => !state || t.state === state) });
      }
      const m = url.pathname.match(/^\/api\/tasks\/([^/]+)(?:\/([a-z]+))?$/);
      if (!m) return json(route, 404, { error: 'unmocked' });
      const key = decodeURIComponent(m[1]!);
      const action = m[2];
      const fail = db.fail[key];
      if (fail === 'abort') return route.abort('failed');
      if (typeof fail === 'number') return json(route, fail, { error: fail === 403 ? 'Forbidden' : fail === 401 ? 'Unauthorized' : 'Error' });
      const t = list.find((x) => x.key === key);
      if (!t) return json(route, 404, { error: `Task not found: ${key}` });

      if (!action && req.method() === 'GET') {
        return json(route, 200, {
          task: t,
          gitrefs: [{ repo: '.', branch: 'fix/TASK-073-task-page', head_sha: 'abcdef1234567', mr_url: 'https://example.com/mr/73' }],
          evidence: { build_exit: 0, test_exit: 0 },
          timeline: [{ actor_role: 'judge', from_state: 'SELF_CHECK_PASSED', to_state: 'JUDGE_PASSED', at: t.updated_at, note: 'VERDICT: PASS' }],
          comments: key === KEY ? db.comments : [],
        });
      }
      if (!action && req.method() === 'PATCH') {
        Object.assign(t, body || {});
        return json(route, 200, { task: t });
      }
      if (action === 'approve') { t.state = 'DONE'; return json(route, 200, { task: t }); }
      if (action === 'reject') { t.state = 'JUDGE_REJECTED'; return json(route, 200, { task: t }); }
      if (action === 'reset') { t.state = 'IN_PROGRESS'; return json(route, 200, { task: t }); }
      if (action === 'remove') {
        db.tasks[project || ''] = list.filter((x) => x.key !== key);
        return json(route, 200, { removed: true });
      }
      if (action === 'comments') {
        const c: MockComment = { author_role: 'human', kind: 'review', verdict: null, body_md: String(body?.body_md || ''), created_at: new Date().toISOString() };
        db.comments.push(c);
        return json(route, 201, { comment: c });
      }
      return json(route, 404, { error: 'unmocked action' });
    },
  );
}

function callsTo(db: MockDb, method: string, path: string): Call[] {
  return db.calls.filter((c) => c.method === method && c.path === path);
}

/** Wait for the full-screen detail of `key` to be rendered. */
async function expectDetail(page: Page, key: string, title: string): Promise<void> {
  await expect(page.locator('#task-detail')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#task-key')).toHaveText(key);
  await expect(page.locator('#task-title')).toHaveText(title);
  await expect(page.locator('#task-loading')).toBeHidden();
}

async function expectAxeClean(page: Page, context: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .options({
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      rules: { 'label-content-name-mismatch': { enabled: true } },
    })
    .analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  expect(summary, `${context}: axe WCAG A/AA violations`).toEqual([]);
}

test.describe('TASK-073: full-screen task page at /<project>/t/<KEY>', () => {
  let server: DsServer;

  test.beforeAll(async () => {
    server = await startDsServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  test.beforeEach(async ({ context }) => {
    await seedToken(context);
  });

  test('(a) /<p>/t/<KEY> renders the full task detail as a page, not a drawer', async ({ page }) => {
    const db = newDb();
    await mockApi(page, db);
    const res = await page.goto(server.url(`${PROJECT}/t/${KEY}`));
    expect(res?.status()).toBe(200);
    await expectDetail(page, KEY, TITLE);

    await expect(page).toHaveTitle(`${KEY} · ${TITLE}`);
    await expect(page.locator('#task-state-badge')).toHaveText('JUDGE_PASSED');
    await expect(page.locator('#task-project')).toHaveText(PROJECT);
    // Shell rail + topbar like the other pages.
    await expect(page.locator('#rail nav a')).toHaveCount(5);
    await expect(page.locator('#topbar-project')).toHaveText(PROJECT);

    const body = page.locator('#task-body');
    await expect(body.getByRole('heading', { name: 'Spec' })).toBeVisible();
    await expect(body.locator('strong', { hasText: 'full-screen' })).toBeVisible(); // markdown rendered
    await expect(body.getByRole('heading', { name: 'Attributes' })).toBeVisible();
    await expect(body.getByRole('heading', { name: 'Depends on' })).toBeVisible();
    await expect(body.getByRole('heading', { name: 'Repos & MR' })).toBeVisible();
    await expect(body.getByRole('heading', { name: 'Evidence' })).toBeVisible();
    await expect(body.locator('[data-timeline]')).toContainText('JUDGE_PASSED');
    await expect(body.locator('[data-comments]')).toContainText('Seeded judge comment.');
    await expect(body.locator('a', { hasText: 'PR/MR link' })).toHaveAttribute('href', 'https://example.com/mr/73');
    await expect(body.locator('a', { hasText: 'View full evidence' })).toHaveAttribute('href', `/${PROJECT}/evidence.html#${KEY}`);
    await expect(body.locator('a', { hasText: DEP })).toHaveAttribute('href', `/${PROJECT}/t/${DEP}`);
    await expect(page.locator('#back-to-board')).toHaveAttribute('href', `/${PROJECT}/index.html`);

    // Not a drawer: no #drawer, no scrim, no close-drawer button.
    await expect(page.locator('#drawer')).toHaveCount(0);
    await expect(page.locator('#scrim')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Close drawer' })).toHaveCount(0);
  });

  test('(b) action buttons follow the drawer state gating', async ({ page }) => {
    const cases: Array<[string, string[]]> = [
      ['JUDGE_PASSED', ['btn-approve', 'btn-reject', 'btn-remove']],
      ['READY_TO_REVIEW', ['btn-approve', 'btn-reject', 'btn-remove']],
      ['JUDGE_REJECTED', ['btn-reset', 'btn-remove']],
      ['SELF_CHECK_FAILED', ['btn-reset', 'btn-remove']],
      ['IN_PROGRESS', ['btn-remove']],
      ['DONE', []],
    ];
    for (const [state, visible] of cases) {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await mockApi(page, newDb(state));
      await page.goto(server.url(`${PROJECT}/t/${KEY}`));
      await expectDetail(page, KEY, TITLE);
      await expect(page.locator('#task-state-badge')).toHaveText(state);
      for (const id of ['btn-approve', 'btn-reject', 'btn-reset', 'btn-remove']) {
        if (visible.includes(id)) await expect(page.locator('#' + id), `${state}: ${id}`).toBeVisible();
        else await expect(page.locator('#' + id), `${state}: ${id}`).toBeHidden();
      }
    }
  });

  test('approve (optional note) and reject (required note) call the API and re-render', async ({ page }) => {
    const db = newDb('JUDGE_PASSED');
    await mockApi(page, db);
    await page.goto(server.url(`${PROJECT}/t/${KEY}`));
    await expectDetail(page, KEY, TITLE);

    // Reject: the confirm stays disabled until a reason is typed.
    await page.locator('#btn-reject').click();
    await expect(page.locator('#reject')).toBeVisible();
    await expect(page.locator('#reject-title')).toHaveText(`Reject ${KEY}?`);
    await expect(page.locator('#reject-submit')).toBeDisabled();
    await page.locator('#reject-note').fill('Missing the error-path test.');
    await expect(page.locator('#reject-submit')).toBeEnabled();
    await page.locator('#reject-submit').click();
    await expect(page.locator('#task-state-badge')).toHaveText('JUDGE_REJECTED');
    const rejects = callsTo(db, 'POST', `/api/tasks/${KEY}/reject`);
    expect(rejects).toHaveLength(1);
    expect(rejects[0]!.project).toBe(PROJECT);
    expect(rejects[0]!.body).toEqual({ note: 'Missing the error-path test.' });
    await expect(page.locator('#btn-reset')).toBeVisible();
    await expect(page.locator('#btn-approve')).toBeHidden();

    // Reset -> IN_PROGRESS, page refetched in place (no navigation).
    await page.locator('#btn-reset').click();
    await expect(page.locator('#task-state-badge')).toHaveText('IN_PROGRESS');
    expect(callsTo(db, 'POST', `/api/tasks/${KEY}/reset`)).toHaveLength(1);
    expect(new URL(page.url()).pathname).toBe(`/${PROJECT}/t/${KEY}`);

    // Approve from a fresh JUDGE_PASSED page, with a note.
    db.tasks[PROJECT]![0]!.state = 'JUDGE_PASSED';
    await page.reload();
    await expectDetail(page, KEY, TITLE);
    await page.locator('#btn-approve').click();
    await expect(page.locator('#confirm')).toBeVisible();
    await expect(page.locator('#confirm-title')).toHaveText(`Approve ${KEY}?`);
    await page.locator('#confirm-note').fill('Ship it.');
    await page.getByRole('button', { name: 'Confirm Approve' }).click();
    await expect(page.locator('#task-state-badge')).toHaveText('DONE');
    const approves = callsTo(db, 'POST', `/api/tasks/${KEY}/approve`);
    expect(approves).toHaveLength(1);
    expect(approves[0]!.body).toEqual({ note: 'Ship it.' });
    for (const id of ['btn-approve', 'btn-reject', 'btn-reset', 'btn-remove']) {
      await expect(page.locator('#' + id)).toBeHidden();
    }
  });

  test('remove confirms, calls the API and navigates back to the board', async ({ page }) => {
    const db = newDb('TODO');
    await mockApi(page, db);
    await page.goto(server.url(`${PROJECT}/t/${KEY}`));
    await expectDetail(page, KEY, TITLE);

    // Dismissing the confirm does nothing.
    page.once('dialog', (d) => d.dismiss());
    await page.locator('#btn-remove').click();
    await page.waitForTimeout(200);
    expect(callsTo(db, 'POST', `/api/tasks/${KEY}/remove`)).toHaveLength(0);

    page.once('dialog', (d) => d.accept());
    await page.locator('#btn-remove').click();
    await page.waitForURL(`**/${PROJECT}/index.html`);
    expect(callsTo(db, 'POST', `/api/tasks/${KEY}/remove`)).toHaveLength(1);
    await expect(page.locator('#board-columns')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('article', { hasText: KEY })).toHaveCount(0);
  });

  test('comment composer and attribute edit save and refetch the page', async ({ page }) => {
    const db = newDb('IMPLEMENTED');
    await mockApi(page, db);
    await page.goto(server.url(`${PROJECT}/t/${KEY}`));
    await expectDetail(page, KEY, TITLE);

    await expect(page.locator('#comment-submit')).toBeDisabled();
    await page.locator('#comment-input').fill('Posted from the full page.');
    await page.locator('#comment-submit').click();
    await expect(page.locator('[data-comments-list] li', { hasText: 'Posted from the full page.' })).toBeVisible();
    expect(callsTo(db, 'POST', `/api/tasks/${KEY}/comments`)[0]!.body).toEqual({ body_md: 'Posted from the full page.' });

    await page.locator('#btn-edit-attrs').click();
    await expect(page.locator('#attrs-edit')).toBeVisible();
    await expect(page.locator('#edit-priority')).toHaveValue('P1'); // populated from the task
    await page.locator('#edit-priority').selectOption('P0');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('#attrs-display [aria-label="Priority P0"]')).toBeVisible({ timeout: 5000 });
    const patch = callsTo(db, 'PATCH', `/api/tasks/${KEY}`);
    expect(patch).toHaveLength(1);
    expect(patch[0]!.project).toBe(PROJECT);
    expect(patch[0]!.body).toMatchObject({ priority: 'P0' });
  });

  test('(c) board: the card key opens the full page; the rest of the card opens the drawer', async ({ page }) => {
    await mockApi(page, newDb());
    const boardUrl = server.url(`${PROJECT}/index.html`);
    await page.goto(boardUrl);
    const card = page.locator('article').filter({ hasText: KEY });
    await expect(card).toBeVisible({ timeout: 15000 });

    const keyLink = card.getByRole('link', { name: KEY, exact: true });
    await expect(keyLink).toHaveAttribute('href', `/${PROJECT}/t/${KEY}`);
    await keyLink.click();
    await page.waitForURL(`**/${PROJECT}/t/${KEY}`);
    await expectDetail(page, KEY, TITLE);

    // Browser Back returns to the board (real navigation).
    await page.goBack();
    await page.waitForURL(`**/${PROJECT}/index.html`);
    const card2 = page.locator('article').filter({ hasText: KEY });
    await expect(card2).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#drawer')).toHaveClass(/translate-x-full/); // key click never opened it

    // Anywhere else on the card: the drawer opens, the URL stays.
    await card2.locator('h3').click();
    await expect(page.locator('#drawer')).not.toHaveClass(/translate-x-full/, { timeout: 5000 });
    await expect(page.locator('#drawer-title')).toHaveText(TITLE);
    expect(page.url()).toBe(boardUrl);
  });

  test('(d) tasks list: key link opens the page (click and Enter); row click / Enter opens the drawer', async ({ page }) => {
    await mockApi(page, newDb());
    const listUrl = server.url(`${PROJECT}/tasks.html`);
    await page.goto(listUrl);
    const row = page.locator('#tasks-tbody tr').filter({ hasText: KEY });
    await expect(row).toBeVisible({ timeout: 15000 });
    const keyLink = row.getByRole('link', { name: KEY, exact: true });
    await expect(keyLink).toHaveAttribute('href', `/${PROJECT}/t/${KEY}`);

    // Click the key link -> full page.
    await keyLink.click();
    await page.waitForURL(`**/${PROJECT}/t/${KEY}`);
    await expectDetail(page, KEY, TITLE);

    // Click the row elsewhere -> drawer, URL unchanged.
    await page.goto(listUrl);
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.locator('td').nth(1).click();
    await expect(page.locator('#drawer')).not.toHaveClass(/translate-x-full/, { timeout: 5000 });
    await expect(page.locator('#drawer-title')).toHaveText(TITLE);
    expect(page.url()).toBe(listUrl);

    // Keyboard: Enter on the focused row still opens the drawer.
    await page.goto(listUrl);
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#drawer')).not.toHaveClass(/translate-x-full/, { timeout: 5000 });
    expect(page.url()).toBe(listUrl);

    // Enter on the focused key link follows the link — the row's keydown
    // handler must not swallow it into a drawer open.
    await page.goto(listUrl);
    await expect(row).toBeVisible({ timeout: 15000 });
    let drawerOpened = false;
    await page.exposeFunction('__drawerOpenedSpy', () => { drawerOpened = true; });
    await page.evaluate(() => {
      const w = window as unknown as { __openDrawer: (...a: unknown[]) => void; __drawerOpenedSpy: () => void };
      const orig = w.__openDrawer;
      w.__openDrawer = (...a: unknown[]) => { w.__drawerOpenedSpy(); orig(...a); };
    });
    await keyLink.focus();
    await expect(keyLink).toBeFocused();
    await page.keyboard.press('Enter');
    await page.waitForURL(`**/${PROJECT}/t/${KEY}`);
    await expectDetail(page, KEY, TITLE);
    expect(drawerOpened).toBe(false);
  });

  test('(e) #drawer-key and Depends-on chips link to /<p>/t/<KEY> in both drawers', async ({ page }) => {
    await mockApi(page, newDb());
    const entries: Array<[string, (key: string) => Promise<void>]> = [
      ['index.html', async (key) => { await page.locator('article').filter({ hasText: key }).locator('h3').click(); }],
      ['tasks.html', async (key) => { await page.locator('#tasks-tbody tr').filter({ hasText: key }).locator('td').nth(1).click(); }],
    ];
    for (const [file, open] of entries) {
      await page.goto(server.url(`${PROJECT}/${file}`));
      await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 15000 });
      await open(KEY);
      await expect(page.locator('#drawer-title')).toHaveText(TITLE);
      const drawerKey = page.locator('#drawer-key');
      await expect(drawerKey).toHaveJSProperty('tagName', 'A');
      await expect(drawerKey).toHaveText(KEY);
      await expect(drawerKey, file).toHaveAttribute('href', `/${PROJECT}/t/${KEY}`);
      const chip = page.locator('#drawer-body').getByRole('link', { name: DEP, exact: true });
      await expect(chip, file).toHaveAttribute('href', `/${PROJECT}/t/${DEP}`);

      // Re-opening the drawer on another task updates the header link.
      await page.keyboard.press('Escape');
      await expect(page.locator('#drawer')).toHaveClass(/translate-x-full/);
      await open(OTHER_KEY);
      await expect(page.locator('#drawer-title')).toHaveText('Second task');
      await expect(drawerKey, file).toHaveAttribute('href', `/${PROJECT}/t/${OTHER_KEY}`);

      // The header link really navigates to the full page.
      await drawerKey.click();
      await page.waitForURL(`**/${PROJECT}/t/${OTHER_KEY}`);
      await expectDetail(page, OTHER_KEY, 'Second task');
    }

    // The chip on the full page itself also links (and navigates) upstream.
    await page.goto(server.url(`${PROJECT}/t/${KEY}`));
    await expectDetail(page, KEY, TITLE);
    await page.locator('#task-body').getByRole('link', { name: DEP, exact: true }).click();
    await page.waitForURL(`**/${PROJECT}/t/${DEP}`);
    await expectDetail(page, DEP, DEP_TITLE);
  });

  test('(f) bare /t/<KEY> redirects to the first project that has the task', async ({ page }) => {
    const db = newDb();
    // BETA-7 exists only in beta-proj, which is listed AFTER opf-hub.
    await mockApi(page, db);
    await page.goto(server.url(`t/${BETA_ONLY}`));
    await page.waitForURL(`**/${OTHER}/t/${BETA_ONLY}`);
    await expectDetail(page, BETA_ONLY, 'Only in beta');
    // Projects were tried in list order: opf-hub first, then beta-proj.
    const lookups = db.calls.filter((c) => c.path === `/api/tasks/${BETA_ONLY}`).map((c) => c.project);
    expect(lookups.slice(0, 2)).toEqual([PROJECT, OTHER]);

    // A key present in BOTH projects resolves to the first one in the list.
    db.tasks[OTHER]!.push({ key: KEY, title: 'Beta copy', state: 'TODO', updated_at: new Date().toISOString() });
    await page.goto(server.url(`t/${KEY}`));
    await page.waitForURL(`**/${PROJECT}/t/${KEY}`);
    await expectDetail(page, KEY, TITLE);

    // A key no project has: explicit "Task not found", never stuck on Loading.
    await page.goto(server.url('t/NOPE-404'));
    await expect(page.locator('#task-error')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#task-error-title')).toHaveText('Task not found');
    await expect(page.locator('#task-loading')).toBeHidden();
    expect(new URL(page.url()).pathname).toBe('/t/NOPE-404');
  });

  test('(g) no internal link on the task page leads to a 404', async ({ page }) => {
    await mockApi(page, newDb());
    await page.goto(server.url(`${PROJECT}/t/${KEY}`));
    await expectDetail(page, KEY, TITLE);
    // The rail's project switcher menu is filled from /api/projects.
    await expect(page.locator('#project-menu a[role="menuitem"]')).toHaveCount(2);

    const origin = new URL(server.baseUrl).origin;
    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]')).map((a) => ({
        raw: a.getAttribute('href') || '',
        abs: (a as HTMLAnchorElement).href, // resolved exactly as a click would
      })),
    );
    const internal = new Set<string>();
    for (const { raw, abs } of hrefs) {
      if (raw.startsWith('#') || raw.startsWith('mailto:')) continue;
      const u = new URL(abs);
      if (u.origin !== origin) continue; // external http(s)
      u.hash = '';
      internal.add(u.toString());
    }
    // Sanity: the rail nav, "Awaiting You", switcher, back link, chip and
    // evidence link are all in the set.
    expect(internal.size).toBeGreaterThanOrEqual(8);
    for (const want of [
      `/${PROJECT}/index.html`, `/${PROJECT}/tasks.html`, `/${PROJECT}/projects.html`, `/${PROJECT}/tokens.html`,
      `/${PROJECT}/workflow.html`, `/${PROJECT}/evidence.html`, `/${PROJECT}/t/${DEP}`, `/${OTHER}/index.html`,
    ]) {
      expect([...internal].map((x) => new URL(x).pathname), want).toContain(want);
    }
    for (const url of internal) {
      const res = await page.request.get(url);
      expect(res.status(), url).not.toBe(404);
      expect(res.status(), url).toBe(200);
    }
  });

  test('(g) the 401 sign-in redirect from the task page lands on a real page', async ({ page }) => {
    const db = newDb();
    db.fail[KEY] = 401;
    await mockApi(page, db);
    // api.js clears the token on 401; keep the seeded token from re-appearing
    // on the sign-in page (it would bounce straight back to the board).
    await page.addInitScript(() => {
      if (location.pathname.endsWith('/signin.html')) localStorage.removeItem('kanban_token');
    });
    await page.goto(server.url(`${PROJECT}/t/${KEY}`));
    await page.waitForURL('**/signin.html');
    expect(new URL(page.url()).pathname).toBe(`/${PROJECT}/signin.html`);
    await expect(page.getByRole('heading', { name: 'Operator access' })).toBeVisible({ timeout: 15000 });
  });

  test('(h) unknown key, 403 and network errors show a clear state with a way back', async ({ page }) => {
    const db = newDb();
    await mockApi(page, db);

    await page.goto(server.url(`${PROJECT}/t/NOPE-999`));
    await expect(page.locator('#task-error')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#task-error-title')).toHaveText('Task not found');
    await expect(page.locator('#task-loading')).toBeHidden();
    await expect(page.locator('#task-detail')).toBeHidden();
    const back = page.getByRole('link', { name: 'Back to board' });
    await expect(back).toHaveAttribute('href', `/${PROJECT}/index.html`);

    db.fail[KEY] = 403;
    await page.goto(server.url(`${PROJECT}/t/${KEY}`));
    await expect(page.locator('#task-error')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#task-error-msg')).toHaveText('Forbidden');
    await expect(page.locator('#task-loading')).toBeHidden();

    db.fail[KEY] = 'abort';
    await page.goto(server.url(`${PROJECT}/t/${KEY}`));
    await expect(page.locator('#task-error')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#task-error-title')).toHaveText('Could not load task');
    await expect(page.locator('#task-loading')).toBeHidden();

    await page.getByRole('link', { name: 'Back to board' }).click();
    await page.waitForURL(`**/${PROJECT}/index.html`);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`task page has no axe WCAG A/AA violations (${theme})`, async ({ page }) => {
      await page.addInitScript((t: string) => localStorage.setItem('ak-theme', t), theme);
      await mockApi(page, newDb());
      await page.goto(server.url(`${PROJECT}/t/${KEY}`));
      await expectDetail(page, KEY, TITLE);
      await expect(page.locator('[data-timeline]')).toBeVisible();
      await expectAxeClean(page, `task page/${theme}`);
    });
  }

  test('tasks list with key links has no axe WCAG A/AA violations', async ({ page }) => {
    await mockApi(page, newDb());
    await page.goto(server.url(`${PROJECT}/tasks.html`));
    await expect(page.locator('#tasks-tbody tr').first()).toBeVisible({ timeout: 15000 });
    await expectAxeClean(page, 'tasks list');
  });

  test('task page does not overflow horizontally at ~400px', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 860 });
    await mockApi(page, newDb());
    await page.goto(server.url(`${PROJECT}/t/${KEY}`));
    await expectDetail(page, KEY, TITLE);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await page.locator('#task-detail').boundingBox();
    expect(box!.width).toBeLessThanOrEqual(400);
  });
});
