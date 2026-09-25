import assert from "node:assert/strict";
import test from "node:test";
import { Honcho } from "@honcho-ai/sdk";
import { capabilityAtVersion } from "../src/lib/honcho/capabilities.ts";
import { chatWithEvidence } from "../src/lib/honcho/chat.ts";
import { getConclusion, getPremises, getDerived } from "../src/lib/honcho/provenance.ts";
import { parseDeriverMetrics, formatDuration } from "../src/lib/honcho/deriverMetrics.ts";
import { honcho } from "../src/lib/honcho/client.ts";

const conclusion = (id, sources = null) => ({ id, content: `Fact ${id}`, observer_id: "alice", observed_id: "alice", session_id: null,
  level: sources?.length ? "deductive" : "explicit", source_ids: sources, times_derived: 3, created_at: "2026-09-18T00:00:00Z" });
const evidence = { conclusions: [{ ...conclusion("child", ["parent"]), source_ids: ["parent"] }],
  messages: [{ id: "message-1", session_id: "session-1", peer_id: "alice", created_at: "2026-09-18T00:00:00Z" }],
  tool_calls: [{ tool_name: "query_memory", tool_input: { query: "meetings" } }], reasoning_trace_id: "trace-1" };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const options = { reasoningLevel: "low", includeEvidence: true, evidenceCapability: "available" };

test("new capability gates distinguish exact minimums, unknowns, and prereleases", () => {
  for (const version of ["3.0.12", "3.1.0", "3.1.2", "3.2.0-rc.1"]) assert.equal(capabilityAtVersion(version, [3, 2, 0]), "unsupported");
  for (const version of ["v3.2.0", "3.2", "3.2.1", "3.2.0+build.4", "3.2.0+build-4", "4.0.0"]) assert.equal(capabilityAtVersion(version, [3, 2, 0]), "available");
  assert.equal(capabilityAtVersion("3.2.0-rc.1+build-4", [3, 2, 0]), "unsupported");
  for (const version of [undefined, "unknown", "development", "3.2garbage"]) assert.equal(capabilityAtVersion(version, [3, 2, 0]), "unknown");
  assert.equal(capabilityAtVersion("3.1.1", [3, 1, 2]), "unsupported");
  assert.equal(capabilityAtVersion("3.1.2", [3, 1, 2]), "available");
});

test("3.2 service calls fail closed before any SDK access on unsupported/unknown servers", async () => {
  const sdk = new Proxy({}, { get() { assert.fail("Must not access the SDK"); } });
  for (const state of ["unsupported", "unknown", "checking", "restricted"]) {
    await assert.rejects(chatWithEvidence(sdk, "hello", { ...options, evidenceCapability: state }), /3.2/);
    await assert.rejects(getConclusion(sdk, "child", state), /3.2/);
    await assert.rejects(getPremises(sdk, ["parent"], 1, state), /3.2/);
    await assert.rejects(getDerived(sdk, "parent", 1, state), /3.2/);
  }
});

test("peer/workspace evidence passes recall boundaries and retains null/empty evidence", async (t) => {
  const bodies = [];
  let returnedEvidence = evidence;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/v3/workspaces") return json({ id: "test" });
    if (path.endsWith("/peers")) return json({ id: "alice", workspace_id: "test" });
    assert.ok(path.endsWith("/chat"));
    bodies.push(JSON.parse(init.body));
    return json({ content: "Morning meetings", evidence: returnedEvidence });
  });
  const sdk = new Honcho({ baseURL: "http://honcho.test", workspaceId: "test", apiKey: "synthetic", maxRetries: 0 });
  assert.deepEqual(await chatWithEvidence(sdk, "When?", { ...options, peerId: "alice", session: "session-1" }),
    { content: "Morning meetings", evidence, evidenceRequested: true });
  assert.deepEqual(await chatWithEvidence(sdk, "When?", { ...options, scope: "support" }),
    { content: "Morning meetings", evidence, evidenceRequested: true });
  assert.equal(bodies[0].session_id, "session-1");
  assert.equal(bodies[0].include_evidence, true);
  assert.equal(bodies[1].scope, "support");
  returnedEvidence = null;
  assert.equal((await chatWithEvidence(sdk, "When?", options)).evidence, null);
  returnedEvidence = { conclusions: [], messages: [], tool_calls: [], reasoning_trace_id: null };
  assert.deepEqual((await chatWithEvidence(sdk, "When?", options)).evidence, returnedEvidence);
  const plain = await chatWithEvidence(sdk, "When?", { ...options, includeEvidence: false, evidenceCapability: "unsupported" });
  assert.equal(plain.content, "Morning meetings");
  assert.equal(plain.evidenceRequested, false);
  assert.equal(Object.hasOwn(bodies.at(-1), "include_evidence"), false);
});

test("provenance uses batched ordered premises, missing markers and workspace-wide paginated backlinks", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/v3/workspaces") return json({ id: "test" });
    if (path.endsWith("/conclusions/child")) return json(conclusion("child", ["parent-2", "missing", "parent-1"]));
    assert.ok(path.endsWith("/conclusions/list"));
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), body });
    if (body.filters.source_ids) return json({ items: [conclusion("child", ["parent-1"])], page: 2, size: 25, pages: 3, total: 60 });
    return json({ items: [conclusion("parent-1"), conclusion("parent-2")], page: 1, size: 100, pages: 1, total: 2 });
  });
  const sdk = new Honcho({ baseURL: "http://honcho.test", workspaceId: "test", apiKey: "synthetic", maxRetries: 0 });
  const child = await getConclusion(sdk, "child", "available");
  const parents = await getPremises(sdk, [...child.source_ids, "parent-1"], 1, "available");
  assert.deepEqual(parents.items.map((item) => item.id), ["parent-2", "missing", "parent-1"]);
  assert.equal(parents.items[1].conclusion, null);
  const before = requests.length;
  assert.deepEqual(await getPremises(sdk, [], 1, "available"), { items: [], pages: 1 });
  assert.equal(requests.length, before);
  const derived = await getDerived(sdk, "parent-1", 2, "available");
  assert.equal(derived.pages, 3);
  assert.deepEqual(requests.at(-1).body.filters, { source_ids: { contains: "parent-1" } });
  assert.equal(new URL(requests.at(-1).url).searchParams.get("page"), "2");
});

for (const version of ["3.2.0", "3.2.1"]) {
  test(`SDK 2.5.1 preserves ${version} evidence attribution and explicit conclusion provenance`, async (t) => {
    const { observer_id, observed_id, ...legacyRecord } = evidence.conclusions[0];
    const records = version === "3.2.0" ? [legacyRecord] : [
      { ...legacyRecord, observer_id, observed_id },
      { ...legacyRecord, id: "other-pair", observer_id: "assistant", observed_id: "bob" },
    ];
    const returnedEvidence = { ...evidence, conclusions: records };
    const explicit = conclusion("explicit", version === "3.2.0" ? null : []);
    const calls = [];
    t.mock.method(globalThis, "fetch", async (url, init) => {
      const path = new URL(url).pathname;
      calls.push(path);
      if (path === "/v3/workspaces") return json({ id: "test" });
      if (path.endsWith("/peers")) return json({ id: "alice", workspace_id: "test" });
      if (path.endsWith("/chat")) {
        assert.equal(JSON.parse(init.body).include_evidence, true);
        return json({ content: "Answer", evidence: returnedEvidence });
      }
      if (path.endsWith("/conclusions/explicit")) return json(explicit);
      assert.fail(`Unexpected request: ${path}`);
    });
    const sdk = new Honcho({ baseURL: "http://honcho.test", workspaceId: "test", apiKey: "synthetic", maxRetries: 0 });
    for (const peerId of ["alice", undefined]) {
      const reply = await chatWithEvidence(sdk, "When?", { ...options, peerId });
      assert.deepEqual(reply.evidence, returnedEvidence);
      if (version === "3.2.0") assert.equal(Object.hasOwn(reply.evidence.conclusions[0], "observer_id"), false);
    }
    const detail = await getConclusion(sdk, "explicit", "available");
    assert.deepEqual(detail, explicit);
    const before = calls.length;
    assert.deepEqual(await getPremises(sdk, detail.source_ids ?? [], 1, "available"), { items: [], pages: 1 });
    assert.equal(calls.length, before, "No parent reads for either null or empty source IDs");
  });
}

test("missing, null and partial evidence attribution remains usable on older responses", async () => {
  for (const attribution of [{}, { observer_id: null, observed_id: null }, { observer_id: "alice" }, { observed_id: "bob" }]) {
    const legacyRecord = { ...evidence.conclusions[0] };
    delete legacyRecord.observer_id;
    delete legacyRecord.observed_id;
    const result = { content: "Answer", evidence: { ...evidence, conclusions: [{ ...legacyRecord, ...attribution }] } };
    assert.deepEqual((await chatWithEvidence({ chat: async () => result }, "hello", options)).evidence, result.evidence);
  }
});

test("evidence and provenance propagate permission and missing-resource failures", async (t) => {
  let status = 403;
  t.mock.method(globalThis, "fetch", async (url) => new URL(url).pathname === "/v3/workspaces"
    ? json({ id: "test" }) : json({ detail: "Unavailable" }, status));
  const sdk = new Honcho({ baseURL: "http://honcho.test", workspaceId: "test", apiKey: "synthetic", maxRetries: 0 });
  await assert.rejects(chatWithEvidence(sdk, "hi", options), (e) => e.status === 403);
  status = 404;
  await assert.rejects(getConclusion(sdk, "missing", "available"), (e) => e.status === 404);
});

test("metrics reject malformed values and preserve legitimate zero backlog", () => {
  const snapshot = { outstanding_work_seconds: 0, eligible_work_units: 0, claimed_work_units: 0, pending_items: 0,
    oldest_pending_age_seconds: 0, embeddings_pending: 0, embeddings_pending_due: 0, dreams_due: 0,
    measured_at: 1789730000, measurement_age_seconds: 2 };
  assert.deepEqual(parseDeriverMetrics(snapshot), snapshot);
  for (const bad of [null, {}, { ...snapshot, dreams_due: "0" }, { ...snapshot, pending_items: -1 }, { ...snapshot, measurement_age_seconds: Infinity }]) {
    assert.throws(() => parseDeriverMetrics(bad), /Invalid deriver/);
  }
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(3661), "1h 1m");
});

test("evidence message retrieval is a single read, with encoded IDs and retryable errors", async (t) => {
  const calls = [];
  let status = 200;
  let response = { id: "message-1", content: "Synthetic message" };
  const signal = new AbortController().signal;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    return json(status === 200 ? response : { detail: "Unavailable" }, status);
  });
  const opts = { baseUrl: "http://honcho.test", token: "synthetic", signal };
  assert.equal((await honcho.messages.get(opts, "space name", "session/name", "message?1")).content, "Synthetic message");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/honcho/v3/workspaces/space%20name/sessions/session%2Fname/messages/message%3F1");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.signal, signal);
  assert.equal(calls[0].init.headers["X-Honcho-Token"], "synthetic");
  for (status of [403, 404, 503]) {
    await assert.rejects(honcho.messages.get(opts, "test", "session", "missing"), e => e.status === status);
  }
  status = 200;
  response = { content: {} };
  await assert.rejects(honcho.messages.get(opts, "test", "session", "message"), /Invalid message response/);
  assert.ok(calls.every(({init}) => init.method === "GET"));
});

test("malformed chat content and evidence fail in the service instead of crashing the transcript", async () => {
  for (const bad of [null, {}, {content: {}, evidence: null},
    ...[{}, {...evidence, conclusions: null}, {...evidence, conclusions: [{content: {}}]},
      {...evidence, messages: [null]}, {...evidence, tool_calls: [{tool_name: {}}]},
      ...["observer_id", "observed_id"].flatMap(key => [42, {}, []].map(value =>
        ({...evidence, conclusions: [{...evidence.conclusions[0], [key]: value}]}))),
      {...evidence, reasoning_trace_id: {}}].map(evidence => ({content: "Answer", evidence}))]) {
    await assert.rejects(chatWithEvidence({chat: async () => bad}, "hello", options), /Invalid chat response/);
  }
  await assert.rejects(chatWithEvidence({chat: async () => ({})}, "hello", {...options, includeEvidence: false}), /Invalid chat response/);
});
