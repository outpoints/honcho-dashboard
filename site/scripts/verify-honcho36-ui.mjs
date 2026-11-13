// Synthetic browser checks for Honcho 3.6 support: the DREAMS page
// (Representation History), its links from Peers, scheduling a dream from it,
// capped list totals, and the dream-history note on conclusion deletes. Runs a
// 3.6.1 server, a 3.5.0 server, a build from main that reports 3.5.0 with
// dream history only, a server with an unparseable version, and a 3.6.1 server
// that refuses the dream routes to this key. Every data request is intercepted;
// nothing can reach a real Honcho server or another origin.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.DASHBOARD_TEST_URL ?? 'http://127.0.0.1:3108';
const output = process.env.DASHBOARD_TEST_OUTPUT ?? `${process.env.TMPDIR ?? '.'}/honcho36-dashboard-review`;
const captures = process.env.DASHBOARD_TEST_CAPTURES !== '0';
await mkdir(output, { recursive: true });

const date = '2026-11-10T16:00:00Z';
const pageOf = (items, total = items.length) => ({ items, total, page: 1, size: 50, pages: Math.max(1, Math.ceil(total / 50)) });
const WS = 'synthetic-workspace';
const W = `/v3/workspaces/${WS}`;
// Past PAGINATION_COUNT_LIMIT a 3.6 server reports the limit plus one.
const CAPPED_TOTAL = 100_001;

// /openapi.json evidence, as published at each tag.
const SCHEMA_350 = {
  Conclusion: { properties: { id: {}, source_ids: {}, source_message_ids: {} } },
  Page_Conclusion_: { properties: { items: {}, total: { type: 'integer', title: 'Total' } } },
};
const SCHEMA_361 = {
  ...SCHEMA_350,
  Page_Conclusion_: { properties: { items: {}, total: { type: 'integer', description: "Number of matching rows, exact up to the server's PAGINATION_COUNT_LIMIT (default 100000) and reported as that limit plus one when there are more." } } },
  DreamRun: { properties: { id: {}, status: {} } },
  DreamRunDetail: { properties: { id: {}, created: {}, removed: {}, peer_card: {} } },
};
const SERVERS = {
  '3.6.1': { version: '3.6.1', schemas: SCHEMA_361, dreams: true, capped: true },
  '3.5.0': { version: '3.5.0', schemas: SCHEMA_350, dreams: false, capped: false },
  // Built from main after 3.5.0: dream history, but list totals still exact.
  main: { version: '3.5.0', schemas: { ...SCHEMA_350, DreamRun: SCHEMA_361.DreamRun, DreamRunDetail: SCHEMA_361.DreamRunDetail }, dreams: true, capped: false },
  unknown: { version: 'development', schemas: {}, dreams: false, capped: true, notice: /Server version is unverified/ },
  restricted: { version: '3.6.1', schemas: SCHEMA_361, dreams: true, capped: true, denied: true },
};

const run = (id, overrides = {}) => ({
  id, observer_id: 'alice', observed_id: 'alice', dream_type: 'omni', trigger_reason: 'document_threshold',
  status: 'completed', created_count: 0, removed_count: 0, peer_card_updated: false,
  started_at: date, finished_at: '2026-11-10T16:00:38Z', pruned_at: null, ...overrides,
});
const RUNS = [
  run('run-live', { observer_id: 'assistant', status: 'running', created_count: 1, finished_at: null, trigger_reason: 'manual' }),
  run('run-2', { created_count: 1, removed_count: 1, trigger_reason: 'manual', started_at: '2026-11-09T16:00:00Z', finished_at: '2026-11-09T16:00:24Z' }),
  run('run-1', { created_count: 2, removed_count: 1, peer_card_updated: true, started_at: '2026-11-08T16:00:00Z', finished_at: '2026-11-08T16:00:38Z' }),
  run('run-old', { created_count: 3, removed_count: 2, peer_card_updated: true, started_at: '2026-10-01T16:00:00Z', pruned_at: '2026-11-01T00:00:00Z' }),
];
const ref = (id, content, level, status = 'current', removed_in_run = null) => ({ id, content, level, status, removed_in_run });
const DETAILS = {
  'run-1': {
    ...RUNS[2],
    created: [
      { conclusion: ref('c-ind', 'Alice works from her phone in the mornings.', 'inductive'), sources: [ref('c1', 'Alice drinks tea every morning.', 'explicit'), ref('c-gone', null, 'explicit', 'unavailable')], specialist: 'induction' },
      { conclusion: ref('c-ded', 'Alice\u2019s cash flow peaks mid-month.', 'deductive', 'removed', 'run-2'), sources: [ref('c-refund', 'Alice was refunded in October.', 'explicit', 'removed', 'run-1')], specialist: 'deduction' },
    ],
    removed: [{ id: 'c-refund', content: 'Alice was refunded in October.', level: 'explicit', replaced_by: null, specialist: 'deduction' }],
    peer_card: { before: ['IDENTITY: Name: Alice', 'ATTRIBUTE: Billing day: 3rd'], after: ['IDENTITY: Name: Alice', 'ATTRIBUTE: Billing day: 15th'] },
  },
  'run-2': {
    ...RUNS[1],
    created: [{ conclusion: ref('c-ded2', 'Alice moved billing to the 15th to match payday.', 'deductive'), sources: [], specialist: 'deduction' }],
    removed: [{ id: 'c-ded', content: 'Alice\u2019s cash flow peaks mid-month.', level: 'deductive', replaced_by: 'c-ded2', specialist: 'deduction' }],
    peer_card: null,
  },
  'run-live': { ...RUNS[0], created: [{ conclusion: ref('c-live', 'Assistant sees Alice prefers short answers.', 'deductive'), sources: [], specialist: 'deduction' }], removed: [], peer_card: null },
  'run-old': { ...RUNS[3], created: [{ conclusion: ref('c-ind', 'Alice works from her phone in the mornings.', 'inductive'), sources: [], specialist: 'induction' }], removed: [], peer_card: null },
};

function fixture() {
  const ws = { id: WS, metadata: {}, configuration: {}, created_at: date };
  const peers = [
    { id: 'alice', workspace_id: WS, metadata: {}, configuration: { observe_me: true }, created_at: date },
    { id: 'assistant', workspace_id: WS, metadata: {}, configuration: { observe_me: false }, created_at: date },
  ];
  const sessions = [{ id: 'session-1', workspace_id: WS, metadata: {}, configuration: {}, is_active: true, created_at: date }];
  const conclusions = [
    { id: 'c1', content: 'Alice drinks tea every morning.', observer_id: 'alice', observed_id: 'alice', session_id: 'session-1', level: 'explicit', source_ids: [], times_derived: 1, created_at: date },
  ];
  return { ws, peers, sessions, conclusions };
}

const browser = await chromium.launch({ headless: true });
const unexpected = [];
const errors = [];
const overflows = [];

async function contextFor(key, viewport) {
  const server = SERVERS[key];
  const data = fixture();
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  await context.addInitScript(({ ws }) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('honcho-dashboard:instances', JSON.stringify([{ id: 'synthetic', name: 'Synthetic fixture', baseUrl: 'http://synthetic.invalid:8000' }]));
    localStorage.setItem('honcho-dashboard:activeId', 'synthetic');
    localStorage.setItem('honcho-dashboard:activeWorkspaceId', ws);
    localStorage.setItem('honcho-dashboard:theme', 'dark');
    localStorage.setItem('honcho-dashboard:writeActions', 'true');
  }, { ws: WS });
  const calls = [];
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== new URL(base).origin) { unexpected.push(url.href); return route.abort(); }
    const path = url.pathname.replace(/^\/api\/honcho/, '');
    const isData = path.startsWith('/v3/') || url.pathname.startsWith('/api/') || ['/health', '/openapi.json', '/deriver/metrics'].includes(path);
    if (!isData) return route.continue();
    let body; try { body = req.postDataJSON(); } catch {}
    const method = req.method();
    calls.push({ method, path, query: url.search, body });
    const reply = (json, status = 200) => route.fulfill({ json, status });
    if (path === '/openapi.json') return reply({ info: { version: server.version }, components: { schemas: server.schemas } });
    if (path === '/health') return reply({ status: 'ok' });
    if (path === '/deriver/metrics') return reply({ detail: 'No measurement' }, 404);
    if (path === '/v3/workspaces/list') return reply(pageOf([data.ws]));
    if (path === '/v3/workspaces' && method === 'POST') {
      if (body?.id !== WS) unexpected.push(`get-or-create of unknown workspace ${body?.id}`);
      return reply(data.ws);
    }
    if (path === `${W}/peers/list`) return reply(pageOf(data.peers));
    if (/\/peers\/\w+\/sessions$/.test(path)) return reply(pageOf(data.sessions, server.capped ? CAPPED_TOTAL : 7));
    if (/\/peers\/\w+\/card$/.test(path)) return reply({ peer_card: ['IDENTITY: Name: Alice'] });
    if (path === `${W}/sessions/list`) return reply(pageOf(data.sessions));
    if (path === `${W}/conclusions/list`) return reply(pageOf(data.conclusions, CAPPED_TOTAL));
    // Conclusions loads scopes for its scope-copy filter; the unknown server is probed for 3.1.
    if (path === `${W}/scopes/list`) return reply(pageOf([]));
    if (path === `${W}/queue/status`) return reply({ total_work_units: 4, completed_work_units: 4, in_progress_work_units: 0, pending_work_units: 0 });
    if (path === `${W}/dreams/list` && method === 'POST') {
      if (!server.dreams) unexpected.push(`${key}: dream list on a server without dream history`);
      if (server.denied) return reply({ detail: 'Workspace or admin key required' }, 403);
      const items = RUNS.filter((r) => (!body?.observed_id || r.observed_id === body.observed_id) && (!body?.observer_id || r.observer_id === body.observer_id));
      return reply({ ...pageOf(items), size: 20 });
    }
    const dream = path.match(new RegExp(`^${W}/dreams/([\\w-]+)$`));
    if (dream && method === 'GET') {
      if (!server.dreams) unexpected.push(`${key}: dream read on a server without dream history`);
      return DETAILS[dream[1]] ? reply(DETAILS[dream[1]]) : reply({ detail: 'Dream run not found' }, 404);
    }
    if (path === `${W}/schedule_dream` && method === 'POST') return route.fulfill({ status: 204, body: '' });
    if (path.startsWith('/api/operator/')) return reply({ available: false, reason: 'Synthetic test has no operator DB' });
    unexpected.push(`${key}: ${method} ${path}${url.search}`);
    return reply({ detail: 'Not in fixture' }, 404);
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${key}: ${e.message}`));
  return { context, page, calls };
}

const dialog = (page) => page.getByRole('dialog');
const dreamCalls = (calls) => calls.filter((c) => c.path.startsWith(`${W}/dreams`));
async function noOverflow(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) overflows.push(`${label}: ${overflow}px`);
}
async function shot(page, name) {
  if (captures) await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
}
const runRow = (page, text) => page.locator('main button[data-dream-row]').filter({ hasText: text }).first();
// Run rows say +added ~rewritten −forgotten; screen-reader words spell each count out.
const CARD_RUN = /forgotten[\s\S]*card/;
async function until(check, label, ms = 5000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out: ${label}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

try {
  for (const key of Object.keys(SERVERS)) {
    const server = SERVERS[key];
    const { context, page, calls } = await contextFor(key, { width: 1440, height: 1000 });

    // --- DREAMS page --------------------------------------------------------
    await page.goto(`${base}/#/dreams`);
    await page.getByRole('navigation').getByRole('button', { name: 'DREAMS' }).waitFor();
    if (!server.dreams) {
      await page.getByText(server.notice ?? /Representation History requires Honcho 3\.6\+/).waitFor();
      await page.waitForTimeout(400);
      assert.deepEqual(dreamCalls(calls), [], `${key}: no dream request without the capability`);
      await shot(page, `${key}-dreams`);
    } else if (server.denied) {
      await page.getByText('Representation History needs a workspace or admin key', { exact: false }).waitFor();
      await shot(page, `${key}-dreams`);
    } else {
      await runRow(page, 'own view').waitFor();
      const list = dreamCalls(calls).find((c) => c.path.endsWith('/dreams/list'));
      assert.deepEqual(list.body ?? {}, {}, `${key}: no filters on the first load`);
      assert.match(list.query, /page=1/);
      assert.match(list.query, /size=20/);
      assert.ok(await page.getByText('[ DREAM_RUNS ]', { exact: true }).isVisible());
      assert.ok(await runRow(page, 'running').isVisible(), 'the running run is listed');
      // run-live started days before the others finished in seconds: it reads as stuck.
      assert.ok(await runRow(page, 'may be stuck').isVisible(), 'a run left running is flagged');
      assert.equal(await page.locator('main [data-dream-row]').getByText('pruned', { exact: true }).count(), 1, 'the pruned run is marked');
      assert.equal(await page.locator('main h2').count(), 4, 'runs group by start time');
      // Only runs that removed something load their detail, to tell rewrites from forgotten conclusions.
      const reads = () => dreamCalls(calls).filter((c) => c.method === 'GET').map((c) => c.path.split('/').at(-1));
      await until(() => reads().length >= 2, 'detail reads for runs with removals');
      await page.waitForTimeout(300);
      assert.deepEqual([...new Set(reads())].sort(), ['run-1', 'run-2'], 'no read for a run that removed nothing or was pruned');
      await runRow(page, 'forgotten').waitFor();
      assert.ok(await runRow(page, 'rewritten').isVisible(), 'a replaced conclusion reads as rewritten');
      // The verdict line counts what needs a look, and each count narrows the list through the link.
      const triage = page.getByRole('group', { name: 'What needs attention' });
      await triage.getByRole('button', { name: /^1 forgotten$/i }).waitFor();
      assert.ok(await triage.getByRole('button', { name: /^1 may be stuck$/i }).isVisible());
      assert.match(await triage.innerText(), /1 with removals not split/, 'the pruned run is not counted as anything');
      await triage.getByRole('button', { name: /^1 forgotten$/i }).click();
      await page.waitForURL(/#\/dreams\?show=forgotten$/);
      // The list re-renders from the hash change after the URL settles.
      await page.locator('main [data-dream-row]').nth(1).waitFor({ state: 'detached' });
      assert.equal(await page.locator('main [data-dream-row]').count(), 1, 'only the run that forgot something');
      await triage.getByRole('button', { name: 'SHOW_ALL', exact: true }).click();
      await page.waitForURL(/#\/dreams$/);
      await shot(page, `${key}-dreams`);

      // Open the run that created two conclusions and rewrote the card.
      await runRow(page, CARD_RUN).click();
      await page.getByText('Alice works from her phone in the mornings.').first().waitFor();
      assert.equal(calls.filter((c) => c.method === 'GET' && c.path === `${W}/dreams/run-1`).length, 1, 'opening reuses the read');
      await page.getByRole('button', { name: /^SOURCES · 2/ }).click();
      await page.getByText('Evidence this pattern was drawn from.').waitFor();
      await page.getByText('Text unavailable', { exact: false }).first().waitFor();
      await page.getByRole('button', { name: /^SOURCES · 1/ }).click();
      await page.getByText('removed later in this dream', { exact: true }).waitFor();
      // A loss comes first, under its own heading.
      assert.match(await page.locator('main h5').first().innerText(), /^FORGOTTEN · 1/);
      await page.getByText('2 lines before · 2 after', { exact: true }).waitFor();
      // 3rd → 15th share a key, so they read as one changed line.
      assert.equal(await page.getByText('ATTRIBUTE: Billing day: 15th', { exact: true }).count(), 1);
      assert.equal(await page.getByText('ATTRIBUTE: Billing day: 3rd', { exact: true }).count(), 1);
      await shot(page, `${key}-dream-run`);
      // Escape on an open row closes it and keeps focus on the row.
      await runRow(page, CARD_RUN).focus();
      await page.keyboard.press('Escape');
      assert.equal(await runRow(page, CARD_RUN).getAttribute('aria-expanded'), 'false');
      await runRow(page, CARD_RUN).click();
      await page.getByText('Alice works from her phone in the mornings.').first().waitFor();

      // Follow the deductive conclusion to the dream that removed it.
      await page.getByRole('button', { name: 'Open the dream that removed conclusion c-ded' }).click();
      await dialog(page).getByText('Alice moved billing to the 15th to match payday.').first().waitFor();
      await dialog(page).getByText('Alice\u2019s cash flow peaks mid-month.').first().waitFor();
      // The conclusion followed is marked in the run that removed it.
      await dialog(page).getByText('Opened from conclusion c-ded, marked below.').waitFor();
      assert.match(await dialog(page).locator('[data-focused]').innerText(), /cash flow peaks mid-month/);
      assert.ok(calls.some((c) => c.method === 'GET' && c.path === `${W}/dreams/run-2`));
      await dialog(page).getByRole('button', { name: 'CLOSE', exact: true }).click();

      // INSPECT opens the conclusion inspector on a current conclusion.
      assert.equal(await page.getByRole('button', { name: 'Inspect conclusion c-ded' }).count(), 0, 'no INSPECT on a removed conclusion');

      // A run link opens that run on its own.
      await page.goto(`${base}/#/dreams?run=run-2`);
      await dialog(page).getByText('Alice moved billing to the 15th to match payday.').first().waitFor();
      await dialog(page).getByRole('button', { name: 'CLOSE', exact: true }).click();
      await page.waitForURL(/#\/dreams$/);

      // Filters travel in the hash; the Peers link uses ?peer=.
      await page.goto(`${base}/#/dreams?peer=alice&observer=assistant`);
      await runRow(page, 'running').waitFor();
      const filtered = dreamCalls(calls).filter((c) => c.path.endsWith('/dreams/list')).at(-1);
      assert.deepEqual(filtered.body, { observed_id: 'alice', observer_id: 'assistant' });
      await page.goto(`${base}/#/dreams?observed=assistant`);
      await page.getByText('No dreams', { exact: false }).waitFor();
      await page.getByRole('button', { name: 'CLEAR_FILTERS' }).click();
      await page.waitForURL(/#\/dreams$/);

      // Scheduling from DREAMS starts from the filter and confirms first.
      await page.goto(`${base}/#/dreams?peer=alice`);
      await runRow(page, 'own view').waitFor();
      await page.getByRole('button', { name: 'SCHEDULE_DREAM', exact: true }).first().click();
      // The workspace's whole peer list fits, so peers are picked, starting from the filter.
      await dialog(page).getByRole('button', { name: 'Observer: alice' }).waitFor();
      await dialog(page).getByRole('button', { name: 'SCHEDULE', exact: true }).click();
      await page.getByRole('button', { name: 'SCHEDULE', exact: true }).last().click();
      await page.getByText('Dream scheduled for alice').waitFor();
      const scheduled = calls.find((c) => c.path === `${W}/schedule_dream`);
      assert.deepEqual(scheduled.body, { observer: 'alice', observed: 'alice', dream_type: 'omni' });
    }

    // --- Peers row links to the dream history -----------------------------
    await page.goto(`${base}/#/peers`);
    await page.locator('main button[aria-controls]').filter({ hasText: 'alice' }).first().click();
    await page.locator('main').getByRole('button', { name: 'CONTEXT', exact: true }).waitFor();
    const peerDreams = page.locator('main').getByRole('button', { name: 'DREAMS', exact: true });
    assert.equal(await peerDreams.count(), server.dreams ? 1 : 0, `${key}: DREAMS on the peer row only with dream history`);
    // The peer's session count is a list total.
    await page.locator('main').getByRole('button', { name: /^SESSIONS/ }).getByText(server.capped ? '100,000+' : '7').waitFor();
    if (server.dreams && !server.denied) {
      await peerDreams.click();
      await page.waitForURL(/#\/dreams\?peer=alice/);
      await runRow(page, 'own view').waitFor();
    }

    // --- Capped list totals --------------------------------------------------
    await page.goto(`${base}/#/conclusions`);
    await page.getByText('Alice drinks tea every morning.').first().waitFor();
    const totalText = server.capped ? '100,000+ total' : '100,001 total';
    await page.getByText(totalText, { exact: true }).waitFor();

    // --- Deleting a conclusion names its dream-history copy on 3.6 ---------------
    await page.getByRole('button', { name: 'Delete conclusion' }).first().click();
    const confirmText = await dialog(page).last().innerText();
    if (server.dreams) assert.match(confirmText, /deletes its copy in dream history/, `${key}: delete names dream history`);
    else assert.doesNotMatch(confirmText, /dream history/, `${key}: no dream-history note before 3.6`);
    await dialog(page).getByRole('button', { name: 'CANCEL', exact: true }).click();
    assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0, 'cancel sends nothing');

    await context.close();
    console.log(`${key}: ok`);
  }

  // --- Phone layout on 3.6.1 ----------------------------------------------------
  {
    const { context, page } = await contextFor('3.6.1', { width: 390, height: 844 });
    await page.goto(`${base}/#/dreams`);
    await runRow(page, CARD_RUN).click();
    await page.getByText('Alice works from her phone in the mornings.').first().waitFor();
    await noOverflow(page, 'phone dreams');
    await shot(page, 'phone-dreams');
    await context.close();
  }

  assert.deepEqual(unexpected, [], 'every request was in the fixture');
  assert.deepEqual(errors, [], 'no page errors');
  assert.deepEqual(overflows, [], 'no horizontal overflow');
  console.log(`honcho 3.6 UI checks passed${captures ? `; screenshots in ${output}` : ''}`);
} finally {
  await browser.close();
}
