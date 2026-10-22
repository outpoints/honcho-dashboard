// Synthetic browser checks for rendered message text (markdown) and the
// Messages transcript view. Every data request is intercepted; no request can
// reach a configured Honcho server, the operator DB, or a remote image host.
//
//   DASHBOARD_TEST_URL      dashboard under test (default http://127.0.0.1:3109)
//   DASHBOARD_TEST_OUTPUT   screenshot directory
//   DASHBOARD_TEST_ASSERT=0 capture screenshots only (for example of an older build)
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.DASHBOARD_TEST_URL ?? 'http://127.0.0.1:3109';
const output = process.env.DASHBOARD_TEST_OUTPUT ?? '/tmp/text-formatting-review';
const captures = process.env.DASHBOARD_TEST_CAPTURES !== '0';
const asserting = process.env.DASHBOARD_TEST_ASSERT !== '0';
await mkdir(output, { recursive: true });

const ws = { id: 'synthetic-workspace', metadata: {}, configuration: {}, created_at: '2026-10-14T15:00:00Z' };
const peers = [
  { id: 'alice', workspace_id: ws.id, metadata: {}, configuration: { observe_me: true }, created_at: ws.created_at },
  { id: 'assistant', workspace_id: ws.id, metadata: {}, configuration: { observe_me: false }, created_at: ws.created_at },
];
const sessions = ['planning-notes', 'release-review'].map((id) => ({
  id, workspace_id: ws.id, metadata: {}, configuration: {}, is_active: true, created_at: ws.created_at,
}));
const pageOf = (items) => ({ items, total: items.length, page: 1, size: 50, pages: 1 });

const IMPORTER_ANSWER = [
  '## What changed',
  '',
  'The importer now streams rows instead of loading the whole file. Three things matter for you:',
  '',
  '- **Timeouts** moved from the request to each batch, so `timeout=30` is per batch.',
  '- Failed rows go to a retry queue instead of stopping the run.',
  '- The progress bar counts batches, not files.',
  '',
  '### Example config',
  '',
  '```toml',
  '[importer]',
  'batch_size = 500',
  'timeout = 30',
  '```',
  '',
  '| Setting | Before | Now |',
  '|---|---|---|',
  '| timeout | per request | per batch |',
  '| retries | 0 | 3 |',
  '',
  'Read the [migration notes](https://docs.example.com/importer/migrate) before upgrading. Expect ~20 seconds per batch and ~2 minutes per file.',
].join('\n');

const RUNBOOK = [
  'Here is the full restart runbook, step by step:',
  '',
  ...Array.from({ length: 24 }, (_, i) => `${i + 1}. Step ${i + 1}: check \`worker-${i + 1}\` and confirm the queue drains before moving on.`),
  '',
  'Stop if any worker reports **failed** rows.',
].join('\n');

const messageRows = [
  ['m-01', 'planning-notes', 'alice', 'Can you summarize what changed in the **v2 importer**? I keep seeing `timeout=30` in the logs.', '2026-10-14T16:00:00Z'],
  ['m-02', 'planning-notes', 'assistant', IMPORTER_ANSWER, '2026-10-14T16:00:20Z'],
  ['m-03', 'planning-notes', 'alice', 'Thanks. Two follow-ups:\n1. Does the retry queue survive a restart?\n2. Can I turn the progress bar off?', '2026-10-14T16:02:00Z'],
  ['m-04', 'planning-notes', 'assistant', RUNBOOK, '2026-10-14T16:02:30Z'],
  ['m-05', 'release-review', 'alice', 'Release checklist draft:\n- [x] tag the build\n- [ ] update the changelog\n- [ ] post the notes\n\n> Ship on Monday after the launch is public.', '2026-10-14T17:00:00Z'],
  ['m-06', 'release-review', 'assistant', 'Looks right. Inline HTML such as <kbd>Ctrl</kbd> stays visible as text, and remote images like ![release chart](https://images.example.com/chart.png) are never fetched.', '2026-10-14T17:00:40Z'],
];
const messages = messageRows.map(([id, session_id, peer_id, content, created_at]) => ({
  id, session_id, peer_id, content, created_at, workspace_id: ws.id, metadata: {}, token_count: Math.ceil(content.length / 4),
}));
const byNewest = (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at);

const CHAT_ANSWER = [
  '## Recent work',
  '',
  '**Importer.** You moved timeouts to per-batch and added a retry queue (October 14, 2026).',
  '',
  '**Release review.** The checklist still needs the changelog and the notes.',
  '',
  '## Working patterns',
  '',
  '- **Test first:** you run `--dry-run` before every import.',
  '- **Small batches:** you keep `batch_size` at 500.',
].join('\n');

const REPRESENTATION = [
  '## Explicit Observations',
  '',
  '[2026-10-14 16:00:00] alice prefers `uv pip install` over plain `pip install`.',
  '[2026-10-14 16:02:00] alice keeps the importer `batch_size` at 500.',
  '[2026-10-14 17:00:00] alice ships releases on Mondays.',
].join('\n');

const sessionContext = {
  id: 'planning-notes',
  messages: messages.filter((m) => m.session_id === 'planning-notes').slice(0, 3),
  summary: {
    content: 'alice asked about the **v2 importer**. The assistant explained per-batch timeouts and the retry queue.',
    message_id: 'm-03', summary_type: 'short', created_at: '2026-10-14T16:03:00Z', token_count: 24,
  },
  peer_representation: REPRESENTATION,
  peer_card: ['Name: alice', 'Prefers `uv` for Python packages', 'Ships on Mondays'],
};

const browser = await chromium.launch({ headless: true });
const unexpected = [];
const errors = [];
const overflows = [];

async function contextFor(viewport, touch) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce', isMobile: touch, hasTouch: touch });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
  await context.addInitScript(({ ws }) => {
    localStorage.setItem('honcho-dashboard:instances', JSON.stringify([{ id: 'synthetic', name: 'Synthetic fixture', baseUrl: 'http://synthetic.invalid:8000' }]));
    localStorage.setItem('honcho-dashboard:activeId', 'synthetic');
    localStorage.setItem('honcho-dashboard:activeWorkspaceId', ws);
    localStorage.setItem('honcho-dashboard:theme', 'dark');
  }, { ws: ws.id });
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== new URL(base).origin) { unexpected.push(url.href); return route.abort(); }
    const path = url.pathname.replace(/^\/api\/honcho/, '');
    const isData = path.startsWith('/v3/') || url.pathname.startsWith('/api/') || ['/health', '/openapi.json'].includes(path);
    if (!isData) return route.continue();
    let body; try { body = req.postDataJSON(); } catch {}
    const reply = (json, status = 200) => route.fulfill({ json, status });
    if (path === '/openapi.json') return reply({ info: { version: '3.3.0' } });
    if (path === '/health') return reply({ status: 'ok' });
    if (path === '/v3/workspaces/list') return reply(pageOf([ws]));
    if (path === '/v3/workspaces' || path === `/v3/workspaces/${ws.id}`) return reply(ws);
    if (path.endsWith('/peers/list')) return reply(pageOf(peers));
    if (path === `/v3/workspaces/${ws.id}/peers`) return reply(peers.find((p) => p.id === body?.id) ?? peers[0]);
    if (path.endsWith('/sessions/list')) return reply(pageOf(sessions));
    if (path === `/v3/workspaces/${ws.id}/sessions`) return reply(sessions.find((s) => s.id === body?.id) ?? sessions[0]);
    if (path.endsWith('/context')) return reply(sessionContext);
    if (path.endsWith('/summaries')) return reply({ id: 'planning-notes', short_summary: sessionContext.summary, long_summary: null });
    if (/\/sessions\/[^/]+\/peers$/.test(path)) return reply(pageOf(peers));
    if (path.endsWith('/messages/list')) {
      const sid = path.split('/sessions/')[1]?.split('/')[0];
      return reply(pageOf(messages.filter((m) => m.session_id === sid).sort(byNewest)));
    }
    if (path.endsWith('/scopes/list')) return reply(pageOf([]));
    if (path.endsWith('/queue/status')) return reply({ total_work_units: 0, completed_work_units: 0, in_progress_work_units: 0, pending_work_units: 0 });
    if (path.endsWith('/chat')) return reply({ content: CHAT_ANSWER });
    if (path === '/deriver/metrics') return reply({ detail: 'No measurement' }, 404);
    if (path === '/api/operator/db' && url.searchParams.get('view') === 'messages') {
      const sid = url.searchParams.get('session_id');
      return reply({ available: true, messages: messages.filter((m) => !sid || m.session_id === sid).sort(byNewest) });
    }
    if (path === '/api/operator/db') return reply({ available: false, reason: 'Synthetic test has no operator DB' });
    if (path.startsWith('/api/operator/')) return reply({ available: false, entries: [], probes: [] });
    unexpected.push(`${req.method()} ${path}`);
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  return { context, page };
}

async function shot(page, name) {
  await page.waitForTimeout(400);
  if (captures) {
    const path = `${output}/${name}.png`;
    if (await page.evaluate(() => matchMedia('(hover: none)').matches)) {
      // Playwright's fullPage capture drops touch emulation (hover flips back to
      // `hover`), so grow the viewport to the page and take a plain capture.
      const size = page.viewportSize();
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ width: size.width, height });
      await page.waitForTimeout(200);
      await page.screenshot({ path });
      await page.setViewportSize(size);
    } else {
      await page.screenshot({ path, fullPage: true });
    }
  }
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) overflows.push(name);
}

const stream = (page) => page.locator('[data-testid="message-stream"]');
const messageRow = (page, id) => page.locator(`[data-message-id="${id}"]`);

try {
  for (const [label, viewport, touch] of [['desktop', { width: 1440, height: 1000 }, false], ['mobile', { width: 390, height: 844 }, true]]) {
    const { context, page } = await contextFor(viewport, touch);

    // Cross-session feed, newest first.
    await page.goto(`${base}/#/messages`);
    await page.getByText('Release checklist draft:', { exact: false }).first().waitFor();
    await shot(page, `${label}-messages-feed`);

    // One session reads as a transcript, oldest first.
    await page.goto(`${base}/#/messages?session=planning-notes`);
    await page.getByText('Two follow-ups', { exact: false }).first().waitFor();
    await page.waitForTimeout(300);
    await shot(page, `${label}-messages-transcript`);

    if (asserting) {
      const order = await page.locator('[data-message-id]').evaluateAll((els) => els.map((el) => el.getAttribute('data-message-id')));
      assert.deepEqual(order, ['m-01', 'm-02', 'm-03', 'm-04'], 'a selected session reads oldest first');
      assert.equal(await stream(page).getByText('**v2 importer**').count(), 0, 'markdown markers are not shown');
      assert.equal(await messageRow(page, 'm-01').locator('strong', { hasText: 'v2 importer' }).count(), 1);
      assert.equal(await messageRow(page, 'm-02').getByRole('heading', { name: 'What changed' }).count(), 1);
      assert.equal(await messageRow(page, 'm-02').locator('table').count(), 1);
      assert.equal(await messageRow(page, 'm-02').locator('pre code').count(), 1);
      assert.equal(await messageRow(page, 'm-02').locator('del').count(), 0, 'single tildes are not strikethrough');
      const link = messageRow(page, 'm-02').getByRole('link', { name: 'migration notes' });
      assert.equal(await link.getAttribute('target'), '_blank');
      assert.match(await link.getAttribute('rel'), /noopener/);

      // The long runbook collapses; SHOW_MORE reveals the rest.
      const runbook = messageRow(page, 'm-04');
      const collapsed = (await runbook.boundingBox()).height;
      await runbook.getByRole('button', { name: 'SHOW_MORE' }).click();
      await runbook.getByRole('button', { name: 'SHOW_LESS' }).waitFor();
      assert.ok((await runbook.boundingBox()).height > collapsed + 100, 'SHOW_MORE expands the message');
      await runbook.getByRole('button', { name: 'SHOW_LESS' }).click();
      assert.equal(await messageRow(page, 'm-01').getByRole('button', { name: 'SHOW_MORE' }).count(), 0, 'short messages do not collapse');

      // Row actions wait for hover or focus where hover exists, and always show on touch.
      const first = messageRow(page, 'm-01');
      const actionsOpacity = () => first.getByRole('button', { name: 'COPY' }).evaluate((el) => getComputedStyle(el.parentElement).opacity);
      if (touch) {
        assert.equal(await actionsOpacity(), '1', 'touch screens always show row actions');
      } else {
        await page.mouse.move(0, 0);
        await page.waitForTimeout(250);
        assert.equal(await actionsOpacity(), '0', 'row actions stay quiet until hover');
        await first.hover();
        await page.waitForTimeout(250);
        assert.equal(await actionsOpacity(), '1', 'hover reveals row actions');
      }

      // RAW shows the stored text exactly; COPY copies it.
      await first.hover();
      await first.getByRole('button', { name: 'SHOW_RAW' }).click();
      await first.locator('pre', { hasText: '**v2 importer**' }).waitFor();
      await first.getByRole('button', { name: 'SHOW_FORMATTED' }).click();
      await first.locator('strong', { hasText: 'v2 importer' }).waitFor();
      await first.hover();
      await first.getByRole('button', { name: 'COPY' }).click();
      await first.getByRole('button', { name: 'COPIED' }).waitFor();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), messages[0].content);

      const answer = messageRow(page, 'm-02');
      await answer.scrollIntoViewIfNeeded();
      await answer.hover();
      await answer.getByRole('button', { name: 'SHOW_RAW' }).click();
      await answer.locator('pre', { hasText: '## What changed' }).scrollIntoViewIfNeeded();
      await shot(page, `${label}-messages-raw`);
      await answer.getByRole('button', { name: 'SHOW_FORMATTED' }).click();
    }

    // Raw HTML stays visible as text and remote images are never fetched.
    await page.goto(`${base}/#/messages?session=release-review`);
    await page.getByText('Release checklist draft:', { exact: false }).first().waitFor();
    if (asserting) {
      const html = messageRow(page, 'm-06');
      await html.getByText('<kbd>Ctrl</kbd>', { exact: false }).waitFor();
      assert.equal(await html.locator('kbd').count(), 0);
      assert.equal(await html.locator('img').count(), 0);
      assert.equal(await html.getByRole('link', { name: '[image: release chart]' }).count(), 1);
      assert.equal(await messageRow(page, 'm-05').locator('blockquote').count(), 1);
      assert.equal(await messageRow(page, 'm-05').getByText('[x]').count(), 1);
    }

    // Session previews flatten markdown into a clamped line of text.
    await page.goto(`${base}/#/sessions`);
    await page.getByRole('button', { name: /planning-notes/ }).first().click();
    await page.getByText('RECENT_MESSAGES', { exact: false }).waitFor();
    await page.locator('.md-inline strong', { hasText: 'v2 importer' }).first().waitFor();
    await shot(page, `${label}-sessions`);
    if (asserting) {
      assert.equal(await page.getByText('**v2 importer**', { exact: false }).count(), 0);
      assert.equal(await page.locator('.md-inline :is(h1, h2, h4, h5, h6, ul, ol, li, table, a, img)').count(), 0);
    }

    // Chat answers render markdown.
    await page.goto(`${base}/#/chat?peer=alice`);
    await page.locator('input[placeholder="ask alice…"]').fill('What have I been working on?');
    await page.getByRole('button', { name: 'SEND', exact: true }).click();
    await page.getByText('Working patterns', { exact: false }).waitFor();
    await shot(page, `${label}-chat`);
    if (asserting) {
      assert.equal(await page.getByText('## Recent work').count(), 0);
      assert.equal(await page.getByRole('heading', { name: 'Recent work' }).count(), 1);
      assert.ok(await page.locator('li strong', { hasText: 'Test first:' }).count() === 1);
    }

    // Context preview renders each layer, and each message on its own.
    await page.goto(`${base}/#/context?session=planning-notes&peer=alice`);
    await page.getByRole('button', { name: 'GENERATE_CONTEXT' }).click();
    await page.getByText('Explicit Observations', { exact: false }).first().waitFor();
    await shot(page, `${label}-context`);
    if (asserting) {
      const preview = page.locator('[data-testid="context-preview"]');
      assert.equal(await preview.getByText('`uv pip install`').count(), 0);
      assert.ok(await preview.locator('code', { hasText: 'uv pip install' }).count() >= 1);
      assert.equal(await preview.locator('[data-context-message]').count(), 3);
    }

    await context.close();
  }

  if (asserting) {
    assert.deepEqual(unexpected, [], `unexpected requests: ${unexpected.join(', ')}`);
    assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
    assert.deepEqual(overflows, [], `horizontal overflow: ${overflows.join(', ')}`);
  }
  console.log(`text formatting UI ${asserting ? 'checks passed' : 'captured'}; screenshots in ${output}`);
} finally {
  await browser.close();
}
