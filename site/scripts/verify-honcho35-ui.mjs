// Synthetic browser checks for Honcho 3.5 support: session scopes, scope
// counts and bulk removal, message citations both ways, and the workspace
// configuration replace. Runs a 3.5.0 server, a 3.4.1 server, and a build from
// main that reports 3.4.1 with only some 3.5 features. Every data request is
// intercepted; nothing can reach a real Honcho server or another origin.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.DASHBOARD_TEST_URL ?? 'http://127.0.0.1:3108';
const output = process.env.DASHBOARD_TEST_OUTPUT ?? `${process.env.TMPDIR ?? '.'}/honcho35-dashboard-review`;
const captures = process.env.DASHBOARD_TEST_CAPTURES !== '0';
await mkdir(output, { recursive: true });

const date = '2026-10-30T16:00:00Z';
const pageOf = (items) => ({ items, total: items.length, page: 1, size: 50, pages: 1 });
const WS = 'synthetic-workspace';
const W = `/v3/workspaces/${WS}`;

// /openapi.json evidence, as published at each tag.
const SCHEMA_341 = {
  Conclusion: { properties: { id: {}, source_ids: {} } },
  Scope: { properties: { id: {} } },
  Session: { properties: { id: {} } },
  WorkspaceUpdate: { properties: { configuration: {} } },
};
const SCHEMA_350 = {
  Conclusion: { properties: { id: {}, source_ids: {}, source_message_ids: {} } },
  Scope: { properties: { id: {}, session_count: {} } },
  Session: { properties: { id: {}, scopes: {} } },
  WorkspaceSessionGet: { properties: { scope: {}, in_no_scope: {} } },
  ScopeSessionsRemove: { properties: { session_ids: {} } },
  WorkspaceUpdate: { properties: { configuration: { description: 'Replaces the entire workspace configuration. Send {} to clear explicit settings and use system defaults.' } } },
};
const SERVERS = {
  '3.5.0': { version: '3.5.0', schemas: SCHEMA_350, scopes: true, citations: true, replaces: true },
  '3.4.1': { version: '3.4.1', schemas: SCHEMA_341, scopes: false, citations: false, replaces: false },
  // Built from main between the tags: citations and config replace, no scope list changes.
  main: { version: '3.4.1', schemas: { ...SCHEMA_341, Conclusion: SCHEMA_350.Conclusion, WorkspaceUpdate: SCHEMA_350.WorkspaceUpdate }, scopes: false, citations: true, replaces: true },
};

const STORED_CONFIG = { custom_instructions: 'Write plainly.', dream: { enabled: false }, extra_flag: { keep: true } };

function fixture(server) {
  const ws = { id: WS, metadata: {}, configuration: STORED_CONFIG, created_at: date };
  const peers = [
    { id: 'alice', workspace_id: WS, metadata: {}, configuration: { observe_me: true }, created_at: date },
    { id: 'assistant', workspace_id: WS, metadata: {}, configuration: { observe_me: false }, created_at: date },
  ];
  const session = (id, scopes) => ({ id, workspace_id: WS, metadata: {}, configuration: {}, is_active: true, created_at: date, ...(server.scopes ? { scopes } : {}) });
  const sessions = [session('session-1', ['billing']), session('session-2', []), session('session-3', ['billing', 'exports'])];
  const messages = [
    { id: 'm1', workspace_id: WS, session_id: 'session-1', peer_id: 'alice', content: 'I drink tea every morning.', token_count: 6, metadata: {}, created_at: '2026-10-01T08:00:00Z' },
    { id: 'm2', workspace_id: WS, session_id: 'session-1', peer_id: 'assistant', content: 'Noted.', token_count: 2, metadata: {}, created_at: '2026-10-01T08:00:05Z' },
  ];
  const cite = (ids) => (server.citations ? { source_message_ids: ids } : {});
  const conclusions = [
    { id: 'c1', content: 'Alice drinks tea every morning.', observer_id: 'alice', observed_id: 'alice', session_id: 'session-1', level: 'explicit', source_ids: [], times_derived: 1, created_at: date, ...cite(['m1']) },
    { id: 'c2', content: 'Alice prefers tea to coffee.', observer_id: 'assistant', observed_id: 'alice', session_id: 'session-1', level: 'explicit', source_ids: [], times_derived: 1, created_at: date, ...cite(['m1', 'm2']) },
    { id: 'c3', content: 'Alice keeps a morning routine.', observer_id: 'alice', observed_id: 'alice', session_id: 'session-1', level: 'deductive', source_ids: ['c1'], times_derived: 1, created_at: date, ...cite(null) },
  ];
  const scopes = [
    { id: 'billing', metadata: {}, created_at: date, ...(server.scopes ? { session_count: 2 } : {}) },
    { id: 'exports', metadata: {}, created_at: date, ...(server.scopes ? { session_count: 1 } : {}) },
  ];
  return { ws, peers, sessions, messages, conclusions, scopes };
}

const browser = await chromium.launch({ headless: true });
const unexpected = [];
const errors = [];
const overflows = [];

async function contextFor(key, viewport) {
  const server = SERVERS[key];
  const data = fixture(server);
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
    const q = url.searchParams;
    if (path === '/openapi.json') return reply({ info: { version: server.version }, components: { schemas: server.schemas } });
    if (path === '/health') return reply({ status: 'ok' });
    if (path === '/deriver/metrics') return reply({ detail: 'No measurement' }, 404);
    if (path === '/v3/workspaces/list') return reply(pageOf([data.ws]));
    if (path === '/v3/workspaces' && method === 'POST') return reply(data.ws);
    if (path === W && method === 'PUT') return reply({ ...data.ws, configuration: body?.configuration ?? data.ws.configuration });
    if (path === `${W}/peers/list`) return reply(pageOf(data.peers));
    if (path === `${W}/sessions/list`) {
      // A 3.5 server honors include_scopes; the fixture strips scopes otherwise.
      const strip = (s) => (q.get('include_scopes') === 'true' ? s : Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'scopes')));
      return reply(pageOf(data.sessions.map(strip)));
    }
    // Opening a session row reads summaries and peers through the SDK's
    // session(), a get-or-create. Allowed only for a session that exists.
    if (path === `${W}/sessions` && method === 'POST') {
      const existing = data.sessions.find((x) => x.id === body?.id);
      if (!existing) unexpected.push(`get-or-create of unknown session ${body?.id}`);
      return reply(existing ?? {}, existing ? 200 : 404);
    }
    if (/\/sessions\/session-\d\/peers$/.test(path)) return reply(pageOf(data.peers));
    if (/\/sessions\/session-\d\/messages\/list$/.test(path)) return reply(pageOf(path.includes('session-1') ? data.messages : []));
    const message = path.match(/\/sessions\/(session-\d)\/messages\/(m\d)$/);
    if (message && method === 'GET') {
      const found = data.messages.find((m) => m.id === message[2] && m.session_id === message[1]);
      return found ? reply(found) : reply({ detail: 'Message not found' }, 404);
    }
    if (/\/sessions\/session-\d\/summaries$/.test(path)) return reply({ id: 'session-1', short_summary: null, long_summary: null });
    if (path === `${W}/conclusions/list`) {
      const cited = body?.filters?.source_message_ids?.contains;
      if (cited) return reply(pageOf(data.conclusions.filter((c) => c.source_message_ids?.includes(cited))));
      return reply(pageOf(data.conclusions));
    }
    const conclusion = path.match(/\/conclusions\/(c\d)$/);
    if (conclusion && method === 'GET') return reply(data.conclusions.find((c) => c.id === conclusion[1]));
    if (path === `${W}/scopes/list`) {
      const strip = (s) => (q.get('include_session_count') === 'true' ? s : Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'session_count')));
      return reply(pageOf(data.scopes.map(strip)));
    }
    if (path === `${W}/scopes/billing/sessions/list`) return reply(pageOf(data.sessions.filter((s) => s.id !== 'session-2').map((s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'scopes')))));
    if (path === `${W}/scopes/exports/sessions/list`) return reply(pageOf([]));
    if (/\/scopes\/\w+\/status$/.test(path)) return reply({ id: 'billing', backfill_status: {} });
    if (path === `${W}/scopes/billing/sessions/remove` && method === 'POST') return route.fulfill({ status: 204, body: '' });
    if (path === `${W}/queue/status`) return reply({ total_work_units: 4, completed_work_units: 4, in_progress_work_units: 0, pending_work_units: 0 });
    // The 3.5 run has an operator DB with failed queue items; the others have none.
    if (path === '/api/operator/db' && q.get('view') === 'queue_failures' && key === '3.5.0') {
      return reply({ available: true, workspace_id: q.get('workspace_id'), failed: 2, latest_failed_at: date });
    }
    if (path.startsWith('/api/operator/')) return reply({ available: false, reason: 'Synthetic test has no operator DB' });
    unexpected.push(`${method} ${path}${url.search}`);
    return reply({ detail: 'Not in fixture' }, 404);
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${key}: ${e.message}`));
  return { context, page, calls };
}

const dialog = (page) => page.getByRole('dialog');
async function noOverflow(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) overflows.push(`${label}: ${overflow}px`);
}
async function shot(page, name) {
  if (captures) await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
}
// Session rows animate out when a filter hides them; wait for the list to settle.
async function sessionRowsAre(page, expected) {
  await page.waitForFunction((want) => {
    const rows = [...document.querySelectorAll('main button')].map((b) => b.textContent.match(/^\s*(session-\d)@/)?.[1]).filter(Boolean);
    return JSON.stringify(rows) === JSON.stringify(want);
  }, expected, { timeout: 5000 }).catch(() => {});
  const rows = await page.locator('main button').evaluateAll((els) => els.map((b) => b.textContent.match(/^\s*(session-\d)@/)?.[1]).filter(Boolean));
  assert.deepEqual(rows, expected);
}
async function openSessions(page) {
  await page.goto(`${base}/#/sessions`);
  await page.locator('button', { hasText: 'session-1@' }).first().waitFor();
}
async function saveConfigFromJson(page, calls, json) {
  await page.goto(`${base}/#/workspaces`);
  await page.getByRole('button', { name: 'Edit workspace config' }).first().click();
  await dialog(page).getByRole('button', { name: 'JSON', exact: true }).click();
  const hint = await dialog(page).getByText('Full workspace configuration.', { exact: false }).innerText();
  await dialog(page).locator('textarea').fill(JSON.stringify(json));
  const before = calls.length;
  await dialog(page).getByRole('button', { name: 'SAVE', exact: true }).click();
  const confirmText = await dialog(page).last().innerText();
  await page.getByRole('button', { name: 'SAVE', exact: true }).last().click();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  const puts = calls.slice(before).filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 1);
  return { sent: puts[0].body.configuration, hint, confirmText };
}

try {
  for (const key of Object.keys(SERVERS)) {
    const server = SERVERS[key];
    const { context, page, calls } = await contextFor(key, { width: 1440, height: 1000 });

    // --- Sessions: scope labels and filter --------------------------------
    await openSessions(page);

    // --- Failed queue items beside the queue (operator DB only) ---------------
    const failedLinks = page.locator('a[href="#/reasoning?status=failed"]');
    if (key === '3.5.0') {
      await failedLinks.first().waitFor({ timeout: 10000 });
      const texts = (await failedLinks.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
      assert.deepEqual(texts.sort(), ['2 · review', '· 2 failed'], 'sidebar and status bar both show the count');
    } else {
      await page.waitForTimeout(500);
      assert.equal(await failedLinks.count(), 0, `${key}: no failed count without the operator DB`);
    }
    const sessionLists = calls.filter((c) => c.path === `${W}/sessions/list`);
    assert.ok(sessionLists.length > 0);
    assert.equal(sessionLists.some((c) => c.query.includes('include_scopes=true')), server.scopes, `${key}: include_scopes only on 3.5`);
    // Chips uppercase with CSS; compare the text itself.
    const chips = await page.getByText(/^SCOPE · /).evaluateAll((els) => els.map((el) => el.textContent.trim()));
    assert.deepEqual(chips.sort(), server.scopes ? ['SCOPE · billing', 'SCOPE · billing', 'SCOPE · exports'] : [], `${key}: scope chips`);
    const scopeSelect = page.getByText('scope:', { exact: true });
    assert.equal(await scopeSelect.count(), server.scopes ? 1 : 0, `${key}: scope filter shown only with scopes`);
    if (server.scopes) {
      await shot(page, `${key}-sessions`);
      await scopeSelect.locator('xpath=following-sibling::*[1]').click();
      await page.getByRole('option', { name: 'in no scope' }).click();
      await sessionRowsAre(page, ['session-2']);
      await scopeSelect.locator('xpath=following-sibling::*[1]').click();
      await page.getByRole('option', { name: 'exports', exact: true }).click();
      await sessionRowsAre(page, ['session-3']);
      await scopeSelect.locator('xpath=following-sibling::*[1]').click();
      await page.getByRole('option', { name: 'any scope or none' }).click();
    }

    // --- Message line: CITED_BY -------------------------------------------
    await page.locator('button', { hasText: 'session-1@' }).first().click();
    const line = page.locator('li[data-message-id="m1"]');
    await line.waitFor();
    await line.click();
    const citedBy = line.getByRole('button', { name: 'CITED_BY' });
    assert.equal(await citedBy.count(), server.citations ? 1 : 0, `${key}: CITED_BY only with citations`);
    if (server.citations) {
      await citedBy.click();
      const panel = line.getByRole('region', { name: 'Conclusions citing this message' });
      await panel.getByText('2 conclusions cite this message', { exact: false }).waitFor();
      assert.ok(calls.some((c) => c.path === `${W}/conclusions/list` && c.body?.filters?.source_message_ids?.contains === 'm1'));
      // Clicking inside the list must not close the message line.
      await panel.getByText('Alice prefers tea to coffee.').click();
      assert.equal(await line.getByRole('region', { name: 'Conclusions citing this message' }).count(), 1, 'line stays open');
      await shot(page, `${key}-cited-by`);
      // INSPECT opens the inspector; clicks inside the modal must not close the line either.
      await panel.getByRole('button', { name: 'Inspect conclusion c2' }).click();
      await dialog(page).getByText('[ CITED_MESSAGES ]', { exact: true }).waitFor();
      await dialog(page).getByText('Messages the deriver cited', { exact: false }).click();
      await dialog(page).getByRole('button', { name: 'CLOSE', exact: true }).click();
      assert.equal(await line.getByRole('region', { name: 'Conclusions citing this message' }).count(), 1, 'line survives the modal');
    }

    // --- Conclusions: cited count and inspector ---------------------------
    await page.goto(`${base}/#/conclusions`);
    await page.getByText('Alice drinks tea every morning.').first().waitFor();
    assert.equal(await page.getByText('1 cited message', { exact: false }).count(), server.citations ? 1 : 0, `${key}: cited count on rows`);
    await page.getByRole('button', { name: 'PROVENANCE' }).first().click();
    await dialog(page).getByText('[ CONCLUSION ]', { exact: true }).waitFor();
    assert.equal(await dialog(page).getByText('[ CITED_MESSAGES ]', { exact: true }).count(), server.citations ? 1 : 0, `${key}: CITED_MESSAGES panel`);
    if (server.citations) {
      await dialog(page).getByText('I drink tea every morning.').waitFor();
      assert.ok(calls.some((c) => c.method === 'GET' && c.path === `${W}/sessions/session-1/messages/m1`), 'non-creating message read');
      await shot(page, `${key}-cited-messages`);
    }
    await dialog(page).getByRole('button', { name: 'CLOSE', exact: true }).click();

    // --- Scopes: counts and bulk removal -----------------------------------
    await page.goto(`${base}/#/scopes`);
    await page.getByText('[ SCOPE_REGISTRY ]', { exact: true }).waitFor();
    const scopeLists = calls.filter((c) => c.path === `${W}/scopes/list`);
    assert.equal(scopeLists.some((c) => c.query.includes('include_session_count=true')), server.scopes, `${key}: include_session_count only on 3.5`);
    assert.equal(await page.getByText('2 SESSIONS', { exact: true }).count(), server.scopes ? 1 : 0, `${key}: registry count`);
    await page.locator('li, div').filter({ hasText: /^session-3$/ }).first().waitFor().catch(() => {});
    const boxes = page.getByRole('checkbox', { name: /Select session-\d for removal/ });
    assert.equal(await boxes.count(), server.scopes ? 2 : 0, `${key}: bulk selection only on 3.5`);
    if (server.scopes) {
      await boxes.nth(0).check();
      await boxes.nth(1).check();
      await page.getByRole('button', { name: 'REMOVE_2', exact: true }).click();
      await dialog(page).getByText('Remove 2 sessions from scope', { exact: false }).waitFor();
      await shot(page, `${key}-scope-bulk-remove`);
      await dialog(page).getByRole('button', { name: 'REMOVE_2', exact: true }).click();
      await page.getByText('2 sessions removed from scope').waitFor();
      const removes = calls.filter((c) => c.path === `${W}/scopes/billing/sessions/remove`);
      assert.equal(removes.length, 1, 'one request for both');
      assert.deepEqual([...removes[0].body.session_ids].sort(), ['session-1', 'session-3']);
    } else {
      assert.ok(await page.getByRole('button', { name: 'REMOVE', exact: true }).count() > 0, 'per-row removal stays');
    }

    // --- Workspace configuration: replace vs merge --------------------------
    const edited = { custom_instructions: 'Write plainly.', dream: { enabled: false } }; // extra_flag removed
    const { sent, hint, confirmText } = await saveConfigFromJson(page, calls, edited);
    if (server.replaces) {
      assert.deepEqual(sent, edited, `${key}: a replacing server gets exactly the configuration`);
      assert.match(hint, /removed key is deleted/);
      assert.match(confirmText, /replaces the stored configuration/);
    } else {
      assert.deepEqual(sent, { ...edited, extra_flag: {} }, `${key}: a merging server gets the cleared key spelled out`);
      assert.match(hint, /saved as empty/);
      assert.doesNotMatch(confirmText, /replaces the stored configuration/);
    }
    await context.close();
    console.log(`${key}: ok`);
  }

  // --- Phone layout on 3.5 ----------------------------------------------------
  {
    const { context, page } = await contextFor('3.5.0', { width: 390, height: 844 });
    await openSessions(page);
    await noOverflow(page, 'phone sessions');
    await shot(page, 'phone-sessions');
    await page.goto(`${base}/#/scopes`);
    await page.getByText('[ SCOPE_REGISTRY ]', { exact: true }).waitFor();
    await page.getByRole('checkbox', { name: /Select session-1 for removal/ }).waitFor();
    await noOverflow(page, 'phone scopes');
    await shot(page, 'phone-scopes');
    await context.close();
  }

  assert.deepEqual(unexpected, [], 'every request was in the fixture');
  assert.deepEqual(errors, [], 'no page errors');
  assert.deepEqual(overflows, [], 'no horizontal overflow');
  console.log(`honcho 3.5 UI checks passed${captures ? `; screenshots in ${output}` : ''}`);
} finally {
  await browser.close();
}
