// Synthetic browser checks for Honcho 3.4 support and the Hombre-derived
// features (workspace export/import, streaming chat, peer compare, conclusion
// trash, status bar sync). Every data request is intercepted; nothing can reach
// a real Honcho server, operator DB, or another origin.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.DASHBOARD_TEST_URL ?? 'http://127.0.0.1:3108';
const output = process.env.DASHBOARD_TEST_OUTPUT ?? '/tmp/honcho34-dashboard-review';
const captures = process.env.DASHBOARD_TEST_CAPTURES !== '0';
await mkdir(output, { recursive: true });

const date = '2026-10-20T16:00:00Z';
const pageOf = (items) => ({ items, total: items.length, page: 1, size: 50, pages: 1 });
const WS = 'synthetic-workspace';
const KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJ3Ijoic3ludGhldGljIn0.c3ludGhldGljLXNpZ25hdHVyZQ';

function fixture(version) {
  const uid = version === '3.4.0';
  const withUid = (obj, value) => (uid ? { ...obj, uid: value } : obj);
  const ws = withUid({ id: WS, metadata: { team: 'demo' }, configuration: {}, created_at: date }, 'ws-uid-0001');
  const peers = [
    withUid({ id: 'alice', workspace_id: WS, metadata: {}, configuration: { observe_me: true }, created_at: date }, 'peer-uid-alice'),
    withUid({ id: 'assistant', workspace_id: WS, metadata: {}, configuration: { observe_me: false }, created_at: date }, 'peer-uid-assistant'),
  ];
  const session = withUid({ id: 'session-1', workspace_id: WS, metadata: {}, configuration: {}, is_active: true, created_at: date }, 'session-uid-1');
  const messages = [
    { id: 'm1', workspace_id: WS, session_id: 'session-1', peer_id: 'alice', content: 'I drink tea every morning.', token_count: 6, metadata: {}, created_at: '2026-10-01T08:00:00Z' },
    { id: 'm2', workspace_id: WS, session_id: 'session-1', peer_id: 'assistant', content: 'Noted.', token_count: 2, metadata: {}, created_at: '2026-10-01T08:00:05Z' },
  ];
  const conclusions = [
    { id: 'c1', content: 'Alice drinks tea every morning.', observer_id: 'alice', observed_id: 'alice', session_id: 'session-1', level: 'explicit', source_ids: [], times_derived: 1, created_at: date },
    // Honcho's copy for recall inside scope "support".
    { id: 'c2', content: 'Alice drinks tea every morning.', observer_id: 'scope.support', observed_id: 'alice', session_id: 'session-1', level: 'explicit', source_ids: [], times_derived: 1, created_at: date },
  ];
  return { ws, peers, session, messages, conclusions };
}

const traceResult = {
  available: true, bytes_read: 2048, truncated: false, skipped: 0, malformed: 0, generated_at: date,
  entries: [{
    id: 'synthetic-dream-run', type: 'dream.specialist', schema_version: 2,
    metadata: { timestamp: date, source: '/honcho/synthetic', run_id: 'run-1', workspace_name: WS, specialist_type: 'deduction',
      observer: 'alice', observed: 'alice', outcome: 'success', success: true, iterations: 12, iteration_limit: 12,
      hit_iteration_limit: true, budget_line_enabled: true, write_window_used: true, tool_calls_count: 18,
      notes_added: 2, notes_replaced: 1, notes_removed: 0, new_conclusions_shown: 50, new_conclusions_remaining: 12, duration_ms: 4210 },
  }],
};

const browser = await chromium.launch({ headless: true });
const unexpected = [];
const errors = [];
const overflows = [];

async function contextFor(version, viewport) {
  const data = fixture(version);
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce', acceptDownloads: true });
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
    const W = `/v3/workspaces/${WS}`;
    if (path === '/openapi.json') return reply({ info: { version } });
    if (path === '/health') return reply({ status: 'ok' });
    if (path === '/deriver/metrics') return reply({ detail: 'No measurement' }, 404);
    if (path === '/v3/workspaces/list') return reply(pageOf([data.ws]));
    if (path === '/v3/workspaces' && method === 'POST') return reply(body?.id === WS ? data.ws : { id: body?.id, metadata: body?.metadata ?? {}, configuration: body?.configuration ?? {}, created_at: date });
    if (path === '/v3/keys' && method === 'POST') return reply({ key: KEY });
    if (path === '/v3/workspaces/copy-ws/peers') return reply({ id: body.id, workspace_id: 'copy-ws', metadata: body.metadata, configuration: body.configuration, created_at: date });
    if (path === '/v3/workspaces/copy-ws/sessions') return reply({ id: body.id, workspace_id: 'copy-ws', metadata: {}, configuration: {}, is_active: true, created_at: date });
    if (path === '/v3/workspaces/copy-ws/sessions/session-1/messages') return reply(body.messages.map((m, i) => ({ ...m, id: `new-${i}`, session_id: 'session-1', workspace_id: 'copy-ws', token_count: 1 })));
    if (path === '/v3/workspaces/copy-ws/scopes') return reply({ id: body.id, metadata: {}, created_at: date });
    if (path === '/v3/workspaces/copy-ws/scopes/support') return reply({ id: 'support', metadata: {}, created_at: date });
    if (path === '/v3/workspaces/copy-ws/scopes/support/sessions') return reply({});
    if (path === `${W}/peers/list`) return reply(pageOf(data.peers));
    if (path === `${W}/peers` && method === 'POST') return reply(data.peers.find((p) => p.id === body?.id) ?? data.peers[0]);
    if (/\/peers\/[^/]+\/card$/.test(path)) return reply({ peer_card: path.includes('alice') ? ['Drinks tea every morning'] : null });
    if (/\/peers\/[^/]+\/representation$/.test(path)) {
      return reply({ representation: body?.target ? `${path.split('/').at(-2)} has seen ${body.target} talk about tea.` : '- Drinks tea every morning' });
    }
    if (/\/peers\/[^/]+\/sessions$/.test(path)) return reply(pageOf([data.session]));
    if (path === `${W}/peers/alice/chat`) {
      if (!body?.stream) return reply({ content: 'Alice drinks tea every morning.' });
      const chunks = ['Alice ', 'drinks tea ', 'every morning.'].map((c) => `data: ${JSON.stringify({ done: false, delta: { content: c } })}\n\n`);
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: chunks.join('') + `data: ${JSON.stringify({ done: true, delta: {} })}\n\n` });
    }
    if (path === `${W}/sessions/list`) return reply(pageOf([data.session]));
    if (path === `${W}/sessions` && method === 'POST') return reply(data.session);
    if (path === `${W}/sessions/session-1/peers`) return reply(pageOf(data.peers));
    if (/\/sessions\/session-1\/peers\/[^/]+\/config$/.test(path)) return reply({ observe_me: path.includes('alice'), observe_others: false });
    if (path === `${W}/sessions/session-1/messages/list`) return reply(pageOf(data.messages));
    if (path === `${W}/sessions/session-1/summaries`) return reply({ id: 'session-1', short_summary: null, long_summary: null });
    if (path === `${W}/conclusions/list`) {
      const f = body?.filters;
      const scopeObservers = f?.observer_id?.in ?? f?.NOT?.[0]?.observer_id?.in;
      const items = !scopeObservers ? data.conclusions
        : f.NOT ? data.conclusions.filter((c) => !scopeObservers.includes(c.observer_id))
        : data.conclusions.filter((c) => scopeObservers.includes(c.observer_id));
      return reply(pageOf(items));
    }
    if (path === `${W}/conclusions/c1` && method === 'DELETE') return route.fulfill({ status: 204, body: '' });
    if (path === `${W}/conclusions` && method === 'POST') return reply(body.conclusions.map((c, i) => ({ ...c, id: `restored-${i}`, level: 'explicit', created_at: date })), 201);
    if (path === `${W}/scopes/list`) return reply(pageOf([{ id: 'support', metadata: {}, created_at: date }]));
    if (path === `${W}/scopes/support/sessions/list`) return reply(pageOf([data.session]));
    if (path === `${W}/scopes/support/status`) return reply({ id: 'support', backfill_status: {} });
    if (path === `${W}/queue/status`) return reply({ total_work_units: 40, completed_work_units: 30, in_progress_work_units: 2, pending_work_units: 8 });
    if (path === `${W}/webhooks`) return reply(pageOf([]));
    if (path === '/api/operator/traces') return reply(traceResult);
    if (path === '/api/operator/logs') {
      return reply({ available: true, source: '/var/log/honcho/synthetic.log', size: 300, truncated: false, read_at: date, entries: [
        { id: '0', offset: 0, timestamp: '2026-10-20T16:00:00.000Z', level: 'info', source: 'src.deriver', message: 'Processed 3 work units' },
        { id: '40', offset: 40, timestamp: '2026-10-20T16:00:01.000Z', level: 'error', source: 'src.llm', message: 'Provider timeout after 30s' },
        { id: '80', offset: 80, timestamp: '2026-10-20T16:00:02.000Z', level: 'info', message: '172.25.0.1 - "POST /v3/workspaces/synthetic-workspace/sessions HTTP/1.1" 201' },
      ] });
    }
    if (path === '/api/operator/diagnostics') {
      return reply({ generated_at: date, probes: [
        { id: 'db.schema_revision', category: 'database', label: 'schema revision', status: 'ok', message: `a5f8da8f6d23 · matches server ${version}` },
        { id: 'db.invalid_indexes', category: 'database', label: 'index validity', status: 'warn', message: 'INVALID: ix_queue_pending_observed. A concurrent build failed or timed out; Honcho\'s next migration run drops and rebuilds its own indexes.' },
      ] });
    }
    if (path === '/api/operator/db') return reply({ available: false, reason: 'Synthetic test has no operator DB' });
    if (path.startsWith('/api/operator/')) return reply({ available: false, entries: [], reason: 'Synthetic test' });
    unexpected.push(`${method} ${path}`);
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${version} ${e.message}`));
  return { context, page, calls };
}

async function shot(page, name) {
  await page.waitForTimeout(300);
  if (captures) await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) overflows.push(name);
}
const panel = (title) => `[ ${title} ]`;
const confirmWith = (page, label) => page.getByRole('dialog').last().getByRole('button', { name: label, exact: true }).click();

// --- Honcho 3.4.0, desktop -------------------------------------------------
{
  const { context, page, calls } = await contextFor('3.4.0', { width: 1440, height: 1000 });

  // uid on workspace cards, and export to JSON.
  await page.goto(`${base}/#/workspaces`);
  await page.getByText('ws-uid-0001').waitFor();
  await page.getByText('8 pending').first().waitFor();
  await page.getByText('30/40 done · 2 running').first().waitFor();
  await shot(page, '34-workspaces');
  await page.getByRole('button', { name: `Export workspace ${WS}` }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'EXPORT_JSON' }).click(),
  ]);
  const snapshotText = await readFile(await download.path(), 'utf8');
  const snapshot = JSON.parse(snapshotText);
  assert.equal(snapshot.format, 'honcho-dashboard.workspace');
  assert.equal(snapshot.workspace.uid, 'ws-uid-0001');
  assert.equal(snapshot.source.honcho_version, '3.4.0');
  assert.deepEqual(snapshot.sessions[0].peers[0], { id: 'alice', config: { observe_me: true, observe_others: false } });
  assert.equal(snapshot.sessions[0].messages.length, 2);
  assert.deepEqual(snapshot.scopes, [{ id: 'support', metadata: {}, sessions: ['session-1'] }]);
  assert.ok(!snapshotText.includes('synthetic.invalid'), 'export must not embed the instance URL');
  assert.equal(calls.filter((c) => c.method !== 'GET' && !/\/list$|\/representation$|\/chat$/.test(c.path) && c.path !== '/v3/workspaces').length, 0, 'export wrote something');
  await page.getByRole('dialog').getByText('Saved honcho-workspace-').waitFor();
  await shot(page, '34-export');
  await page.getByRole('dialog').getByRole('button', { name: 'CLOSE', exact: true }).click();

  // Import the export into a new workspace.
  await page.getByRole('button', { name: 'IMPORT', exact: true }).click();
  await page.setInputFiles('input[aria-label="Choose a workspace export"]', { name: 'snapshot.json', mimeType: 'application/json', buffer: Buffer.from(snapshotText) });
  await page.getByRole('dialog').getByText('dashboard snapshot', { exact: false }).waitFor();
  await page.getByLabel('Target workspace').fill('copy-ws');
  await page.getByRole('button', { name: 'PREVIEW' }).click();
  await page.getByRole('dialog').getByText('Nothing has been written yet.').waitFor();
  await shot(page, '34-import-preview');
  const beforeImport = calls.length;
  await page.getByRole('button', { name: 'RUN_IMPORT' }).click();
  await confirmWith(page, 'IMPORT');
  await page.getByRole('dialog').getByText('COMPLETE', { exact: true }).waitFor();
  await shot(page, '34-import-result');
  const writes = calls.slice(beforeImport).filter((c) => c.method === 'POST' && !/\/list$/.test(c.path));
  const create = writes.find((c) => c.path === '/v3/workspaces');
  assert.deepEqual(create.body, { id: 'copy-ws', metadata: { team: 'demo' }, configuration: {} });
  const sessionCreate = writes.find((c) => c.path === '/v3/workspaces/copy-ws/sessions');
  assert.deepEqual(sessionCreate.body.peers, { alice: { observe_me: true, observe_others: false }, assistant: { observe_me: false, observe_others: false } });
  const messageWrite = writes.find((c) => c.path.endsWith('/copy-ws/sessions/session-1/messages'));
  assert.equal(messageWrite.body.messages[0].created_at, '2026-10-01T08:00:00Z');
  const order = writes.map((c) => c.path.replace('/v3/workspaces/copy-ws', '~'));
  assert.ok(order.indexOf('~/scopes/support/sessions') < order.indexOf('~/sessions/session-1/messages'), 'scope enrollment must precede messages');
  await page.getByRole('dialog').getByRole('button', { name: 'CLOSE', exact: true }).click();

  // Named-scope key.
  await page.goto(`${base}/#/scopes`);
  await page.getByText(panel('SCOPE_KEY')).waitFor();
  await page.getByRole('button', { name: 'MINT_SCOPE_KEY' }).click();
  await confirmWith(page, 'MINT_KEY');
  await page.getByLabel('Scope key for support').waitFor();
  const mint = calls.find((c) => c.path === '/v3/keys');
  const query = new URLSearchParams(mint.query);
  assert.equal(query.get('workspace_id'), WS);
  assert.equal(query.get('scope_id'), 'support');
  assert.ok(Date.parse(query.get('expires_at')) > Date.now());
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  assert.ok(!stored.includes(KEY), 'minted key must not be persisted');
  await shot(page, '34-scope-key');

  // Streaming chat.
  await page.goto(`${base}/#/chat?peer=alice`);
  await page.getByPlaceholder('ask alice…').fill('What does Alice drink?');
  await page.keyboard.press('Enter');
  await page.getByText('Alice drinks tea every morning.').waitFor();
  const chat = calls.find((c) => c.path.endsWith('/peers/alice/chat'));
  assert.equal(chat.body.stream, true);
  // Evidence is on by default where the server supports it (3.2+).
  assert.equal(chat.body.include_evidence, true);
  await shot(page, '34-chat-stream');

  // Rows start closed; opening one shows its uid and card. A peer link opens its row.
  await page.goto(`${base}/#/peers`);
  await page.locator('main button[aria-controls]', { hasText: 'alice' }).first().click();
  await page.getByText('Drinks tea every morning', { exact: true }).first().waitFor();
  await page.getByText('peer-uid-alice').waitFor();
  await page.getByRole('button', { name: 'COMPARE' }).click();
  await page.getByText(panel('PEER_COMPARE')).waitFor();
  await page.getByText('alice has seen assistant talk about tea.').waitFor();
  await page.getByText('assistant has seen alice talk about tea.').waitFor();
  await page.getByText('SHARED_SESSIONS (1)').waitFor();
  await shot(page, '34-peer-compare');

  // Scope copies are labeled and filtered on the server.
  await page.goto(`${base}/#/conclusions`);
  await page.getByText('SCOPE · support').waitFor();
  const beforeFilter = calls.length;
  await page.getByRole('button', { name: 'PEER_MEMORY' }).click();
  await page.getByText('SCOPE · support').waitFor({ state: 'detached' });
  const peerFilter = calls.slice(beforeFilter).find((c) => c.path === `/v3/workspaces/${WS}/conclusions/list`);
  assert.deepEqual(peerFilter.body.filters, { NOT: [{ observer_id: { in: ['scope.support'] } }] });
  await page.getByRole('button', { name: 'ALL', exact: true }).click();
  await page.getByText('SCOPE · support').waitFor();
  await shot(page, '34-scope-copies');

  // Conclusion trash: delete, then restore.
  await page.getByRole('button', { name: 'Delete conclusion' }).first().click();
  await confirmWith(page, 'DELETE');
  await page.getByText(panel('TRASH')).waitFor();
  await page.getByRole('button', { name: 'RESTORE', exact: true }).click();
  await confirmWith(page, 'RESTORE');
  await page.getByText(panel('TRASH')).waitFor({ state: 'detached' });
  const restore = calls.find((c) => c.method === 'POST' && c.path === `/v3/workspaces/${WS}/conclusions`);
  assert.deepEqual(restore.body, { conclusions: [{ content: 'Alice drinks tea every morning.', observer_id: 'alice', observed_id: 'alice', session_id: 'session-1' }] });

  // Status bar SCHEDULE_DREAM opens the dream modal.
  await page.getByRole('link', { name: 'SCHEDULE_DREAM' }).click();
  await page.getByRole('dialog').getByText(panel('SCHEDULE_DREAM')).or(page.getByRole('dialog', { name: /SCHEDULE_DREAM/ })).first().waitFor();
  await page.keyboard.press('Escape');

  // Diagnostics: schema probes and agent-run telemetry.
  await page.goto(`${base}/#/diagnostics`);
  await page.getByText('index validity').waitFor();
  await page.getByText('ITERATION_LIMIT').waitFor();
  await page.getByText('Provider timeout after 30s').waitFor();
  await page.getByRole('button', { name: /^ERROR 1$/ }).click();
  await page.getByText('Provider timeout after 30s').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: /^ERROR 1$/ }).click();
  await page.getByLabel('Filter log lines').fill('sessions');
  await page.getByText('Processed 3 work units').waitFor({ state: 'detached' });
  await page.getByText(/POST \/v3\/workspaces\/synthetic-workspace\/sessions/).waitFor();
  await page.getByLabel('Filter log lines').fill('');
  await page.getByText('1 of 1 hit the iteration limit', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Inspect run synthetic-dream-run' }).click();
  await page.getByRole('dialog').getByText('WORKING_NOTES').waitFor();
  await shot(page, '34-diagnostics');
  await context.close();
}

// --- Honcho 3.3.0: 3.4-only UI stays hidden ---------------------------------
{
  const { context, page, calls } = await contextFor('3.3.0', { width: 1440, height: 1000 });
  await page.goto(`${base}/#/workspaces`);
  await page.getByText(panel(WS.toUpperCase())).waitFor();
  assert.equal(await page.getByText('ws-uid-0001').count(), 0);
  await page.goto(`${base}/#/scopes`);
  await page.getByText('Named-scope keys requires Honcho 3.4+', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'MINT_SCOPE_KEY' }).count(), 0);
  assert.equal(calls.some((c) => c.path === '/v3/keys'), false);
  await shot(page, '33-scopes');
  await context.close();
}

// --- Mobile layout ----------------------------------------------------------
{
  const { context, page } = await contextFor('3.4.0', { width: 390, height: 844 });
  for (const route of ['workspaces', 'scopes', 'chat', 'conclusions', 'diagnostics']) {
    await page.goto(`${base}/#/${route}`);
    await page.waitForLoadState('networkidle');
    await shot(page, `mobile-${route}`);
  }
  await page.goto(`${base}/#/peers`);
  await page.getByRole('button', { name: 'COMPARE' }).click();
  await page.getByText(panel('PEER_COMPARE')).waitFor();
  await shot(page, 'mobile-peer-compare');
  await context.close();
}

await browser.close();
assert.deepEqual(unexpected, [], `unexpected requests: ${unexpected.join(', ')}`);
assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
assert.deepEqual(overflows, [], `horizontal overflow: ${overflows.join(', ')}`);
console.log(`honcho34 UI checks passed${captures ? ` · screenshots in ${output}` : ''}`);
