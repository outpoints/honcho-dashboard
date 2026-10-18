// Synthetic browser checks for Honcho 3.3 support. Every data request is
// intercepted; no request can reach a configured Honcho server or operator DB.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.DASHBOARD_TEST_URL ?? 'http://127.0.0.1:3108';
const output = process.env.DASHBOARD_TEST_OUTPUT ?? '/tmp/honcho33-dashboard-review';
const captures = process.env.DASHBOARD_TEST_CAPTURES !== '0';
await mkdir(output, { recursive: true });

const date = '2026-10-14T16:00:00Z';
const configuration = {
  custom_instructions: 'Write in plain English.',
  reasoning: { enabled: true, custom_instructions: 'Only durable facts.' },
  summary: { enabled: true, custom_instructions: '' },
  dream: { enabled: false, custom_instructions: 'Merge duplicates.' },
  peer_card: { use: true, custom_instructions: 'Keep cards short.' },
  dialectic: { custom_instructions: 'Answer briefly.' },
};
const ws = { id: 'synthetic-workspace', metadata: {}, configuration, created_at: date };
const session = { id: 'session-1', workspace_id: ws.id, metadata: {}, configuration: {}, is_active: true, created_at: date };
const pageOf = (items) => ({ items, total: items.length, page: 1, size: 50, pages: 1 });
const resolved = {
  reasoning: { enabled: true, custom_instructions_source: 'workspace.reasoning' },
  summary: { enabled: true, messages_per_short_summary: 20, messages_per_long_summary: 60, custom_instructions_source: 'workspace.summary' },
  dream: { enabled: false },
  peer_card: { use: true, create: true },
};

const browser = await chromium.launch({ headless: true });
const unexpected = [];
const errors = [];
const overflows = [];

async function contextFor(version, viewport) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  await context.addInitScript(({ ws }) => {
    localStorage.setItem('honcho-dashboard:instances', JSON.stringify([{ id: 'synthetic', name: 'Synthetic fixture', baseUrl: 'http://synthetic.invalid:8000' }]));
    localStorage.setItem('honcho-dashboard:activeId', 'synthetic');
    localStorage.setItem('honcho-dashboard:activeWorkspaceId', ws);
    localStorage.setItem('honcho-dashboard:theme', 'dark');
    localStorage.setItem('honcho-dashboard:writeActions', 'true');
  }, { ws: ws.id });
  const calls = [];
  // Set `state.rejectSave` to a list of 422 `loc`s to make the next workspace PUT fail validation.
  const state = { rejectSave: null };
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== new URL(base).origin) { unexpected.push(url.href); return route.abort(); }
    const path = url.pathname.replace(/^\/api\/honcho/, '');
    const isData = path.startsWith('/v3/') || url.pathname.startsWith('/api/') || ['/health', '/openapi.json'].includes(path);
    if (!isData) return route.continue();
    let body; try { body = req.postDataJSON(); } catch {}
    calls.push({ path, body, method: req.method(), view: url.searchParams.get('view') });
    const reply = (json, status = 200) => route.fulfill({ json, status });
    if (path === '/openapi.json') return reply({ info: { version } });
    if (path === '/health') return reply({ status: 'ok' });
    if (path === '/v3/workspaces/list') return reply(pageOf([ws]));
    if (req.method() === 'PUT' && state.rejectSave) {
      const locs = state.rejectSave; state.rejectSave = null;
      return reply({ detail: locs.map((loc) => ({ loc, msg: 'Value error, custom_instructions exceeds DERIVER.MAX_CUSTOM_INSTRUCTIONS_TOKENS (2000 tokens)', type: 'value_error' })) }, 422);
    }
    if (path === '/v3/workspaces' || path === `/v3/workspaces/${ws.id}`) return reply(ws);
    if (path.endsWith('/peers/list')) return reply(pageOf([]));
    if (path.endsWith('/sessions/list')) return reply(pageOf([session]));
    if (path.endsWith('/sessions')) return reply(session);
    if (path.endsWith('/messages/list')) return reply(pageOf([]));
    if (path.endsWith('/session-1/peers')) return reply(pageOf([]));
    if (path.endsWith('/summaries')) return reply({ id: session.id, short_summary: null, long_summary: null });
    if (path.endsWith('/scopes/list')) return reply(pageOf([]));
    if (path.endsWith('/queue/status')) return reply({ total_work_units: 0, completed_work_units: 0, in_progress_work_units: 0, pending_work_units: 0 });
    if (path === '/deriver/metrics') return reply({ detail: 'No measurement' }, 404);
    if (path === '/api/operator/db' && url.searchParams.get('view') === 'reasoning') {
      return reply({ available: true, tasks: [], counts: { queued: 0, completed: 1, failed: 0, total: 1, tokens_pending: 0 }, byType: [{ type: 'representation', n: 1 }], config: resolved });
    }
    if (path === '/api/operator/db') return reply({ available: false, reason: 'Synthetic test has no operator DB' });
    if (path.startsWith('/api/operator/')) return reply({ available: false, entries: [], probes: [] });
    unexpected.push(`${req.method()} ${path}`);
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  return { context, page, calls, state };
}

async function shot(page, name) {
  await page.waitForTimeout(300);
  if (captures) await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) overflows.push(name);
}

const dialog = (page) => page.getByRole('dialog');
// Panel renders titles as `[ TITLE ]`.
const panel = (title) => `[ ${title} ]`;
async function openConfig(page) {
  await page.goto(`${base}/#/workspaces`);
  await page.getByRole('button', { name: 'Edit workspace config' }).first().click();
  await dialog(page).getByText(panel('REASONING'), { exact: true }).waitFor();
}
// Instruction fields are disclosure buttons whose name starts with the field label.
const fields = (d) => d.getByRole('button', { name: /^CUSTOM_INSTRUCTIONS/ });
async function expandedStates(d) {
  return fields(d).evaluateAll((els) => els.map((el) => el.getAttribute('aria-expanded')));
}
async function expandAll(d) {
  const n = await fields(d).count();
  for (let i = 0; i < n; i++) await fields(d).nth(i).click();
}
async function saveConfig(page, calls) {
  const before = calls.length;
  await dialog(page).getByRole('button', { name: 'SAVE', exact: true }).click();
  await page.getByRole('button', { name: 'SAVE', exact: true }).last().click();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  const puts = calls.slice(before).filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 1);
  return puts[0].body.configuration;
}

try {
  for (const [label, viewport] of [['desktop', { width: 1440, height: 1050 }], ['mobile', { width: 390, height: 844 }]]) {
    // 3.3.0: every instruction field is editable and untouched values round-trip.
    {
      const { context, page, calls, state } = await contextFor('3.3.0', viewport);
      await openConfig(page);
      const d = dialog(page);
      for (const title of ['SHARED_INSTRUCTIONS', 'DIALECTIC']) await d.getByText(panel(title), { exact: true }).waitFor();
      // Collapsed by default: six one-line summaries, no textareas.
      assert.deepEqual(await expandedStates(d), Array(6).fill('false'));
      assert.equal(await d.locator('textarea').count(), 0);
      assert.deepEqual(
        (await fields(d).allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()),
        ['CUSTOM_INSTRUCTIONS Write in plain English.', 'CUSTOM_INSTRUCTIONS Only durable facts.',
          'CUSTOM_INSTRUCTIONS Keep cards short.', 'CUSTOM_INSTRUCTIONS no instructions',
          'CUSTOM_INSTRUCTIONS Merge duplicates.', 'CUSTOM_INSTRUCTIONS Answer briefly.'],
      );
      await shot(page, `3.3.0-${label}-workspace-config`);
      assert.deepEqual(await saveConfig(page, calls), configuration);

      // Reopening starts collapsed again. Expanded, every field is editable.
      await openConfig(page);
      assert.deepEqual(await expandedStates(d), Array(6).fill('false'));
      await expandAll(d);
      assert.deepEqual(await expandedStates(d), Array(6).fill('true'));
      assert.equal(await d.locator('textarea').count(), 6);
      assert.equal(await d.getByRole('checkbox', { name: 'No instructions' }).count(), 4);
      assert.equal(await d.getByRole('checkbox', { name: 'No instructions' }).nth(1).getAttribute('aria-checked'), 'true');
      assert.ok(await d.locator('textarea').nth(3).isDisabled(), 'summary textarea is disabled for explicit none');
      assert.equal(await d.getByRole('textbox', { name: 'CUSTOM_INSTRUCTIONS' }).count(), 6);
      await shot(page, `3.3.0-${label}-workspace-config-expanded`);
      await d.locator('textarea').nth(0).fill('');
      await d.getByRole('checkbox', { name: 'No instructions' }).nth(1).click(); // summary back to inherit
      await d.getByRole('checkbox', { name: 'No instructions' }).nth(3).click(); // dialectic explicit none
      await d.locator('textarea').nth(2).fill('Names and roles only.');
      // Collapsing keeps the edits and summarizes them.
      await fields(d).nth(0).click();
      await fields(d).nth(3).click();
      await fields(d).nth(5).click();
      assert.equal(await d.locator('textarea').count(), 3);
      assert.match(await fields(d).nth(0).innerText(), /not set/);
      assert.match(await fields(d).nth(3).innerText(), /inherits shared/);
      assert.match(await fields(d).nth(5).innerText(), /no instructions/);
      const saved = await saveConfig(page, calls);
      assert.equal(saved.custom_instructions, '');
      assert.deepEqual(saved.summary, { enabled: true });
      assert.deepEqual(saved.dialectic, { custom_instructions: '' });
      assert.deepEqual(saved.peer_card, { use: true, custom_instructions: 'Names and roles only.' });

      // A rejected save opens exactly the fields the server named and keeps the modal open.
      await openConfig(page);
      state.rejectSave = [['body', 'configuration', 'summary', 'custom_instructions'], ['body', 'configuration', 'custom_instructions']];
      await d.getByRole('button', { name: 'SAVE', exact: true }).click();
      await page.getByRole('button', { name: 'SAVE', exact: true }).last().click();
      await page.getByText('MAX_CUSTOM_INSTRUCTIONS_TOKENS', { exact: false }).first().waitFor();
      await page.waitForTimeout(300);
      assert.deepEqual(await expandedStates(d), ['true', 'false', 'false', 'true', 'false', 'false']);
      await shot(page, `3.3.0-${label}-rejected-save`);
      await page.keyboard.press('Escape');

      await page.goto(`${base}/#/reasoning`);
      await page.getByText('reasoning.instructions_from', { exact: true }).waitFor();
      await page.getByText('workspace.summary', { exact: true }).waitFor();
      assert.equal(await page.getByText('dream.instructions_from', { exact: true }).count(), 0);

      await page.goto(`${base}/#/sessions`);
      await page.getByText('session-1', { exact: true }).first().click();
      await page.getByRole('button', { name: 'CLONE_SESSION' }).click();
      await dialog(page).getByText('Create a copy of session', { exact: false }).waitFor();
      assert.equal(await dialog(page).getByText('Before 3.3.0', { exact: false }).count(), 0);
      await page.keyboard.press('Escape');
      assert.equal(calls.some((c) => c.path.endsWith('/clone')), false);
      await context.close();
    }
    // 3.2.2 and unverified servers: new fields stay hidden and are preserved on save.
    for (const version of ['3.2.2', 'unknown']) {
      const { context, page, calls } = await contextFor(version, viewport);
      await openConfig(page);
      const d = dialog(page);
      await d.getByText(version === 'unknown' ? 'Server version is unverified.' : 'requires Honcho 3.3+', { exact: false }).waitFor();
      assert.equal(await d.getByText(panel('SHARED_INSTRUCTIONS'), { exact: true }).count(), 0);
      assert.equal(await d.getByText(panel('DIALECTIC'), { exact: true }).count(), 0);
      assert.deepEqual(await expandedStates(d), ['false']);
      assert.match(await fields(d).first().innerText(), /Only durable facts\./);
      assert.equal(await d.locator('textarea').count(), 0);
      await fields(d).first().click();
      assert.equal(await d.locator('textarea').count(), 1);
      assert.equal(await d.getByRole('checkbox', { name: 'No instructions' }).count(), 0);
      if (version === '3.2.2') await shot(page, `3.2.2-${label}-workspace-config`);
      await d.getByRole('checkbox', { name: 'Enabled' }).last().click(); // dream on
      const saved = await saveConfig(page, calls);
      assert.deepEqual(saved, { ...configuration, dream: { enabled: true, custom_instructions: 'Merge duplicates.' } });

      await page.goto(`${base}/#/sessions`);
      await page.getByText('session-1', { exact: true }).first().click();
      await page.getByRole('button', { name: 'CLONE_SESSION' }).click();
      await dialog(page).getByText('Before 3.3.0', { exact: false }).waitFor();
      if (version === '3.2.2') await shot(page, `3.2.2-${label}-clone-warning`);
      await page.keyboard.press('Escape');
      assert.equal(calls.some((c) => c.path.endsWith('/clone')), false);
      await context.close();
    }
  }
  assert.deepEqual(unexpected, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(overflows, []);
  console.log(JSON.stringify({ passed: true, checks: '3.3.0/3.2.2/unknown desktop+mobile workspace config round-trip, collapsed summaries, expand/collapse with edits, rejected-save reveal, hidden-key preservation, instruction sources, clone warning', output }));
} finally {
  await browser.close();
}
