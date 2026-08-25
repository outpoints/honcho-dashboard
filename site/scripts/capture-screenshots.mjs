import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const outputDirectory = resolve(repositoryRoot, "docs");
const baseUrl = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3000";
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined;
const workspaceId = "acme_support";

const now = new Date();
const isoHoursAgo = (hours) => new Date(now.getTime() - hours * 3_600_000).toISOString();
const isoDaysAgo = (days) => new Date(now.getTime() - days * 86_400_000).toISOString();

const workspaces = [
  workspace("acme_support", 180),
  workspace("product_sandbox", 120),
  workspace("research_lab", 75),
  workspace("demo_archive", 30),
];

const peers = [
  peer("demo_user", true, 120),
  peer("demo_agent", false, 118),
  peer("docs_reviewer", true, 42),
  peer("support_bot", false, 38),
];

const sessions = [
  session("support-intake-001", true, 24),
  session("docs-review-002", true, 72),
  session("search-evaluation-003", true, 168),
  session("onboarding-demo-004", true, 360),
  session("archived-fixture-005", false, 720),
];

const sessionPeers = {
  "support-intake-001": ["demo_user", "demo_agent"],
  "docs-review-002": ["docs_reviewer", "demo_agent"],
  "search-evaluation-003": ["demo_user", "support_bot"],
  "onboarding-demo-004": ["demo_user", "demo_agent"],
  "archived-fixture-005": ["docs_reviewer", "support_bot"],
};

const messages = [
  message(
    "msg-demo-008",
    "support-intake-001",
    "demo_agent",
    "The synthetic capture is isolated: every API response comes from the local screenshot fixture.",
    1,
    28,
  ),
  message(
    "msg-demo-007",
    "support-intake-001",
    "demo_user",
    "Please keep repository screenshots privacy-safe and use clearly synthetic data.",
    2,
    19,
  ),
  message(
    "msg-demo-006",
    "docs-review-002",
    "docs_reviewer",
    "The screenshot checklist should cover synthetic fixtures, metadata removal, and visual review.",
    5,
    22,
  ),
  message(
    "msg-demo-005",
    "docs-review-002",
    "demo_agent",
    "Documented the native search ranking and the session file-upload workflow.",
    8,
    18,
  ),
  message(
    "msg-demo-004",
    "search-evaluation-003",
    "demo_user",
    "Find messages about privacy-safe screenshots and sort the returned result window by date.",
    15,
    21,
  ),
  message(
    "msg-demo-003",
    "search-evaluation-003",
    "support_bot",
    "Honcho relevance blends full-text and semantic rankings for the synthetic query.",
    20,
    17,
  ),
  message(
    "msg-demo-002",
    "onboarding-demo-004",
    "demo_agent",
    "Store timestamps in UTC and convert them to local time only when displaying them.",
    40,
    20,
  ),
  message(
    "msg-demo-001",
    "archived-fixture-005",
    "docs_reviewer",
    "This archived session contains generated sample content only.",
    90,
    13,
  ),
];

const conclusions = [
  conclusion("conclusion-demo-006", "demo_agent", "demo_user", "Repository screenshots must contain synthetic fixture data only.", 2),
  conclusion("conclusion-demo-005", "demo_agent", "demo_user", "The dashboard uses native Honcho hybrid search for message discovery.", 8),
  conclusion("conclusion-demo-004", "docs_reviewer", "demo_agent", "File uploads are scoped to a session and attributed to one of its peers.", 14),
  conclusion("conclusion-demo-003", "demo_user", "demo_user", "UTC is the internal timestamp standard for the sample project.", 21),
  conclusion("conclusion-demo-002", "support_bot", "demo_user", "Search results can preserve relevance or use stable chronological ordering.", 45),
  conclusion("conclusion-demo-001", "demo_agent", "docs_reviewer", "Unmocked API requests are blocked during screenshot capture.", 70),
];

const queueByWorkspace = {
  acme_support: queue(128, 112, 2, 14),
  product_sandbox: queue(72, 72, 0, 0),
  research_lab: queue(94, 89, 1, 4),
  demo_archive: queue(35, 35, 0, 0),
};

const sessionStats = Object.fromEntries(
  sessions.map((item, index) => {
    const relevant = messages.filter((entry) => entry.session_id === item.id);
    const key = `${workspaceId}::${item.id}`;
    return [
      key,
      {
        session_id: item.id,
        workspace_id: workspaceId,
        message_count: [148, 92, 64, 41, 18][index],
        token_sum: [18420, 11280, 8640, 5780, 2210][index],
        last_message_at: relevant[0]?.created_at ?? isoHoursAgo([6, 36, 96, 240, 800][index]),
        peers: sessionPeers[item.id],
      },
    ];
  }),
);

function workspace(id, daysAgo) {
  return {
    id,
    metadata: { environment: "synthetic-demo", source: "screenshot-fixture" },
    configuration: {},
    created_at: isoDaysAgo(daysAgo),
  };
}

function peer(id, observeMe, daysAgo) {
  return {
    id,
    workspace_id: workspaceId,
    metadata: { fixture: true },
    configuration: { observe_me: observeMe, observe_others: !observeMe },
    created_at: isoDaysAgo(daysAgo),
  };
}

function session(id, isActive, hoursAgo) {
  return {
    id,
    workspace_id: workspaceId,
    metadata: { fixture: true, category: "documentation" },
    configuration: {},
    is_active: isActive,
    created_at: isoHoursAgo(hoursAgo),
  };
}

function message(id, sessionId, peerId, content, hoursAgo, tokenCount) {
  return {
    id,
    workspace_id: workspaceId,
    session_id: sessionId,
    peer_id: peerId,
    content,
    token_count: tokenCount,
    metadata: { source: "synthetic-fixture" },
    created_at: isoHoursAgo(hoursAgo),
  };
}

function conclusion(id, observerId, observedId, content, daysAgo) {
  return {
    id,
    content,
    observer_id: observerId,
    observed_id: observedId,
    session_id: "docs-review-002",
    level: daysAgo % 2 === 0 ? "explicit" : "deductive",
    created_at: isoDaysAgo(daysAgo),
  };
}

function queue(total, completed, inProgress, pending) {
  return {
    total_work_units: total,
    completed_work_units: completed,
    in_progress_work_units: inProgress,
    pending_work_units: pending,
  };
}

function page(items, total = items.length) {
  return { items, total, page: 1, size: Math.max(items.length, 1), pages: 1 };
}

function workspaceFor(id) {
  return workspaces.find((item) => item.id === id) ?? workspace(id, 1);
}

function peerFor(id) {
  return peers.find((item) => item.id === id) ?? peer(id, true, 1);
}

function sessionFor(id) {
  return sessions.find((item) => item.id === id) ?? session(id, true, 1);
}

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function normalizedHonchoPath(pathname) {
  return pathname.startsWith("/api/honcho")
    ? pathname.slice("/api/honcho".length) || "/"
    : pathname;
}

function throughputResponse() {
  const end = now.getTime();
  const buckets = Array.from({ length: 48 }, (_, index) => {
    const wave = Math.sin(index / 4) * 12;
    return {
      ts: new Date(end - (47 - index) * 30 * 60_000).toISOString(),
      reads: Math.max(8, Math.round(38 + wave + (index % 7) * 3)),
      writes: Math.max(4, Math.round(22 + wave / 2 + (index % 5) * 2)),
    };
  });
  return { available: true, buckets };
}

function heatmapResponse() {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const cells = Array.from({ length: 364 }, (_, index) => ({
    day: new Date(end - (363 - index) * 86_400_000).toISOString().slice(0, 10),
    n: 1 + ((index * 7 + Math.floor(index / 9)) % 34),
  }));
  return { available: true, cells };
}

function reasoningResponse() {
  const tasks = [
    reasoningTask("task-demo-101", "representation", "demo_user", "support-intake-001", "queued", 1, 1840),
    reasoningTask("task-demo-100", "summary", "demo_agent", "docs-review-002", "completed", 3, 920),
    reasoningTask("task-demo-099", "peer_card", "demo_user", "search-evaluation-003", "completed", 6, 1240),
    reasoningTask("task-demo-098", "dream", "docs_reviewer", "docs-review-002", "queued", 9, 2100),
    reasoningTask("task-demo-097", "consolidation", "support_bot", "onboarding-demo-004", "completed", 14, 760),
    reasoningTask("task-demo-096", "webhook", "demo_agent", "support-intake-001", "failed", 18, 320, "Synthetic delivery target intentionally unavailable"),
  ];
  return {
    available: true,
    tasks,
    counts: { queued: 2, completed: 86, failed: 1, total: 89, tokens_pending: 3940 },
    byType: [
      { type: "representation", n: 34 },
      { type: "summary", n: 28 },
      { type: "peer_card", n: 15 },
      { type: "dream", n: 8 },
      { type: "consolidation", n: 4 },
    ],
    config: {
      reasoning: { enabled: true },
      summary: { enabled: true, messages_per_short_summary: 20, messages_per_long_summary: 80 },
      peer_card: { use: true, create: true },
      dream: { enabled: true },
    },
  };
}

function reasoningTask(id, taskType, taskPeer, sessionId, status, hoursAgo, tokenCount, error = null) {
  return {
    id,
    task_type: taskType,
    peer: taskPeer,
    session_id: sessionId,
    status,
    error,
    created_at: isoHoursAgo(hoursAgo),
    token_count: tokenCount,
    work_unit_key: `synthetic:${id}`,
    message_id: messages.find((item) => item.session_id === sessionId)?.id ?? null,
    payload: {
      fixture: true,
      objective: `Generate a synthetic ${taskType} artifact for documentation.`,
      source_messages: 4,
    },
  };
}

async function mockOperator(route, url) {
  if (url.pathname !== "/api/operator/db") {
    return json(route, { available: true, synthetic: true });
  }

  const view = url.searchParams.get("view") ?? "stats";
  if (view === "throughput") return json(route, throughputResponse());
  if (view === "heatmap") return json(route, heatmapResponse());
  if (view === "sessions") return json(route, { available: true, sessions: sessionStats });
  if (view === "reasoning") return json(route, reasoningResponse());
  if (view === "conclusions") {
    return json(route, {
      available: true,
      total: 482,
      by_observer: [
        { observer_id: "demo_agent", n: 214 },
        { observer_id: "demo_user", n: 138 },
        { observer_id: "docs_reviewer", n: 82 },
        { observer_id: "support_bot", n: 48 },
      ],
    });
  }
  return json(route, {
    available: true,
    db_size_pretty: "184 MB",
    uptime_s: 1_284_220,
    vector_count: 12_840,
  });
}

async function mockHoncho(route, request, url) {
  const path = normalizedHonchoPath(url.pathname);
  const method = request.method();
  const body = request.postDataJSON?.() ?? {};

  if (path === "/health") return json(route, { status: "ok" });
  if (path === "/openapi.json") {
    return json(route, { info: { title: "Honcho Synthetic Demo", version: "3.2.1" } });
  }
  if (path === "/v3/workspaces/list") return json(route, page(workspaces));
  if (path === "/v3/workspaces" && method === "POST") {
    return json(route, workspaceFor(body.id ?? workspaceId));
  }

  const queueMatch = path.match(/^\/v3\/workspaces\/([^/]+)\/queue\/status$/);
  if (queueMatch) {
    const id = decodeURIComponent(queueMatch[1]);
    return json(route, queueByWorkspace[id] ?? queue(24, 24, 0, 0));
  }

  const peerListMatch = path.match(/^\/v3\/workspaces\/([^/]+)\/peers\/list$/);
  if (peerListMatch) return json(route, page(peers));

  const peerCreateMatch = path.match(/^\/v3\/workspaces\/([^/]+)\/peers$/);
  if (peerCreateMatch && method === "POST") return json(route, peerFor(body.id ?? "demo_user"));

  const sessionListMatch = path.match(/^\/v3\/workspaces\/([^/]+)\/sessions\/list$/);
  if (sessionListMatch) return json(route, page(sessions));

  const sessionCreateMatch = path.match(/^\/v3\/workspaces\/([^/]+)\/sessions$/);
  if (sessionCreateMatch && method === "POST") {
    return json(route, sessionFor(body.id ?? "support-intake-001"));
  }

  const sessionPeersMatch = path.match(/^\/v3\/workspaces\/([^/]+)\/sessions\/([^/]+)\/peers$/);
  if (sessionPeersMatch && method === "GET") {
    const id = decodeURIComponent(sessionPeersMatch[2]);
    return json(route, page((sessionPeers[id] ?? []).map(peerFor)));
  }

  const messageListMatch = path.match(/^\/v3\/workspaces\/([^/]+)\/sessions\/([^/]+)\/messages\/list$/);
  if (messageListMatch) {
    const id = decodeURIComponent(messageListMatch[2]);
    return json(route, page(messages.filter((item) => item.session_id === id)));
  }

  const summariesMatch = path.match(/^\/v3\/workspaces\/([^/]+)\/sessions\/([^/]+)\/summaries$/);
  if (summariesMatch) {
    const id = decodeURIComponent(summariesMatch[2]);
    return json(route, {
      id,
      short_summary: {
        content: "Synthetic session summary: documentation, privacy-safe capture, and native Honcho search were reviewed.",
        message_id: "msg-demo-008",
        summary_type: "short",
        created_at: isoHoursAgo(1),
        token_count: 24,
      },
      long_summary: null,
    });
  }

  const searchMatch = path.match(/^\/v3\/workspaces\/([^/]+)(?:\/sessions\/[^/]+|\/peers\/[^/]+)?\/search$/);
  if (searchMatch) return json(route, messages.slice(0, 5));

  const chatMatch = path.match(/^\/v3\/workspaces\/([^/]+)\/peers\/([^/]+)\/chat$/);
  if (chatMatch) {
    return json(route, {
      content:
        "This is a synthetic demo answer. The dashboard captures only generated fixtures, blocks unmocked API traffic, and reviews each image before it enters the repository.",
    });
  }

  const conclusionListMatch = path.match(/^\/v3\/workspaces\/([^/]+)\/conclusions\/list$/);
  if (conclusionListMatch) return json(route, page(conclusions, 482));

  const conclusionQueryMatch = path.match(/^\/v3\/workspaces\/([^/]+)\/conclusions\/query$/);
  if (conclusionQueryMatch) return json(route, conclusions.slice(0, 4));

  return json(route, { detail: `No synthetic fixture for ${method} ${path}` }, 501);
}

async function capture(page, fileName) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  await page.screenshot({
    path: resolve(outputDirectory, fileName),
    animations: "disabled",
    caret: "hide",
    fullPage: false,
  });
}

async function openRoute(page, route, readyText) {
  await page.goto(`${baseUrl}/#/${route}`, { waitUntil: "domcontentloaded" });
  await page.getByText(readyText, { exact: false }).first().waitFor({ state: "visible" });
  await page.waitForTimeout(450);
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  try {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1180 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
    reducedMotion: "reduce",
    locale: "en-US",
    timezoneId: "UTC",
  });

  const unexpectedRequests = new Set();
  const pageErrors = [];
  const baseOrigin = new URL(baseUrl).origin;

  await context.addInitScript(({ selectedWorkspace }) => {
    localStorage.setItem(
      "honcho-dashboard:instances",
      JSON.stringify([
        {
          id: "synthetic-demo",
          name: "Synthetic Demo",
          baseUrl: "http://honcho.demo:8000",
        },
      ]),
    );
    localStorage.setItem("honcho-dashboard:activeId", "synthetic-demo");
    localStorage.setItem("honcho-dashboard:activeWorkspaceId", selectedWorkspace);
    localStorage.setItem("honcho-dashboard:theme", "dark");
    localStorage.setItem("honcho-dashboard:writeActions", "false");
  }, { selectedWorkspace: workspaceId });

  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== baseOrigin) {
      unexpectedRequests.add(`external ${request.method()} ${url.origin}${url.pathname}`);
      return route.abort("blockedbyclient");
    }
    if (url.pathname.startsWith("/api/operator/")) return mockOperator(route, url);
    if (
      url.pathname.startsWith("/api/honcho/") ||
      url.pathname.startsWith("/v3/") ||
      url.pathname === "/health" ||
      url.pathname === "/openapi.json"
    ) {
      return mockHoncho(route, request, url);
    }
    if (url.pathname.startsWith("/api/")) {
      unexpectedRequests.add(`unmocked ${request.method()} ${url.pathname}${url.search}`);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });

  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await openRoute(page, "fleet", "QUEUE_STATUS");
  await capture(page, "fleet.png");

  await openRoute(page, "overview", "52 weeks · 7 days");
  await capture(page, "overview.png");

  await openRoute(page, "reasoning", "operator/db · queue table");
  const firstTask = page.locator('button[aria-expanded]').filter({ hasText: "representation" }).first();
  if (await firstTask.count()) await firstTask.click();
  await capture(page, "reasoning.png");

  await openRoute(page, "chat?peer=demo_agent&session=support-intake-001", "TRANSCRIPT");
  const chatInput = page.locator('input[placeholder^="ask demo_agent"]');
  await chatInput.fill("How is this screenshot kept privacy-safe?");
  await page.getByRole("button", { name: "SEND", exact: true }).click();
  await page.getByText("This is a synthetic demo answer.", { exact: false }).waitFor();
  await capture(page, "chat.png");

  await openRoute(page, "conclusions", "Repository screenshots must contain synthetic fixture data only.");
  await capture(page, "conclusions.png");

  await openRoute(page, "search", "Search the selected workspace");
  await page.locator('input[placeholder^="search acme_support"]').fill("privacy-safe screenshots");
  await page.getByRole("button", { name: "SEARCH", exact: true }).click();
  await page.getByText("5 MATCHES", { exact: true }).waitFor();
  await capture(page, "search.png");

  await page.evaluate(() => {
    localStorage.setItem("honcho-dashboard:writeActions", "true");
    window.dispatchEvent(new Event("honcho-dashboard:writeActions-change"));
  });
  await openRoute(page, "sessions", "support-intake-001");
  await page.getByText("support-intake-001", { exact: true }).first().click();
  await page.getByRole("button", { name: "UPLOAD_FILE", exact: true }).waitFor();
  await capture(page, "dashboard.png");

  await page.getByRole("button", { name: "UPLOAD_FILE", exact: true }).click();
  await page.getByText("UPLOAD_SESSION_FILE", { exact: false }).waitFor();
  await page.getByRole("button", { name: "select a session peer…", exact: true }).click();
  await page.getByRole("option", { name: "demo_user", exact: true }).click();
  await page.getByLabel("Choose a document to upload").setInputFiles({
    name: "synthetic-memory-notes.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Synthetic fixture\n\nNo real user data is present.\n"),
  });
  await page.locator('input[placeholder=\'{"source":"manual-upload"}\']').fill(
    '{"source":"synthetic-screenshot"}',
  );
  await capture(page, "session-upload.png");

  if (unexpectedRequests.size > 0) {
    throw new Error(`Capture blocked unexpected requests:\n${[...unexpectedRequests].join("\n")}`);
  }
  if (pageErrors.length > 0) {
    throw new Error(`Browser errors during capture:\n${pageErrors.join("\n")}`);
  }

  process.stdout.write(`Captured 8 synthetic screenshots in ${outputDirectory}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
