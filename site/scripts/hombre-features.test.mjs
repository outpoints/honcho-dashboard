import assert from "node:assert/strict";
import test from "node:test";
import { getSdk, invalidateSdk } from "../src/lib/honcho/sdk.ts";
import { streamChatWithEvidence } from "../src/lib/honcho/chat.ts";
import { TRASH_LIMIT, dropTrash, pushTrash, readTrash, trashScope } from "../src/lib/conclusionTrash.ts";
import { formatAge, queueProgress } from "../src/lib/syncStatus.ts";

const opts = { baseUrl: "http://honcho.test:8000", token: "synthetic-test-token" };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const sse = (events) => new Response(new ReadableStream({
  start(controller) {
    const encoder = new TextEncoder();
    // Split mid-event to exercise the SDK's line buffering.
    const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
    controller.enqueue(encoder.encode(text.slice(0, 25)));
    controller.enqueue(encoder.encode(text.slice(25)));
    controller.close();
  },
}), { status: 200, headers: { "content-type": "text/event-stream" } });

test("streamed peer chat reports the growing answer and reads evidence from the terminal event", async (t) => {
  invalidateSdk();
  t.after(invalidateSdk);
  const bodies = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const path = new URL(String(url), "http://localhost").pathname;
    if (path === "/v3/workspaces") return json({ id: "ws" });
    if (path.endsWith("/peers")) return json({ id: "alice", workspace_id: "ws" });
    bodies.push(JSON.parse(init.body));
    const evidence = { conclusions: [{ id: "c1", content: "likes tea", level: "explicit" }], messages: [], tool_calls: [], reasoning_trace_id: null };
    return sse([
      { done: false, delta: { content: "Alice " } },
      { done: false, delta: { content: "likes tea." } },
      { done: true, delta: {}, evidence: bodies.at(-1).include_evidence ? evidence : null },
    ]);
  });
  const seen = [];
  const sdk = getSdk(opts, "ws");
  const base = { peerId: "alice", reasoningLevel: "low", evidenceCapability: "available" };
  const plain = await streamChatWithEvidence(sdk, "What does Alice like?", { ...base, includeEvidence: false }, (text) => seen.push(text));
  assert.deepEqual(seen, ["Alice ", "Alice likes tea."]);
  assert.equal(plain.content, "Alice likes tea.");
  assert.equal(plain.evidenceRequested, false);
  assert.equal(Object.hasOwn(bodies[0], "include_evidence"), false);
  assert.equal(bodies[0].stream, true);

  const withEvidence = await streamChatWithEvidence(sdk, "What does Alice like?", { ...base, includeEvidence: true }, () => {});
  assert.equal(withEvidence.evidence.conclusions[0].id, "c1");
  await assert.rejects(
    streamChatWithEvidence(sdk, "q", { ...base, includeEvidence: true, evidenceCapability: "unknown" }, () => {}),
    /verified Honcho 3\.2\+/,
  );
});

test("queue progress counts what Honcho reported and never invents work", () => {
  assert.deepEqual(queueProgress({ total_work_units: 0, completed_work_units: 0, in_progress_work_units: 0, pending_work_units: 0 }),
    { state: "empty", total: 0, done: 0, pending: 0, running: 0, percent: null });
  assert.deepEqual(queueProgress({ total_work_units: 40, completed_work_units: 30, in_progress_work_units: 2, pending_work_units: 8 }),
    { state: "syncing", total: 40, done: 30, pending: 8, running: 2, percent: 75 });
  assert.equal(queueProgress({ total_work_units: 3, completed_work_units: 3, in_progress_work_units: 0, pending_work_units: 0 }).state, "synced");
  assert.equal(queueProgress({ total_work_units: 2, completed_work_units: 9, in_progress_work_units: -1, pending_work_units: null }).done, 2);
  assert.equal(formatAge(undefined, 0), "not yet");
  assert.equal(formatAge(1_000, 3_000), "just now");
  assert.equal(formatAge(0, 42_000), "42s ago");
  assert.equal(formatAge(0, 5 * 60_000), "5m ago");
  assert.equal(formatAge(0, 3 * 3_600_000), "3h ago");
});

function memoryStore() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), data };
}

const conclusion = (id) => ({ id, content: `fact ${id}`, observer_id: "a", observed_id: "a", session_id: null, level: "deductive", created_at: "x" });

test("the conclusion trash is scoped per instance and workspace, newest first, and bounded", () => {
  const store = memoryStore();
  const a = trashScope("http://one.test/", "ws");
  const b = trashScope("http://one.test", "other");
  assert.equal(a, "http://one.test::ws");
  pushTrash(store, a, conclusion("1"), new Date("2026-10-22T00:00:00Z"));
  pushTrash(store, a, conclusion("2"));
  pushTrash(store, a, conclusion("1"));
  pushTrash(store, b, conclusion("9"));
  assert.deepEqual(readTrash(store, a).map((item) => item.conclusion.id), ["1", "2"]);
  assert.deepEqual(readTrash(store, b).map((item) => item.conclusion.id), ["9"]);
  dropTrash(store, a, "1");
  assert.deepEqual(readTrash(store, a).map((item) => item.conclusion.id), ["2"]);
  dropTrash(store, a);
  assert.deepEqual(readTrash(store, a), []);
  assert.ok(!JSON.parse(store.getItem("honcho-dashboard:conclusion-trash"))[a]);
  for (let i = 0; i < TRASH_LIMIT + 5; i++) pushTrash(store, a, conclusion(`n${i}`));
  assert.equal(readTrash(store, a).length, TRASH_LIMIT);
  assert.equal(readTrash(store, a)[0].conclusion.id, `n${TRASH_LIMIT + 4}`);
  store.setItem("honcho-dashboard:conclusion-trash", "{not json");
  assert.deepEqual(readTrash(store, a), []);
});
