import assert from "node:assert/strict";
import test from "node:test";
import { Honcho, Page } from "@honcho-ai/sdk";
import {
  capabilityFromProbe,
  honcho31FromVersion,
  normalizeHonchoVersion,
  shouldProbeHoncho31,
} from "../src/lib/honcho/capabilities.ts";
import { supportedUploadContentType } from "../src/lib/honcho/fileUpload.ts";
import { buildSearchFilters } from "../src/lib/honcho/searchFilters.ts";
import { orderSearchResults } from "../src/lib/honcho/searchOrdering.ts";
import {
  listAllScopes,
  listAllScopeSessions,
} from "../src/lib/honcho/scopeListing.ts";
import {
  listAllSessions,
  SESSION_LIST_PAGE_SIZE,
} from "../src/lib/honcho/sessionListing.ts";
import { parseOptionalJsonObject } from "../src/lib/json.ts";

test("buildSearchFilters emits UTC date and metadata filters", () => {
  assert.deepEqual(
    buildSearchFilters({
      fromDate: "2026-08-01",
      toDate: "2026-08-24",
      metadataJson: '{"source":"docs"}',
    }),
    {
      ok: true,
      filters: {
        created_at: {
          gte: "2026-08-01T00:00:00.000Z",
          lte: "2026-08-24T23:59:59.999Z",
        },
        metadata: { source: "docs" },
      },
    },
  );
});

test("buildSearchFilters rejects inverted and impossible dates", () => {
  assert.deepEqual(buildSearchFilters({ fromDate: "2026-08-25", toDate: "2026-08-24" }), {
    ok: false,
    error: "From date must be on or before the to date.",
  });
  assert.deepEqual(buildSearchFilters({ fromDate: "2026-02-30" }), {
    ok: false,
    error: "From date is invalid.",
  });
});

test("optional JSON object parser rejects malformed and non-object values", () => {
  assert.deepEqual(parseOptionalJsonObject("[1,2]", "Metadata"), {
    ok: false,
    error: "Metadata must be a JSON object.",
  });
  assert.deepEqual(parseOptionalJsonObject("{oops", "Metadata"), {
    ok: false,
    error: "Metadata must be valid JSON.",
  });
});

test("upload type inference supports documented files and rejects binary media", () => {
  assert.equal(supportedUploadContentType("notes.md", ""), "text/plain");
  assert.equal(supportedUploadContentType("report.pdf", "application/pdf"), "application/pdf");
  assert.equal(supportedUploadContentType("data.json", "application/octet-stream"), "application/json");
  assert.equal(supportedUploadContentType("photo.jpg", "image/jpeg"), null);
});

test("search ordering preserves relevance and supports stable chronological order", () => {
  const messages = [
    { id: "relevance-first", created_at: "2026-08-20T12:00:00.000Z" },
    { id: "newest", created_at: "2026-08-24T12:00:00.000Z" },
    { id: "same-time-a", created_at: "2026-08-22T12:00:00.000Z" },
    { id: "same-time-b", created_at: "2026-08-22T12:00:00.000Z" },
    { id: "invalid", created_at: "not-a-date" },
  ];

  assert.deepEqual(orderSearchResults(messages, "relevance").map(({ id }) => id), [
    "relevance-first",
    "newest",
    "same-time-a",
    "same-time-b",
    "invalid",
  ]);
  assert.deepEqual(orderSearchResults(messages, "newest").map(({ id }) => id), [
    "newest",
    "same-time-a",
    "same-time-b",
    "relevance-first",
    "invalid",
  ]);
  assert.deepEqual(orderSearchResults(messages, "oldest").map(({ id }) => id), [
    "relevance-first",
    "same-time-a",
    "same-time-b",
    "newest",
    "invalid",
  ]);
});

test("session listing follows every Honcho page beyond the first 100", async () => {
  const total = 247;
  const allSessions = Array.from({ length: total }, (_, index) => ({
    id: `session-${String(index + 1).padStart(3, "0")}`,
  }));
  const requestedPages = [];
  const pageResponse = (page, size) => ({
    items: allSessions.slice((page - 1) * size, page * size),
    total,
    page,
    size,
    pages: Math.ceil(total / size),
  });
  const firstPage = Page.from(pageResponse(1, SESSION_LIST_PAGE_SIZE), async (page, size) => {
    requestedPages.push(page);
    return pageResponse(page, size);
  });
  const requestedOptions = [];
  const client = {
    async sessions(options) {
      requestedOptions.push(options);
      return firstPage;
    },
  };

  const result = await listAllSessions(client);

  assert.deepEqual(requestedOptions, [{ size: 100, reverse: true }]);
  assert.deepEqual(requestedPages, [2, 3]);
  assert.equal(result.length, total);
  assert.equal(result.at(-1)?.id, "session-247");
});

test("Honcho 3.1 capability detection protects older servers", () => {
  assert.equal(normalizeHonchoVersion("v3.0.12"), "3.0.12");
  assert.equal(normalizeHonchoVersion("unknown"), null);
  assert.equal(honcho31FromVersion("3.0.12"), "unsupported");
  assert.equal(honcho31FromVersion("3.1.0"), "available");
  assert.equal(honcho31FromVersion("4.0.0-rc.1"), "available");

  // A known older version is authoritative: do not probe any 3.1-only route.
  assert.equal(
    shouldProbeHoncho31({
      rawVersion: "3.0.12",
      openApiResolved: true,
      hasWorkspace: true,
    }),
    false,
  );
  // Custom/missing version metadata gets one safe endpoint fallback.
  assert.equal(
    shouldProbeHoncho31({
      rawVersion: "development",
      openApiResolved: true,
      hasWorkspace: true,
    }),
    true,
  );
  assert.equal(
    shouldProbeHoncho31({
      openApiResolved: false,
      openApiErrorStatus: 404,
      hasWorkspace: true,
    }),
    true,
  );
  assert.equal(
    shouldProbeHoncho31({
      openApiResolved: false,
      openApiErrorStatus: 0,
      hasWorkspace: true,
    }),
    false,
  );

  assert.equal(capabilityFromProbe({ loading: false, succeeded: true }), "available");
  assert.equal(
    capabilityFromProbe({ loading: false, succeeded: false, errorStatus: 404 }),
    "unsupported",
  );
  assert.equal(
    capabilityFromProbe({ loading: false, succeeded: false, errorStatus: 403 }),
    "restricted",
  );
});

test("Honcho SDK 2.4 drives scopes and scoped recall through the dashboard proxy", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const requestUrl = new URL(String(url));
    const method = init.method ?? "GET";
    const json = (value) =>
      new Response(JSON.stringify(value), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    if (requestUrl.pathname === "/v3/workspaces") {
      return json({ id: "workspace-1", metadata: {}, configuration: {}, created_at: "2026-08-26T00:00:00Z" });
    }
    if (requestUrl.pathname.endsWith("/scopes/list")) {
      const page = Number(requestUrl.searchParams.get("page") ?? "1");
      return json({
        items: [{ id: page === 1 ? "support" : "research", metadata: {}, created_at: "2026-08-26T00:00:00Z" }],
        total: 2,
        page,
        size: 100,
        pages: 2,
      });
    }
    if (requestUrl.pathname.endsWith("/scopes/support/sessions/list")) {
      return json({
        items: [{
          id: "session-1",
          workspace_id: "workspace-1",
          metadata: {},
          configuration: {},
          is_active: true,
          created_at: "2026-08-26T00:00:00Z",
        }],
        total: 1,
        page: 1,
        size: 100,
        pages: 1,
      });
    }
    if (requestUrl.pathname.endsWith("/scopes/support/status")) {
      return json({ backfill_status: {} });
    }
    if (requestUrl.pathname.endsWith("/scopes/support/sessions") && method === "POST") {
      return new Response(null, { status: 204 });
    }
    if (requestUrl.pathname.endsWith("/scopes/support/sessions/session-1") && method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    if (requestUrl.pathname.endsWith("/search")) return json([]);
    if (requestUrl.pathname.endsWith("/peers/user-1/chat")) return json({ content: "peer answer" });
    if (requestUrl.pathname.endsWith("/chat")) return json({ content: "workspace answer" });
    if (requestUrl.pathname.endsWith("/peers")) {
      return json({
        id: "user-1",
        workspace_id: "workspace-1",
        metadata: {},
        configuration: {},
        created_at: "2026-08-26T00:00:00Z",
      });
    }
    if (requestUrl.pathname.endsWith("/sessions")) {
      return json({
        id: "session-1",
        workspace_id: "workspace-1",
        metadata: {},
        configuration: {},
        is_active: true,
        created_at: "2026-08-26T00:00:00Z",
      });
    }
    if (requestUrl.pathname.endsWith("/context")) {
      return json({ id: "session-1", messages: [], summary: null, peer_representation: "", peer_card: [] });
    }
    throw new Error(`Unexpected request ${method} ${requestUrl.pathname}`);
  });

  const sdk = new Honcho({
    baseURL: "http://dashboard.local",
    workspaceId: "workspace-1",
    apiKey: "test-token",
    defaultHeaders: { "X-Honcho-Base-Url": "http://honcho.local:8000" },
    maxRetries: 0,
  });
  const scopes = await listAllScopes(sdk);
  const support = scopes.find(({ id }) => id === "support");
  assert.ok(support);
  const members = await listAllScopeSessions(support);
  await support.status();
  await support.addSessions(["session-1"]);
  await support.removeSession("session-1");
  await sdk.search("refunds", {
    scope: support,
    limit: 25,
  });
  const chat = await sdk.chat("What changed?", {
    scope: "research",
    reasoningLevel: "medium",
  });
  const peer = await sdk.peer("user-1");
  const peerChat = await peer.chat("What matters?", {
    scope: support,
    reasoningLevel: "low",
  });
  const session = await sdk.session("session-1");
  await session.context({
    summary: true,
    tokens: 4000,
    peerTarget: "user-1",
    scope: support,
  });

  assert.deepEqual(scopes.map(({ id }) => id), ["support", "research"]);
  assert.deepEqual(members.map(({ id }) => id), ["session-1"]);
  assert.equal(chat, "workspace answer");
  assert.equal(peerChat, "peer answer");
  assert.equal(calls.filter(({ url }) => new URL(url).pathname === "/v3/workspaces").length, 1);
  assert.ok(calls.every(({ init }) => new Headers(init.headers).get("X-Honcho-Base-Url") === "http://honcho.local:8000"));

  const searchCall = calls.find(({ url }) => new URL(url).pathname.endsWith("/search"));
  assert.deepEqual(JSON.parse(searchCall.init.body), {
    query: "refunds",
    scope: "support",
    limit: 25,
  });
  const workspaceChatCall = calls.find(({ url }) => new URL(url).pathname === "/v3/workspaces/workspace-1/chat");
  assert.deepEqual(JSON.parse(workspaceChatCall.init.body), {
    query: "What changed?",
    scope: "research",
    reasoning_level: "medium",
    stream: false,
  });
  const contextCall = calls.find(({ url }) => new URL(url).pathname.endsWith("/sessions/session-1/context"));
  assert.match(contextCall.url, /scope=support/);
  assert.match(contextCall.url, /peer_target=user-1/);
});
