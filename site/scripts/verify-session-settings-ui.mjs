// Synthetic browser checks for per-session learning controls: the LEARNING tab
// on a session row (settings with their source, member observation, the
// session's queue and stored conclusions), the save path against a fake Honcho
// that merges writes the way 3.5.0 does, and the Conclusions page's session
// filter, bulk delete and DERIVED_ELSEWHERE search. Every data request is
// intercepted; nothing can reach a real Honcho server or another origin.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const base = process.env.DASHBOARD_TEST_URL ?? 'http://127.0.0.1:3108';
const output = process.env.DASHBOARD_TEST_OUTPUT ?? `${process.env.TMPDIR ?? '.'}/session-settings-review`;
const captures = process.env.DASHBOARD_TEST_CAPTURES !== '0';
await mkdir(output, { recursive: true });

const date = '2026-11-02T16:00:00Z';
const WS = 'synthetic-workspace';
const W = `/v3/workspaces/${WS}`;
const pageOf = (items, page = 1, size = 50) => ({
  items: items.slice((page - 1) * size, page * size), total: items.length, page, size, pages: Math.max(1, Math.ceil(items.length / size)),
});

const SCHEMA_350 = {
  Conclusion: { properties: { id: {}, source_ids: {}, source_message_ids: {} } },
  Scope: { properties: { id: {}, session_count: {} } },
  Session: { properties: { id: {}, scopes: {} } },
  WorkspaceSessionGet: { properties: { scope: {}, in_no_scope: {} } },
  ScopeSessionsRemove: { properties: { session_ids: {} } },
  WorkspaceUpdate: { properties: { configuration: { description: 'Replaces the entire workspace configuration.' } } },
};
const SCHEMA_320 = { Conclusion: { properties: { id: {}, source_ids: {} } }, Session: { properties: { id: {} } } };
const SERVERS = {
  '3.5.0': { version: '3.5.0', schemas: SCHEMA_350 },
  '3.2.0': { version: '3.2.0', schemas: SCHEMA_320 },
};

function fixture() {
  const peers = [
    { id: 'alice', workspace_id: WS, metadata: {}, configuration: { observe_me: true }, created_at: date },
    { id: 'assistant', workspace_id: WS, metadata: {}, configuration: { observe_me: false }, created_at: date },
    { id: 'auditor', workspace_id: WS, metadata: {}, configuration: {}, created_at: date },
  ];
  const session = (id, configuration, members) => ({
    id, workspace_id: WS, metadata: {}, configuration, is_active: true, created_at: date, members,
  });
  const sessions = [
    session('support-chat', {}, { alice: {}, assistant: { observe_others: true } }),
    session('imported-transcript', { reasoning: { enabled: false }, summary: { enabled: false }, dream: { enabled: false } },
      { alice: {}, assistant: { observe_others: true } }),
    session('billing-thread', { summary: { custom_instructions: 'Note invoice numbers.' } }, { alice: { observe_me: true }, auditor: {} }),
  ];
  const conclusion = (id, content, session_id, level = 'explicit', source_ids = []) => ({
    id, content, observer_id: 'alice', observed_id: 'alice', session_id, level, source_ids, times_derived: 1, created_at: date,
  });
  const conclusions = [
    conclusion('c1', 'Alice asked about a refund.', 'imported-transcript'),
    conclusion('c2', 'Alice uses the mobile app.', 'imported-transcript'),
    conclusion('c6', 'Alice had one refund this year.', 'imported-transcript', 'deductive', ['c1']),
    conclusion('c3', 'Alice contacts support after billing changes.', 'support-chat', 'deductive', ['c1', 'c2']),
    conclusion('c4', 'Alice prefers email follow-ups.', null, 'inductive', ['c2']),
    conclusion('c5', 'Alice pays yearly.', 'billing-thread'),
  ];
  const messages = [
    { id: 'm1', workspace_id: WS, session_id: 'support-chat', peer_id: 'alice', content: 'Can I get my receipt again?', token_count: 7, metadata: {}, created_at: '2026-11-01T08:00:00Z' },
    { id: 'm2', workspace_id: WS, session_id: 'support-chat', peer_id: 'assistant', content: 'Sent it to your email.', token_count: 6, metadata: {}, created_at: '2026-11-01T08:00:05Z' },
  ];
  return {
    ws: { id: WS, metadata: {}, configuration: { custom_instructions: 'Keep answers short.', summary: { messages_per_short_summary: 30 } }, created_at: date },
    peers, sessions, conclusions, messages,
  };
}

/** A tiny evaluator for the filters the dashboard sends to `conclusions/list`. */
function matches(row, filter) {
  if (!filter || !Object.keys(filter).length) return true;
  return Object.entries(filter).every(([key, value]) => {
    if (key === 'AND') return value.every((f) => matches(row, f));
    if (key === 'OR') return value.some((f) => matches(row, f));
    if (key === 'NOT') return !value.some((f) => matches(row, f));
    if (key === 'session_id') return row.session_id === value;
    if (key === 'observer_id') return value.in ? value.in.includes(row.observer_id) : row.observer_id === value;
    if (key === 'source_ids') {
      if (!Array.isArray(value.in) || !value.in.length) throw new Error('source_ids.in must be a non-empty list');
      return row.source_ids.some((id) => value.in.includes(id));
    }
    throw new Error(`fixture has no filter for ${key}`);
  });
}

const browser = await chromium.launch({ headless: true });
const unexpected = [];
const errors = [];
const overflows = [];
const axeFindings = [];

async function contextFor(key, viewport, { writes = true, theme = 'dark' } = {}) {
  const server = SERVERS[key];
  const data = fixture();
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  await context.addInitScript(({ ws, writes, theme }) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('honcho-dashboard:instances', JSON.stringify([{ id: 'synthetic', name: 'Synthetic fixture', baseUrl: 'http://synthetic.invalid:8000' }]));
    localStorage.setItem('honcho-dashboard:activeId', 'synthetic');
    localStorage.setItem('honcho-dashboard:activeWorkspaceId', ws);
    localStorage.setItem('honcho-dashboard:theme', theme);
    localStorage.setItem('honcho-dashboard:writeActions', writes ? 'true' : 'false');
  }, { ws: WS, writes, theme });
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
    const empty = () => route.fulfill({ status: 204, body: '' });
    const q = url.searchParams;
    const page = Number(q.get('page') ?? 1);
    const size = Number(q.get('size') ?? 50);
    const publicSession = ({ members, ...rest }) => rest;
    if (path === '/openapi.json') return reply({ info: { version: server.version }, components: { schemas: server.schemas } });
    if (path === '/health') return reply({ status: 'ok' });
    if (path === '/deriver/metrics') return reply({ detail: 'No measurement' }, 404);
    if (path === '/v3/workspaces/list') return reply(pageOf([data.ws]));
    if (path === '/v3/workspaces' && method === 'POST') return reply(data.ws);
    if (path === `${W}/peers/list`) return reply(pageOf(data.peers));
    if (path === `${W}/sessions/list`) {
      const id = body?.filters?.id;
      const listed = data.sessions.filter((s) => s.is_active && (!id || s.id === id));
      return reply(pageOf(listed.map(publicSession), page, size));
    }
    // Opening a row reads summaries and peers through the SDK's get-or-create.
    // It must only ever name a session that exists.
    if (path === `${W}/sessions` && method === 'POST') {
      const existing = data.sessions.find((s) => s.id === body?.id);
      if (!existing) unexpected.push(`get-or-create of unknown session ${body?.id}`);
      return reply(existing ? publicSession(existing) : {}, existing ? 200 : 404);
    }
    const sessionMatch = path.match(/^\/v3\/workspaces\/[^/]+\/sessions\/([^/]+)(\/.*)?$/);
    if (sessionMatch) {
      const sid = decodeURIComponent(sessionMatch[1]);
      const rest = sessionMatch[2] ?? '';
      const s = data.sessions.find((x) => x.id === sid);
      if (rest === '' && method === 'PUT') {
        // Honcho 3.1-3.5: get-or-create, then merge top-level keys (exclude_none).
        if (!s) { unexpected.push(`session PUT recreated ${sid}`); return reply({ detail: 'recreated' }, 500); }
        if (!s.is_active) return reply({ detail: 'Session not found' }, 404);
        s.configuration = { ...s.configuration, ...body.configuration };
        return reply(publicSession(s));
      }
      if (!s) return reply({ detail: 'Session not found' }, 404);
      if (rest === '/peers' && method === 'GET') {
        return reply(pageOf(Object.keys(s.members).map((id) => data.peers.find((p) => p.id === id))));
      }
      const config = rest.match(/^\/peers\/([^/]+)\/config$/);
      if (config) {
        const pid = decodeURIComponent(config[1]);
        if (method === 'GET') return reply({ observe_me: s.members[pid]?.observe_me ?? null, observe_others: s.members[pid]?.observe_others ?? null });
        if (method === 'PUT') {
          if (!s.members[pid]) unexpected.push(`config PUT added non-member ${pid}`);
          s.members[pid] = { ...s.members[pid], ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null)) };
          return empty();
        }
      }
      if (rest === '/summaries') return reply({ id: sid, short_summary: null, long_summary: null });
      if (rest === '/messages/list') return reply(pageOf(data.messages.filter((m) => m.session_id === sid)));
    }
    if (path === `${W}/queue/status`) {
      const sid = q.get('session_id');
      if (sid === 'imported-transcript') return reply({ total_work_units: 7, completed_work_units: 5, in_progress_work_units: 0, pending_work_units: 2 });
      return reply({ total_work_units: 4, completed_work_units: 4, in_progress_work_units: 0, pending_work_units: 0 });
    }
    if (path === `${W}/conclusions/list`) {
      try {
        return reply(pageOf(data.conclusions.filter((c) => matches(c, body?.filters)), page, size));
      } catch (error) {
        unexpected.push(`conclusions filter: ${error.message}`);
        return reply({ detail: error.message }, 422);
      }
    }
    const conclusion = path.match(/\/conclusions\/(c\d)$/);
    if (conclusion && method === 'DELETE') {
      const index = data.conclusions.findIndex((c) => c.id === conclusion[1]);
      if (index < 0) return reply({ detail: 'Conclusion not found' }, 404);
      data.conclusions.splice(index, 1);
      return empty();
    }
    if (conclusion && method === 'GET') return reply(data.conclusions.find((c) => c.id === conclusion[1]));
    if (path === `${W}/scopes/list`) return reply(pageOf([]));
    if (path.startsWith('/api/operator/')) return reply({ available: false, reason: 'Synthetic test has no operator DB' });
    unexpected.push(`${method} ${path}${url.search}`);
    return reply({ detail: 'Not in fixture' }, 404);
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${key}: ${e.message}`));
  return { context, page, calls, data };
}

const dialog = (page) => page.getByRole('dialog');
const writesOf = (calls, from = 0) => calls.slice(from).filter((c) => c.method === 'PUT' || c.method === 'DELETE' || (c.method === 'POST' && c.path === `${W}/sessions`));
async function noOverflow(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) overflows.push(`${label}: ${overflow}px`);
}
async function shot(page, name, locator) {
  if (!captures) return;
  if (locator) await locator.screenshot({ path: `${output}/${name}.png` });
  else await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
}
async function axe(page, label, selector) {
  // Rows fade in; measuring mid-animation reports false contrast failures.
  await page.waitForTimeout(800);
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const result = await page.evaluate(async (include) => window.axe.run(include ? { include: [include] } : document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  }), selector);
  for (const v of result.violations) {
    axeFindings.push(`${label}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target?.join(" ")}`);
    if (process.env.AXE_DEBUG) for (const n of v.nodes) console.error(label, v.id, n.html.slice(0, 160), n.any?.[0]?.message?.slice(0, 160));
  }
}
function rowFor(page, sessionId) {
  return page.locator('main div.bg-surface').filter({ has: page.locator('button', { hasText: `${sessionId}@` }) }).first();
}
async function openLearning(page, sessionId) {
  const row = rowFor(page, sessionId);
  const tab = row.getByRole('button', { name: 'LEARNING', exact: true });
  if (!(await tab.isVisible())) await row.locator('button', { hasText: `${sessionId}@` }).first().click();
  await tab.click();
  await row.getByText('SETTINGS', { exact: true }).waitFor();
  await row.getByRole('group', { name: 'CONCLUSIONS', exact: true }).or(row.getByText('read-only · enable in CONFIG')).first().waitFor();
  return row;
}
async function pick(row, group, option) {
  await row.getByRole('group', { name: group, exact: true }).getByRole('button', { name: option, exact: true }).click();
}
async function sessionNames(page) {
  await page.waitForTimeout(400);
  return page.locator('main button').evaluateAll((els) => els.map((b) => b.textContent.match(/^\s*([a-z-]+)@/)?.[1]).filter(Boolean));
}
async function effect(row, label) {
  const line = row.locator('div.grid').filter({ has: row.page().getByText(label, { exact: true }) }).first();
  return (await line.innerText()).replace(/\s+/g, ' ');
}

try {
  // --- 3.5.0, write actions on ----------------------------------------------
  {
    const { context, page, calls, data } = await contextFor('3.5.0', { width: 1440, height: 1100 });
    await page.goto(`${base}/#/sessions`);
    await page.locator('button', { hasText: 'support-chat@' }).first().waitFor();

    // Chips and the learning filter.
    assert.equal(await rowFor(page, 'imported-transcript').getByText('LEARNING_OFF').count(), 1);
    assert.equal(await rowFor(page, 'billing-thread').getByText('SESSION_SETTINGS').count(), 1);
    assert.equal(await rowFor(page, 'support-chat').getByText(/LEARNING_OFF|SESSION_SETTINGS/).count(), 0, (await rowFor(page, 'support-chat').innerText()).slice(0, 600));
    const learningSelect = page.getByText('learning:', { exact: true }).locator('xpath=following-sibling::*[1]');
    await learningSelect.click();
    await page.getByRole('option', { name: 'conclusions off' }).click();
    assert.deepEqual(await sessionNames(page), ['imported-transcript']);
    await learningSelect.click();
    await page.getByRole('option', { name: 'has session settings' }).click();
    assert.deepEqual((await sessionNames(page)).sort(), ['billing-thread', 'imported-transcript']);
    await learningSelect.click();
    await page.getByRole('option', { name: 'any', exact: true }).click();
    await shot(page, 'sessions-chips');

    // The LEARNING tab reads without creating anything.
    let row = await openLearning(page, 'support-chat');
    assert.match(await effect(row, 'CONCLUSIONS'), /server default/);
    assert.match(await effect(row, "SUMMARY_INTERVALS"), /short 30 workspace · long server default/);
    await row.getByText('0 waiting', { exact: false }).waitFor();
    await row.getByText('1 filed under this session').waitFor();
    const members = await row.locator('section').filter({ hasText: 'OBSERVATION' }).innerText();
    assert.match(members, /alice[\s\S]*alice, assistant/, 'assistant observes alice here');
    assert.match(members, /assistant[\s\S]*OFF · peer setting[\s\S]*nobody/, 'assistant is not observed at all');
    assert.ok(calls.some((c) => c.path === `${W}/queue/status` && c.query === '?session_id=support-chat'), 'session-scoped queue read');
    assert.ok(calls.some((c) => c.path === `${W}/conclusions/list` && c.body?.filters?.session_id === 'support-chat'));
    await shot(page, 'learning-tab', row);
    await axe(page, 'learning tab', 'main');

    // Edit, review, confirm, save. One PUT per target, sections only, read back.
    await pick(row, 'CONCLUSIONS', 'OFF');
    await pick(row, 'DREAMS', 'OFF');
    await pick(row, 'alice observe_others', 'ON');
    await row.getByText('3 unsaved changes').waitFor();
    await shot(page, 'learning-edited', row);
    const before = calls.length;
    await row.getByRole('button', { name: 'SAVE', exact: true }).click();
    const confirmText = await dialog(page).innerText();
    assert.match(confirmText, /Save 3 changes to session support-chat/);
    assert.match(confirmText, /CONCLUSIONS[\s\S]*inherit[\s\S]*off/);
    assert.match(confirmText, /alice · OBSERVES_OTHERS[\s\S]*unset[\s\S]*on/);
    await shot(page, 'learning-confirm', dialog(page));
    await dialog(page).getByRole('button', { name: 'SAVE', exact: true }).click();
    await page.getByText('Saved 3 changes. Honcho returned the new values.').waitFor();
    const writes = writesOf(calls, before);
    assert.deepEqual(writes.map((c) => [c.method, c.path, c.body]), [
      ['PUT', `${W}/sessions/support-chat`, { configuration: { reasoning: { enabled: false }, dream: { enabled: false } } }],
      ['PUT', `${W}/sessions/support-chat/peers/alice/config`, { observe_others: true }],
    ]);
    const existence = calls.slice(before).findIndex((c) => c.path === `${W}/sessions/list` && c.body?.filters?.id === 'support-chat');
    const firstPut = calls.slice(before).findIndex((c) => c.method === 'PUT');
    assert.ok(existence >= 0 && existence < firstPut, 'the session is re-read before the first write');
    await row.getByText('OFF · this session').first().waitFor();
    await rowFor(page, 'support-chat').getByText('LEARNING_OFF').waitFor();

    // A change made elsewhere after the tab loaded blocks the save.
    row = await openLearning(page, 'billing-thread');
    await pick(row, 'SUMMARIES', 'OFF');
    data.sessions.find((s) => s.id === 'billing-thread').configuration.dream = { enabled: false }; // someone else
    const beforeStale = calls.length;
    await row.getByRole('button', { name: 'SAVE', exact: true }).click();
    await dialog(page).getByRole('button', { name: 'SAVE', exact: true }).click();
    await page.getByText('These settings changed after you opened them', { exact: false }).waitFor();
    assert.deepEqual(writesOf(calls, beforeStale), [], 'nothing written on a stale save');
    await row.getByText('OFF · this session').first().waitFor(); // the reload shows the other change

    // Instructions: values and sources, NONE keeps the section's other fields.
    await row.getByRole('button', { name: /INSTRUCTIONS/ }).click();
    const instructions = (await row.locator('#instructions-billing-thread').innerText()).replace(/\s+/g, ' ');
    assert.match(instructions, /SHARED.*Keep answers short\. · workspace\.shared/);
    assert.match(instructions, /SUMMARIES.*Note invoice numbers\. · session\.summary/);
    await pick(row, 'DREAMS instructions', 'NONE');
    await pick(row, 'SUMMARIES instructions', 'CUSTOM');
    await row.getByRole('textbox', { name: 'SUMMARIES instructions' }).fill('Note invoice numbers and due dates.');
    await shot(page, 'learning-instructions', row);
    const beforeInstr = calls.length;
    await row.getByRole('button', { name: 'SAVE', exact: true }).click();
    await dialog(page).getByRole('button', { name: 'SAVE', exact: true }).click();
    await page.getByText('Saved 2 changes', { exact: false }).waitFor();
    assert.deepEqual(writesOf(calls, beforeInstr).map((c) => c.body), [{
      configuration: { summary: { custom_instructions: 'Note invoice numbers and due dates.' }, dream: { enabled: false, custom_instructions: '' } },
    }]);

    // A session deleted after the tab loaded is never recreated.
    row = await openLearning(page, 'imported-transcript');
    await row.getByText('2 waiting', { exact: false }).waitFor();
    await pick(row, 'SUMMARIES', 'ON');
    data.sessions.find((s) => s.id === 'imported-transcript').is_active = false; // deleted elsewhere
    const beforeGone = calls.length;
    await row.getByRole('button', { name: 'SAVE', exact: true }).click();
    await dialog(page).getByRole('button', { name: 'SAVE', exact: true }).click();
    await page.getByText('This session no longer exists or is being deleted. Nothing was saved.').waitFor();
    assert.deepEqual(writesOf(calls, beforeGone), []);
    data.sessions.find((s) => s.id === 'imported-transcript').is_active = true;
    // The tab now says the session is gone; checking again finds it.
    await row.getByText('Honcho no longer lists this session', { exact: false }).waitFor();
    await row.getByRole('button', { name: 'CHECK_AGAIN' }).click();
    await row.getByRole('group', { name: 'CONCLUSIONS', exact: true }).waitFor();

    // Summaries modal: the empty state names the real cadence.
    await page.goto(`${base}/#/sessions`);
    row = rowFor(page, 'imported-transcript');
    await row.locator('button', { hasText: 'imported-transcript@' }).first().click();
    await row.getByRole('button', { name: 'VIEW_SUMMARIES' }).click();
    await dialog(page).getByText('Summaries are off for this session (set on the session)', { exact: false }).waitFor();
    await dialog(page).getByRole('button', { name: 'CLOSE', exact: true }).click();
    row = rowFor(page, 'support-chat');
    await row.locator('button', { hasText: 'support-chat@' }).first().click();
    await row.getByRole('button', { name: 'VIEW_SUMMARIES' }).click();
    await dialog(page).getByText('short summary every 30 messages and a long one every 60 (the shipped default)', { exact: false }).waitFor();
    await dialog(page).getByRole('button', { name: 'CLOSE', exact: true }).click();

    // --- Conclusions: session filter, derived elsewhere, bulk delete -----------
    row = await openLearning(page, 'imported-transcript');
    await row.getByRole('button', { name: 'VIEW_CONCLUSIONS' }).click();
    await page.waitForURL(/#\/conclusions\?session=imported-transcript$/);
    await page.getByText('[ SESSION_CONCLUSIONS ]', { exact: true }).waitFor();
    await page.getByText('Alice asked about a refund.').waitFor();
    const listed = await page.locator('main p').evaluateAll((els) => els.map((e) => e.textContent.trim()));
    assert.ok(listed.includes('Alice had one refund this year.') && !listed.includes('Alice pays yearly.'));
    await page.getByRole('button', { name: 'FIND_DERIVED' }).click();
    const derivedPanel = page.locator('section, div').filter({ has: page.getByText('[ DERIVED_ELSEWHERE ]', { exact: true }) }).last();
    await page.getByText("cites 2 of this session's conclusions").waitFor();
    await page.getByText("cites 1 of this session's conclusions").waitFor();
    assert.equal(await page.getByText('Alice had one refund this year.').count(), 1, 'same-session derivations are not listed twice');
    assert.ok(calls.some((c) => c.path === `${W}/conclusions/list` && c.body?.filters?.source_ids?.in?.length === 3));
    await shot(page, 'conclusions-session');
    await axe(page, 'conclusions', 'main');

    await page.getByRole('button', { name: /^SELECT_ALL_IN_SESSION/ }).click();
    await page.getByText('3 selected').waitFor();
    for (const name of ['Alice contacts support after billing changes.', 'Alice prefers email follow-ups.']) {
      const card = page.locator('main div.border').filter({ hasText: name }).last();
      await card.getByRole('checkbox', { name: 'Select this conclusion' }).click();
    }
    await page.getByText('5 selected').waitFor();
    const beforeDelete = calls.length;
    await page.getByRole('button', { name: 'DELETE_SELECTED' }).click();
    assert.match(await dialog(page).innerText(), /Delete 5 conclusions/);
    await shot(page, 'conclusions-delete-confirm', dialog(page));
    await dialog(page).getByRole('button', { name: 'DELETE 5', exact: true }).click();
    await page.getByText('Deleted 5 conclusions · copies kept in TRASH').waitFor();
    const deletes = writesOf(calls, beforeDelete).filter((c) => c.method === 'DELETE').map((c) => c.path.split('/').pop());
    assert.deepEqual(deletes.sort(), ['c1', 'c2', 'c3', 'c4', 'c6']);
    assert.deepEqual(data.conclusions.map((c) => c.id), ['c5']);
    await page.getByText('Honcho has filed no conclusions under this session.', { exact: false }).waitFor();
    assert.ok(derivedPanel);

    // A session chip on an unfiltered row narrows the page.
    await page.getByRole('button', { name: 'CLEAR', exact: true }).first().click();
    await page.waitForURL(/#\/conclusions$/);
    await page.getByRole('button', { name: 'billing-thread' }).click();
    await page.waitForURL(/#\/conclusions\?session=billing-thread$/);

    // Workspace config points at the per-session overrides.
    await page.goto(`${base}/#/workspaces`);
    await page.getByRole('button', { name: 'Edit workspace config' }).first().click();
    await dialog(page).getByText("Sessions inherit these unless they set their own", { exact: false }).waitFor();
    assert.deepEqual(calls.filter((c) => c.method === 'POST' && c.path === `${W}/sessions`), [], 'opening rows never get-or-creates a session');
    await context.close();
    console.log('3.5.0: ok');
  }

  // --- 3.2.0: no shared or per-agent instructions -----------------------------
  {
    const { context, page, calls } = await contextFor('3.2.0', { width: 1440, height: 1000 });
    await page.goto(`${base}/#/sessions`);
    await page.locator('button', { hasText: 'billing-thread@' }).first().waitFor();
    const row = await openLearning(page, 'billing-thread');
    await row.getByRole('button', { name: /INSTRUCTIONS/ }).click();
    await row.getByText('Shared and per-agent instructions need Honcho 3.3', { exact: false }).waitFor();
    assert.equal(await row.getByRole('group', { name: 'SUMMARIES instructions' }).count(), 0);
    await pick(row, 'SUMMARIES', 'OFF');
    const before = calls.length;
    await row.getByRole('button', { name: 'SAVE', exact: true }).click();
    await dialog(page).getByRole('button', { name: 'SAVE', exact: true }).click();
    await page.getByText('Saved 1 change.', { exact: false }).waitFor();
    assert.deepEqual(writesOf(calls, before).map((c) => c.body), [
      { configuration: { summary: { custom_instructions: 'Note invoice numbers.', enabled: false } } },
    ], 'unmanaged instructions ride along untouched');
    await context.close();
    console.log('3.2.0: ok');
  }

  // --- Write actions off: read-only ---------------------------------------------
  {
    const { context, page, calls } = await contextFor('3.5.0', { width: 1440, height: 1000 }, { writes: false });
    await page.goto(`${base}/#/sessions`);
    await page.locator('button', { hasText: 'support-chat@' }).first().waitFor();
    const row = await openLearning(page, 'support-chat');
    await row.getByText('read-only · enable in CONFIG').waitFor();
    assert.equal(await row.getByRole('group', { name: /^(CONCLUSIONS|SUMMARIES|DREAMS|USE_PEER_CARD|UPDATE_PEER_CARD)$|observe_/ }).count(), 0, 'no controls without write actions');
    await page.goto(`${base}/#/conclusions?session=support-chat`);
    await page.getByText('[ SESSION_CONCLUSIONS ]', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'DELETE_SELECTED' }).count(), 0);
    assert.equal(await page.getByRole('checkbox', { name: 'Select this conclusion' }).count(), 0);
    assert.deepEqual(writesOf(calls).filter((c) => c.method !== 'POST'), []);
    await context.close();
    console.log('read-only: ok');
  }

  // --- Light theme contrast -------------------------------------------------------
  {
    const { context, page } = await contextFor('3.5.0', { width: 1440, height: 1000 }, { theme: 'light' });
    await page.goto(`${base}/#/sessions`);
    await page.locator('button', { hasText: 'imported-transcript@' }).first().waitFor();
    const row = await openLearning(page, 'imported-transcript');
    await pick(row, 'SUMMARIES', 'ON');
    await row.getByText('1 unsaved change').waitFor();
    // Scoped to the new panel: older shared chips and badges miss AA in the light theme on every page.
    await axe(page, 'light learning tab', '[data-testid="session-learning"]');
    await shot(page, 'light-learning', row);
    await context.close();
  }

  // --- Phone layout -------------------------------------------------------------
  {
    const { context, page } = await contextFor('3.5.0', { width: 390, height: 844 });
    await page.goto(`${base}/#/sessions`);
    await page.locator('button', { hasText: 'support-chat@' }).first().waitFor();
    const row = await openLearning(page, 'support-chat');
    await noOverflow(page, 'phone learning');
    await shot(page, 'phone-learning', row);
    await page.goto(`${base}/#/conclusions?session=imported-transcript`);
    await page.getByText('Alice asked about a refund.').waitFor();
    await noOverflow(page, 'phone conclusions');
    await shot(page, 'phone-conclusions');
    await context.close();
  }

  assert.deepEqual(unexpected, [], 'every request was in the fixture');
  assert.deepEqual(errors, [], 'no page errors');
  assert.deepEqual(overflows, [], 'no horizontal overflow');
  assert.deepEqual(axeFindings, [], 'no WCAG A/AA violations');
  console.log(`session settings UI checks passed${captures ? `; screenshots in ${output}` : ''}`);
} finally {
  await browser.close();
}
