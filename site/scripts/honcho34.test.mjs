import assert from "node:assert/strict";
import test from "node:test";
import { toApiPeer, toApiSession } from "../src/lib/honcho/adapters.ts";
import { capabilityAtVersion } from "../src/lib/honcho/capabilities.ts";
import { honcho } from "../src/lib/honcho/client.ts";
import {
  describeScopeKeyError,
  parseScopeKeyResponse,
  scopeKeyExpiresAt,
  scopeKeyPath,
} from "../src/lib/honcho/scopeKeys.ts";
import { HonchoApiError } from "../src/lib/honcho/types.ts";
import {
  expectedHeadIndex,
  invalidIndexProbe,
  queueIndexProbe,
  revisionProbe,
  schemaProbes,
} from "../src/lib/operator/schemaHealth.ts";
import {
  filterTraces,
  parseTraceLines,
  projectTrace,
  summarizeAgentRuns,
} from "../src/lib/operator/traceRecords.ts";

// Contracts from plastic-labs/honcho v3.4.0: src/schemas/api.py (uid),
// src/routers/keys.py (scope_id), migrations a5f8da8f6d23, and
// src/telemetry/events/{dream,dialectic}.py.
const opts = { baseUrl: "http://honcho.test:8000", token: "synthetic-admin-token" };
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json" },
});

test("uid is carried from SDK objects only when the server returned one", () => {
  const sdkPeer = (uid) => ({ id: "alice", workspaceId: "ws", metadata: {}, configuration: {}, createdAt: "2026-10-20T00:00:00Z", uid });
  assert.equal(toApiPeer(sdkPeer("peer-uid")).uid, "peer-uid");
  assert.equal(Object.hasOwn(toApiPeer(sdkPeer(undefined)), "uid"), false);
  assert.equal(Object.hasOwn(toApiPeer(sdkPeer("")), "uid"), false);
  const sdkSession = { id: "s1", workspaceId: "ws", metadata: {}, configuration: {}, isActive: true, createdAt: "2026-10-20T00:00:00Z", uid: "session-uid" };
  assert.equal(toApiSession(sdkSession).uid, "session-uid");
});

test("raw workspace and peer lists pass uid through unchanged", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    const path = new URL(String(url), "http://localhost").pathname;
    if (path.endsWith("/workspaces/list")) return json({ items: [{ id: "ws", uid: "ws-uid", metadata: {}, configuration: {}, created_at: "x" }], total: 1, page: 1, size: 50, pages: 1 });
    return json({ items: [{ id: "alice", uid: "peer-uid", workspace_id: "ws", created_at: "x" }], total: 1, page: 1, size: 50, pages: 1 });
  });
  assert.equal((await honcho.workspaces.list(opts)).items[0].uid, "ws-uid");
  assert.equal((await honcho.peers.list(opts, "ws")).items[0].uid, "peer-uid");
});

test("named-scope keys are gated on a verified 3.4.0 server", () => {
  assert.equal(capabilityAtVersion("3.3.0", [3, 4, 0]), "unsupported");
  assert.equal(capabilityAtVersion("3.4.0", [3, 4, 0]), "available");
  assert.equal(capabilityAtVersion("v3.4.1", [3, 4, 0]), "available");
  assert.equal(capabilityAtVersion("3.4.0-rc.1", [3, 4, 0]), "unsupported");
  assert.equal(capabilityAtVersion(undefined, [3, 4, 0]), "unknown");
});

test("scope key requests carry workspace, scope, and an ISO expiry as query parameters", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  assert.equal(scopeKeyExpiresAt("24h", now), "2026-10-23T12:00:00.000Z");
  assert.equal(scopeKeyExpiresAt("30d", now), "2026-11-21T12:00:00.000Z");
  assert.equal(scopeKeyExpiresAt("never", now), undefined);
  const path = scopeKeyPath({ workspaceId: "company", scopeId: "support", expiresAt: "2026-10-23T12:00:00.000Z" });
  const url = new URL(path, "http://x");
  assert.equal(url.pathname, "/v3/keys");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    workspace_id: "company", scope_id: "support", expires_at: "2026-10-23T12:00:00.000Z",
  });
  assert.equal(new URL(scopeKeyPath({ workspaceId: "w", scopeId: "s" }), "http://x").searchParams.has("expires_at"), false);
  assert.throws(() => scopeKeyPath({ workspaceId: "", scopeId: "s" }), /workspace/);
  assert.throws(() => scopeKeyPath({ workspaceId: "w", scopeId: "scope.support" }), /scope/);
  assert.throws(() => scopeKeyPath({ workspaceId: "w", scopeId: "s", expiresAt: "soon" }), /date/);
});

test("scope key responses and refusals are explained without echoing a malformed key", () => {
  assert.equal(parseScopeKeyResponse({ key: "a.b.c" }), "a.b.c");
  for (const bad of [null, {}, { key: 7 }, { key: "not-a-jwt" }]) {
    assert.throws(() => parseScopeKeyResponse(bad), /unexpected key response/);
  }
  assert.match(describeScopeKeyError(new HonchoApiError(405, "/x", "HTTP 405: Feature is disabled")), /AUTH_USE_AUTH=false/);
  assert.match(describeScopeKeyError(new HonchoApiError(401, "/x", "HTTP 401: Unauthorized")), /admin key/);
  assert.equal(describeScopeKeyError(new HonchoApiError(422, "/x", "HTTP 422: scope_id requires workspace_id")), "HTTP 422: scope_id requires workspace_id");
});

test("minting posts once with the instance token and returns only the key", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return json({ key: "header.payload.signature" });
  });
  const key = await honcho.keys.createScoped(opts, { workspaceId: "company", scopeId: "support", expiresAt: "2026-10-23T12:00:00.000Z" });
  assert.equal(key, "header.payload.signature");
  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  assert.equal(init.method, "POST");
  assert.equal(init.body, undefined);
  assert.equal(new Headers(init.headers).get("X-Honcho-Token"), opts.token);
  assert.equal(url, "/api/honcho/v3/keys?workspace_id=company&scope_id=support&expires_at=2026-10-23T12%3A00%3A00.000Z");
});

test("a disabled-auth server refuses minting with an operator explanation", async (t) => {
  t.mock.method(globalThis, "fetch", async () => json({ detail: "Feature is disabled" }, 405));
  await assert.rejects(honcho.keys.createScoped(opts, { workspaceId: "w", scopeId: "s" }), (error) => {
    assert.ok(error instanceof HonchoApiError);
    assert.match(describeScopeKeyError(error), /authentication disabled/);
    return true;
  });
});

const facts = (overrides = {}) => ({
  revision: "a5f8da8f6d23",
  invalidIndexes: [],
  presentQueueIndexes: [
    "ix_queue_pending_observers", "ix_queue_pending_observed", "ix_queue_pending_observer",
    "ix_queue_pending_scope_peer", "ix_queue_pending_session_name",
  ],
  btreeGin: true,
  ...overrides,
});

test("server versions map to the release migration heads", () => {
  assert.equal(expectedHeadIndex("3.1.2"), 0);
  assert.equal(expectedHeadIndex("3.2.1"), 1);
  assert.equal(expectedHeadIndex("3.2.2"), 2);
  assert.equal(expectedHeadIndex("3.3.0"), 3);
  assert.equal(expectedHeadIndex("3.4.0"), 4);
  assert.equal(expectedHeadIndex("3.4.2"), 4);
  // 3.5.0 and 3.6.0 are mapped now (honcho35/36 tests); a later minor is still unknown.
  assert.equal(expectedHeadIndex("3.5.0"), 5);
  assert.equal(expectedHeadIndex("3.7.0"), null);
  assert.equal(expectedHeadIndex("garbage"), null);
});

test("revision probe separates current, pending, compatible rollback, and unknown schemas", () => {
  assert.equal(revisionProbe(facts(), "3.4.0").status, "ok");
  const pending = revisionProbe(facts({ revision: "3e7a1c9d5b20" }), "3.4.0");
  assert.equal(pending.status, "warn");
  assert.match(pending.message, /expects a5f8da8f6d23.*migration/);
  const rolledBack = revisionProbe(facts(), "3.3.0");
  assert.equal(rolledBack.status, "ok");
  assert.match(rolledBack.message, /compatible back to 3\.2\.2/);
  assert.equal(revisionProbe(facts(), "3.2.0").status, "warn");
  assert.equal(revisionProbe(facts({ revision: "3e7a1c9d5b20" }), "3.2.2").status, "warn");
  assert.equal(revisionProbe(facts({ revision: "ffffffffffff" }), "3.4.0").status, "skip");
  assert.equal(revisionProbe(facts({ revision: null }), "3.4.0").status, "skip");
  assert.match(revisionProbe(facts(), "3.7.0").message, /Honcho 3\.4\.0–3\.4\.1 schema/);
  assert.match(revisionProbe(facts({ revision: "e4eba9cfaa6f" }), null).message, /3\.0\.12–3\.1\.2/);
});

test("invalid indexes and skipped 3.4 queue indexes are reported with a recovery step", () => {
  assert.equal(invalidIndexProbe(facts()).status, "ok");
  const invalid = invalidIndexProbe(facts({ invalidIndexes: ["ix_messages_content_trgm", "ix_queue_pending_observed"] }));
  assert.equal(invalid.status, "warn");
  assert.match(invalid.message, /ix_messages_content_trgm, ix_queue_pending_observed/);
  assert.equal(queueIndexProbe(facts()).message, "5/5 present");
  const skipped = queueIndexProbe(facts({ btreeGin: false, presentQueueIndexes: facts().presentQueueIndexes.slice(1) }));
  assert.equal(skipped.status, "warn");
  assert.match(skipped.message, /btree_gin is not installed/);
  const missing = queueIndexProbe(facts({ presentQueueIndexes: ["ix_queue_pending_observers"] }));
  assert.match(missing.message, /^1\/5 present · missing/);
  assert.equal(queueIndexProbe(facts({ revision: "3e7a1c9d5b20" })), null);
  assert.deepEqual(schemaProbes(facts({ revision: "3e7a1c9d5b20" }), "3.3.0").map((probe) => probe.id), [
    "db.schema_revision", "db.invalid_indexes",
  ]);
});

const cloudEvent = (type, data, version = 2, id = "run-evt") => ({
  id, specversion: "1.0", type, source: "/honcho/example",
  time: "2026-10-20T18:00:00Z", dataschema: `https://honcho.dev/schemas/${type}/v${version}`, data,
});

const dream34 = {
  run_id: "run-1", specialist_type: "deduction", workspace_name: "ws", observer: "alice", observed: "alice",
  iterations: 12, tool_calls_count: 18, input_tokens: 9000, output_tokens: 700, duration_ms: 4210.6, success: true,
  created_observation_count: 3, deleted_observation_count: 1, peer_card_updated: false, search_tool_calls_count: 6,
  hit_iteration_limit: true, iteration_limit: 12, budget_line_enabled: true, write_window_used: true,
  refused_search_count: 2, notes_added: 2, notes_replaced: 1, notes_removed: 0, notes_entries_loaded: 5,
  notes_tokens_loaded: 410, pending_loaded: 1, pending_resolved: 1, pending_expired: 0,
  new_conclusions_shown: 50, new_conclusions_remaining: 12,
  created_counts_by_level: { deductive: 3 }, custom_instructions_source: "workspace.dream",
  // Not allowlisted: must never be forwarded.
  notes: "private-canary", content: "private-canary", tool_input: { q: "private-canary" },
};

test("Honcho 3.4 dream specialist runs keep working-memory counters and drop content", () => {
  const record = projectTrace(cloudEvent("dream.specialist", dream34));
  assert.equal(record.type, "dream.specialist");
  assert.equal(record.schema_version, 2);
  assert.equal(record.metadata.outcome, "success");
  assert.equal(record.metadata.hit_iteration_limit, true);
  assert.equal(record.metadata.write_window_used, true);
  assert.equal(record.metadata.iteration_limit, 12);
  assert.equal(record.metadata.notes_added, 2);
  assert.equal(record.metadata.new_conclusions_remaining, 12);
  assert.equal(record.metadata.custom_instructions_source, "workspace.dream");
  assert.equal(record.metadata.created_counts_by_level, undefined);
  assert.ok(!JSON.stringify(record).includes("private-canary"));
  const failed = projectTrace(cloudEvent("dream.specialist", { ...dream34, success: false, error_class: "TimeoutError" }));
  assert.equal(failed.metadata.outcome, "error");
  assert.equal(failed.metadata.error_class, "TimeoutError");
});

test("dialectic runs have no outcome field, so none is invented", () => {
  const record = projectTrace(cloudEvent("dialectic.completed", {
    run_id: "run-2", workspace_name: "ws", peer_name: "alice", reasoning_level: "high",
    total_iterations: 5, total_duration_ms: 2200, input_tokens: 1, output_tokens: 1,
    hit_iteration_limit: false, iteration_limit: 5, budget_line_enabled: false,
  }));
  assert.equal(record.metadata.outcome, undefined);
  assert.equal(record.metadata.total_iterations, 5);
  assert.equal(projectTrace(cloudEvent("dialectic.completed", {}, 2)).type, "dialectic.completed");
  // A schema URL naming another event type is rejected.
  assert.equal(projectTrace({ ...cloudEvent("dialectic.completed", {}), dataschema: "https://honcho.dev/schemas/dream.specialist/v2" }), null);
});

test("agent-run rollup distinguishes 3.4 budget counters from older runs", () => {
  const before34 = { ...dream34 };
  for (const key of ["hit_iteration_limit", "iteration_limit", "budget_line_enabled", "write_window_used", "refused_search_count",
    "notes_added", "notes_replaced", "notes_removed", "notes_entries_loaded", "notes_tokens_loaded",
    "pending_loaded", "pending_resolved", "pending_expired", "new_conclusions_shown", "new_conclusions_remaining"]) delete before34[key];
  const { entries, skipped } = parseTraceLines([
    JSON.stringify(cloudEvent("dream.specialist", dream34, 2, "a")),
    JSON.stringify(cloudEvent("dream.specialist", before34, 2, "b")),
    JSON.stringify(cloudEvent("llm.call.traced", { model: "m" }, 2, "c")),
    JSON.stringify(cloudEvent("workspace.created", { workspace_name: "ws" }, 1, "d")),
  ].join("\n"));
  assert.equal(skipped, 1);
  assert.deepEqual(summarizeAgentRuns(entries), { runs: 2, withBudget: 1, hitIterationLimit: 1, writeWindowUsed: 1, notesTouched: 1 });
  assert.deepEqual(filterTraces(entries, "", "all", "agent").map((entry) => entry.id), ["b", "a"]);
  assert.deepEqual(filterTraces(entries, "", "all", "llm.call.traced").map((entry) => entry.id), ["c"]);
  assert.equal(projectTrace(cloudEvent("dream.specialist", before34)).metadata.hit_iteration_limit, undefined);
});
