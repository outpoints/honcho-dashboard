// Synthetic regression for issue #10. Run against a local dashboard dev server:
// DASHBOARD_TEST_URL=http://127.0.0.1:3010 node scripts/verify-peers-workspace-ui.mjs
// All data requests are intercepted. Nothing reaches Honcho or the operator DB.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.DASHBOARD_TEST_URL ?? "http://127.0.0.1:3010";
const browser = await chromium.launch({ headless: true });
const date = "2026-01-01T00:00:00Z";
const workspaceIds = ["ws-a", "ws-b", "ws-empty", "all", "__active__"];
const workspaces = workspaceIds.map((id) => ({ id, metadata: {}, configuration: {}, created_at: date }));
const pageOf = (items) => ({ items, total: items.length, page: 1, size: 100, pages: 1 });
const peerFor = (workspace_id) => ({ id: "notes", workspace_id, metadata: {}, configuration: {}, created_at: date });
const errors = [];
const unexpected = [];
let passed = 0;

async function fixture(viewport) {
  const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
  await context.addInitScript(() => {
    if (localStorage.getItem("honcho-dashboard:instances")) return;
    localStorage.setItem("honcho-dashboard:instances", JSON.stringify([
      { id: "synthetic", name: "Synthetic fixture", baseUrl: "http://synthetic.invalid:8000" },
    ]));
    localStorage.setItem("honcho-dashboard:activeId", "synthetic");
    localStorage.setItem("honcho-dashboard:activeWorkspaceId", "ws-b");
  });
  const calls = [];
  const state = { omitWorkspace: false };
  const mutations = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== new URL(base).origin) {
      unexpected.push(url.href);
      return route.abort();
    }
    const path = url.pathname.replace(/^\/api\/honcho/, "");
    if (!path.startsWith("/v3/") && !url.pathname.startsWith("/api/") && !["/health", "/openapi.json"].includes(path)) {
      return route.continue();
    }
    calls.push({ path, method: request.method() });
    const reply = (json, status = 200) => route.fulfill({ json, status });
    if (path === "/health") return reply({ status: "ok" });
    if (path === "/openapi.json") return reply({ info: { version: "3.2.2" } });
    if (path === "/v3/workspaces/list") return reply(pageOf(workspaces.filter((ws) => !state.omitWorkspace || ws.id !== "ws-a")));
    if (request.method() === "POST" && (path === "/v3/workspaces" || /^\/v3\/workspaces\/[^/]+\/peers$/.test(path))) {
      mutations.push({ path, body: request.postDataJSON() });
    }
    if (path === "/v3/workspaces") return reply(workspaces.find((ws) => ws.id === request.postDataJSON().id) ?? { ...workspaces[0], id: request.postDataJSON().id });
    if (path === "/api/operator/db") {
      const ws = url.searchParams.get("workspace_id");
      if (url.searchParams.get("view") === "messages") return reply({ available: true, messages: [{ id: "message-1", peer_id: "notes", session_id: `session-${ws}`, workspace_id: ws, content: `Message from ${ws}`, token_count: 4, metadata: {}, created_at: date }] });
      if (url.searchParams.get("view") === "peer_detail") {
        const ws = url.searchParams.get("workspace_id");
        return reply({ available: true, messages: ws === "ws-a" ? 11 : 22, conclusions: 1,
          conclusionsList: [{ id: `conclusion-${ws}`, content: `Conclusion from ${ws}`, level: "explicit", times_derived: 1, created_at: date }] });
      }
      return reply({ available: false });
    }
    const match = path.match(/^\/v3\/workspaces\/([^/]+)(.*)$/);
    if (match) {
      const ws = decodeURIComponent(match[1]);
      const suffix = match[2];
      if (suffix === "/queue/status") return reply({ total_work_units: 0, completed_work_units: 0, in_progress_work_units: 0, pending_work_units: 0 });
      if (suffix === "/peers/list") {
        if (!workspaceIds.includes(ws)) return reply({ detail: "Workspace unavailable" }, 404);
        return reply(pageOf(ws === "ws-empty" ? [] : [peerFor(ws)]));
      }
      if (suffix === "/peers") return reply(peerFor(ws));
      if (suffix === "/peers/notes/card") return reply({ peer_card: [`Card from ${ws}`] });
      if (suffix === "/peers/notes/search") return reply([]);
      if (suffix === "/conclusions/list") {
        const filters = request.postDataJSON()?.filters ?? {};
        const matches = (!filters.level || filters.level === "explicit") && !filters.NOT && !filters.created_at;
        return reply(pageOf(matches ? [{ id: `conclusion-${ws}`, content: `Conclusion from ${ws}`, observer_id: "notes", observed_id: "notes", level: "explicit", created_at: date }] : []));
      }
      if (suffix === "/sessions/list") return reply(pageOf([{ id: `session-${ws}`, workspace_id: ws, metadata: {}, configuration: {}, is_active: true, created_at: date }]));
      if (["/peers/notes/sessions", "/scopes/list"].includes(suffix)) return reply(pageOf([]));
    }
    unexpected.push(`${request.method()} ${path}`);
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(8000);
  return { context, page, calls, mutations, state };
}

async function assertWorkspace(page, ws) {
  await page.locator("main").getByText(`@${ws}`, { exact: true }).waitFor().catch(async (error) => {
    throw new Error(`${error.message}\nRendered: ${await page.locator("main").innerText()}\nUnexpected: ${JSON.stringify(unexpected)}\nErrors: ${JSON.stringify(errors)}`);
  });
  // Rows start closed; open this workspace's row to read its details.
  const row = page.locator("main button[aria-controls]", { hasText: `@${ws}` });
  if (await row.getAttribute("aria-expanded") !== "true") await row.click();
  await page.locator("main").getByText(`Conclusion from ${ws}`, { exact: true }).waitFor();
  // Wait for Framer Motion's departing row to finish its exit animation.
  await page.waitForFunction(() => [...document.querySelectorAll("main span")].filter((el) => /^@/.test(el.textContent)).length === 1);
  await page.locator("main").getByRole("button", { name: ws, exact: true }).waitFor();
  await page.locator("header").getByRole("button", { name: ws, exact: true }).waitFor();
}

try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const { context, page, calls, mutations, state } = await fixture(viewport);
    await page.goto(`${base}/#/workspaces`);
    // Workspaces are returned in a fixed order, so this is ws-a's card.
    await page.getByRole("button", { name: "VIEW_PEERS", exact: true }).first().click();
    assert.equal(new URL(page.url()).hash, "#/peers?ws=ws-a");
    await assertWorkspace(page, "ws-a");
    assert.deepEqual(mutations, [], "Browsing peers must not get-or-create a workspace or peer");
    assert.equal(await page.evaluate(() => localStorage.getItem("honcho-dashboard:activeWorkspaceId")), "ws-b");
    passed++;

    // The peer's message search runs from the conclusions filter box.
    await page.getByPlaceholder("filter conclusions by text…").fill("notes");
    await page.locator("main").getByRole("button", { name: "SEARCH_MESSAGES", exact: true }).click();
    await page.getByText("No messages from notes match “notes”.", { exact: true }).waitFor();
    await page.locator("main").getByRole("button", { name: "BACK_TO_CONCLUSIONS", exact: true }).click();
    await page.locator("main").getByText("Conclusion from ws-a", { exact: true }).waitFor();
    assert.deepEqual(mutations, [], "Peer search must remain non-creating");
    passed++;

    await page.reload();
    await assertWorkspace(page, "ws-a");
    passed++;

    // A real second tab sends the native storage event to the pinned tab.
    const other = await context.newPage();
    await other.goto(`${base}/#/workspaces`);
    await other.evaluate(() => localStorage.setItem("honcho-dashboard:activeWorkspaceId", "ws-empty"));
    await page.waitForFunction(() => localStorage.getItem("honcho-dashboard:activeWorkspaceId") === "ws-empty");
    await assertWorkspace(page, "ws-a");
    passed++;

    await page.evaluate(() => { window.location.hash = "#/peers?ws=ws-b"; });
    await assertWorkspace(page, "ws-b");
    await page.goBack();
    await assertWorkspace(page, "ws-a");
    await page.goForward();
    await assertWorkspace(page, "ws-b");
    passed++;

    // Manual filtering must update the URL, not leave a stale ws bookmark.
    await page.locator("main").getByRole("button", { name: "ws-b", exact: true }).click();
    await page.getByRole("option", { name: "ws-a", exact: true }).click();
    await page.waitForURL("**/#/peers?ws=ws-a");
    await assertWorkspace(page, "ws-a");
    passed++;

    await page.locator("main").getByRole("button", { name: "ws-a", exact: true }).click();
    await page.getByRole("option", { name: "all", exact: true }).first().click();
    await page.waitForFunction(() => !new URLSearchParams(location.hash.split("?")[1]).has("ws"));
    await page.locator("main").getByText("@ws-a", { exact: true }).waitFor();
    await page.locator("main").getByText("@ws-b", { exact: true }).waitFor();
    await page.reload();
    await page.locator("main").getByText("@ws-a", { exact: true }).waitFor();
    await page.locator("main").getByText("@ws-b", { exact: true }).waitFor();
    passed++;

    // Legal IDs that were previously confused with internal filter sentinels.
    for (const ws of ["all", "__active__"]) {
      await page.evaluate((id) => { window.location.hash = `#/peers?ws=${encodeURIComponent(id)}`; }, ws);
      await assertWorkspace(page, ws);
      passed++;
    }

    await page.evaluate(() => { window.location.hash = "#/peers?ws=ws-empty"; });
    await page.getByText("No peers in this workspace yet.", { exact: true }).waitFor();
    passed++;

    await page.evaluate(() => { window.location.hash = "#/peers?ws=ws-missing"; });
    await page.locator("main").getByText(/Workspace unavailable/).waitFor();
    assert.equal(await page.getByText("No peers in this workspace yet.", { exact: true }).count(), 0);
    await page.locator("main").getByRole("button", { name: "ws-missing", exact: true }).waitFor();
    passed++;

    await other.evaluate(() => localStorage.setItem("honcho-dashboard:activeWorkspaceId", "ws-b"));
    await page.evaluate(() => { window.location.hash = "#/peers"; });
    await assertWorkspace(page, "ws-b");
    await other.evaluate(() => localStorage.setItem("honcho-dashboard:activeWorkspaceId", "ws-a"));
    await assertWorkspace(page, "ws-a");
    passed++;

    assert.deepEqual(mutations, [], "All Peers reads, including missing workspaces, must remain non-creating");
    // A valid linked workspace need not be present on the first workspace page.
    state.omitWorkspace = true;
    // Peer-row navigation carries the clicked row's workspace and peer filter.
    for (const [button, route] of [[/^MESSAGES \d/, "messages"], [/^SESSIONS \d/, "sessions"], ["CONTEXT", "context"]]) {
      await other.evaluate(() => localStorage.setItem("honcho-dashboard:activeWorkspaceId", "ws-b"));
      await page.evaluate(() => { window.location.hash = "#/peers?ws=ws-a"; });
      await page.reload();
      await assertWorkspace(page, "ws-a");
      await page.locator("main").getByRole("button", { name: button, exact: typeof button === "string" }).click();
      await page.waitForURL(`**/#/${route}?peer=notes`);
      await page.locator("header").getByRole("button", { name: "ws-a", exact: true }).waitFor();
      assert.equal(await page.evaluate(() => localStorage.getItem("honcho-dashboard:activeWorkspaceId")), "ws-a");
      if (route === "messages") await page.getByText("Message from ws-a", { exact: true }).waitFor();
      if (route === "sessions") await page.getByText("session-ws-a", { exact: true }).waitFor();
      if (route === "context") {
        await page.locator("main").getByRole("button", { name: /peer.only|none/i }).first().click();
        await page.getByRole("option", { name: "session-ws-a", exact: true }).waitFor();
      }
      passed++;
    }
    assert.ok(calls.some(({ path }) => path === "/v3/workspaces/ws-a/peers/list"));
    await context.close();
  }
  assert.deepEqual(unexpected, [], "Unexpected data requests must never escape interception");
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log(`PASS: ${passed} workspace navigation checks across desktop and mobile; no unmocked data requests or runtime errors.`);
} finally {
  await browser.close();
}
