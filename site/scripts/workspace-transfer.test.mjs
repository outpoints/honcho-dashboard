import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_IMPORT_OPTIONS,
  MESSAGE_BATCH_SIZE,
  SNAPSHOT_FORMAT,
  SnapshotError,
  batchMessages,
  exportWorkspace,
  isDefiniteRejection,
  parseWorkspaceSnapshot,
  planImport,
  planStillValid,
  renamedSessionId,
  runImport,
} from "../src/lib/honcho/workspaceTransfer.ts";

const message = (peer, content, created_at) => ({ id: `m-${content}`, peer_id: peer, content, metadata: {}, created_at });

const snapshot = () => parseWorkspaceSnapshot({
  format: SNAPSHOT_FORMAT,
  version: 1,
  exported_at: "2026-10-22T00:00:00Z",
  source: { honcho_version: "3.4.0" },
  workspace: { id: "source", uid: "ws-uid", metadata: { team: "demo" }, configuration: { reasoning: { enabled: true } } },
  peers: [
    { id: "alice", metadata: { role: "user" }, configuration: { observe_me: true } },
    { id: "assistant", metadata: {}, configuration: { observe_me: false } },
    { id: "scope.support", metadata: {}, configuration: {} },
  ],
  sessions: [
    {
      id: "s1", metadata: { topic: "a" }, configuration: {}, is_active: true,
      peers: [{ id: "alice", config: { observe_me: true, observe_others: false } }, { id: "assistant" }, { id: "scope.support" }],
      messages: [message("alice", "hi", "2026-01-01T00:00:00Z"), message("assistant", "hello", "2026-01-01T00:00:01Z")],
    },
    { id: "s2", metadata: {}, configuration: {}, is_active: false, peers: ["alice"], messages: [message("alice", "again")] },
  ],
  conclusions: [
    { id: "c1", content: "Alice prefers mornings", observer_id: "alice", observed_id: "alice", session_id: "s1", level: "deductive" },
    { id: "c2", content: "scoped copy", observer_id: "scope.support", observed_id: "alice", session_id: null },
    { id: "c3", content: "about s2", observer_id: "alice", observed_id: "alice", session_id: "s2" },
  ],
  scopes: [{ id: "support", metadata: {}, sessions: ["s1"] }],
});

const emptyTarget = (overrides = {}) => ({ exists: false, peers: new Set(), sessions: new Set(), scopes: new Set(), ...overrides });

test("dashboard snapshots parse; internal scope peers are dropped", () => {
  const parsed = snapshot();
  assert.deepEqual(parsed.peers.map((p) => p.id), ["alice", "assistant"]);
  assert.deepEqual(parsed.sessions[0].peers, [
    { id: "alice", config: { observe_me: true, observe_others: false } },
    { id: "assistant" },
  ]);
  assert.equal(parsed.sessions[0].messages[0].created_at, "2026-01-01T00:00:00Z");
  assert.equal(parsed.source.honcho_version, "3.4.0");
  assert.equal(parsed.workspace.uid, "ws-uid");
});

test("Hombre exports are read with messages keyed by session", () => {
  const parsed = parseWorkspaceSnapshot({
    hombre_export: true, version: "1.0", export_date: "2026-08-01T00:00:00Z", workspace_id: "legacy",
    data: {
      peers: [{ id: "bob", workspace_id: "legacy", metadata: {}, configuration: {}, created_at: "x" }],
      sessions: [{ id: "chat", workspace_id: "legacy", is_active: true, metadata: {}, configuration: {}, created_at: "x" }],
      conclusions: [],
      messages: { chat: [{ id: "m1", peer_id: "bob", content: "yo", metadata: {}, created_at: "2026-08-01T00:00:00Z" }] },
    },
  });
  assert.equal(parsed.source.kind, "hombre");
  assert.equal(parsed.workspace.id, "legacy");
  assert.equal(parsed.sessions[0].messages.length, 1);
  assert.equal(parsed.scopes, null);
});

test("malformed or unknown files fail with an operator message", () => {
  assert.throws(() => parseWorkspaceSnapshot([]), SnapshotError);
  assert.throws(() => parseWorkspaceSnapshot({ hello: 1 }), /Unrecognized file/);
  assert.throws(() => parseWorkspaceSnapshot({ format: SNAPSHOT_FORMAT, version: 2 }), /Unsupported snapshot version 2/);
  const base = { format: SNAPSHOT_FORMAT, version: 1, workspace: { id: "w" }, peers: [], sessions: [] };
  assert.throws(() => parseWorkspaceSnapshot({ ...base, workspace: { id: "bad id" } }), /invalid id/);
  assert.throws(() => parseWorkspaceSnapshot({ ...base, sessions: [{ id: "a" }, { id: "a" }] }), /appears twice/);
  assert.throws(() => parseWorkspaceSnapshot({ ...base, sessions: [{ id: "a", messages: [{ peer_id: "p" }] }] }), /no text content/);
});

test("planning into a new workspace creates everything and enrolls scope members", () => {
  const plan = planImport(snapshot(), "copy", emptyTarget(), DEFAULT_IMPORT_OPTIONS);
  assert.equal(plan.createWorkspace, true);
  assert.deepEqual(plan.workspaceMetadata, { team: "demo" });
  assert.deepEqual(plan.peersToCreate.map((p) => p.id), ["alice", "assistant"]);
  assert.deepEqual(plan.sessions.map((s) => [s.targetId, s.action, s.scopes]), [["s1", "create", ["support"]], ["s2", "create", []]]);
  assert.equal(plan.messageCount, 3);
  assert.equal(plan.messageBatches, 2);
  assert.deepEqual(plan.scopesToCreate.map((s) => s.id), ["support"]);
  assert.ok(plan.warnings.some((w) => /queue 3 imported messages/.test(w)));
});

test("merging into an existing workspace reuses peers and skips or renames sessions", () => {
  const target = emptyTarget({ exists: true, peers: new Set(["alice"]), sessions: new Set(["s1", "s1-imported"]), scopes: new Set(["support"]) });
  const skip = planImport(snapshot(), "dest", target, DEFAULT_IMPORT_OPTIONS);
  assert.equal(skip.createWorkspace, false);
  assert.deepEqual(skip.peersReused, ["alice"]);
  assert.deepEqual(skip.peersToCreate.map((p) => p.id), ["assistant"]);
  assert.deepEqual(skip.sessions.map((s) => [s.sourceId, s.action]), [["s1", "skip"], ["s2", "create"]]);
  assert.equal(skip.sessions[0].messages.length, 0);
  assert.deepEqual(skip.scopesReused, ["support"]);
  assert.ok(skip.warnings.some((w) => /already exist in the target and will be left untouched/.test(w)));

  const rename = planImport(snapshot(), "dest", target, { ...DEFAULT_IMPORT_OPTIONS, sessionConflict: "rename" });
  assert.deepEqual(rename.sessions.map((s) => [s.targetId, s.renamed]), [["s1-imported-2", true], ["s2", false]]);
  assert.deepEqual(rename.sessions[0].scopes, ["support"]);
});

test("conclusions are remapped, skipped for internal peers, and detached from skipped sessions", () => {
  const target = emptyTarget({ exists: true, sessions: new Set(["s2"]) });
  const plan = planImport(snapshot(), "dest", target, { ...DEFAULT_IMPORT_OPTIONS, conclusions: true, derive: true });
  assert.deepEqual(plan.conclusions, [
    { content: "Alice prefers mornings", observer_id: "alice", observed_id: "alice", session_id: "s1" },
    { content: "about s2", observer_id: "alice", observed_id: "alice", session_id: null },
  ]);
  assert.equal(plan.conclusionsSkipped, 1);
  assert.equal(plan.conclusionsDetached, 1);
  assert.ok(plan.warnings.some((w) => /duplicate memory/.test(w)));
  assert.ok(plan.warnings.some((w) => /stored as explicit/.test(w)));
});

test("targets without scopes keep the import usable and say what is left out", () => {
  const plan = planImport(snapshot(), "dest", emptyTarget({ scopes: null }), DEFAULT_IMPORT_OPTIONS);
  assert.deepEqual(plan.scopesToCreate, []);
  assert.deepEqual(plan.sessions[0].scopes, []);
  assert.ok(plan.warnings.some((w) => /cannot use named scopes, so 1 scope is not imported/.test(w)));
  assert.throws(() => planImport(snapshot(), "bad target", emptyTarget(), DEFAULT_IMPORT_OPTIONS), /invalid id/);
});

test("renaming stays within Honcho's id limit and batches respect count and size", () => {
  assert.equal(renamedSessionId("a", new Set()), "a-imported");
  assert.equal(renamedSessionId("a", new Set(["a-imported", "a-imported-2"])), "a-imported-3");
  assert.equal(renamedSessionId("x".repeat(512), new Set()).length, 512);
  const many = Array.from({ length: 250 }, (_, i) => ({ content: String(i) }));
  assert.deepEqual(batchMessages(many).map((b) => b.length), [MESSAGE_BATCH_SIZE, MESSAGE_BATCH_SIZE, 50]);
  const big = [{ content: "a".repeat(900_000) }, { content: "b".repeat(200_000) }, { content: "c" }];
  assert.deepEqual(batchMessages(big).map((b) => b.length), [1, 2]);
});

test("a target that changed after preview is rejected before any write", () => {
  const plan = planImport(snapshot(), "dest", emptyTarget(), DEFAULT_IMPORT_OPTIONS);
  assert.equal(planStillValid(plan, emptyTarget()), null);
  assert.match(planStillValid(plan, emptyTarget({ exists: true })), /created since the preview/);
  const existing = planImport(snapshot(), "dest", emptyTarget({ exists: true }), DEFAULT_IMPORT_OPTIONS);
  assert.match(planStillValid(existing, emptyTarget({ exists: true, sessions: new Set(["s2"]) })), /Session s2 now exists/);
  assert.match(planStillValid(existing, emptyTarget()), /no longer exists/);
});

function recordingTarget(behaviour = {}) {
  const calls = [];
  return {
    calls,
    target: {
      createWorkspace: async (body) => { calls.push(["workspace", body.id]); },
      createPeer: async (body) => { calls.push(["peer", body.id]); if (behaviour.peer?.[body.id]) throw behaviour.peer[body.id]; },
      createSession: async (body) => { calls.push(["session", body.id, body.peers]); },
      createScope: async (id) => { calls.push(["scope", id]); },
      addSessionsToScope: async (scope, ids) => { calls.push(["member", scope, ids]); },
      addMessages: async (sessionId, messages) => {
        calls.push(["messages", sessionId, messages]);
        const error = behaviour.messages?.[sessionId];
        if (error) throw error;
        return messages.length;
      },
      createConclusions: async (items) => { calls.push(["conclusions", items.length]); return items.length; },
    },
  };
}

const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

test("import writes in dependency order, keeps timestamps, and can store without reasoning", async () => {
  const plan = planImport(snapshot(), "copy", emptyTarget(), { ...DEFAULT_IMPORT_OPTIONS, derive: false });
  const { calls, target } = recordingTarget();
  const result = await runImport(plan, target);
  assert.equal(result.stopped, null);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(calls.map((c) => c[0]), ["workspace", "peer", "peer", "scope", "session", "member", "messages", "session", "messages"]);
  const [, , peers] = calls.find((c) => c[0] === "session");
  assert.deepEqual(peers, { alice: { observe_me: true, observe_others: false }, assistant: {} });
  const [, , batch] = calls.find((c) => c[0] === "messages");
  assert.equal(batch[0].created_at, "2026-01-01T00:00:00Z");
  assert.deepEqual(batch[0].configuration, { reasoning: { enabled: false } });
  assert.equal(result.messagesWritten, 3);
});

test("a rejected batch is recorded and the import continues; an ambiguous one stops it", async () => {
  assert.equal(isDefiniteRejection(httpError(422)), true);
  assert.equal(isDefiniteRejection(httpError(408)), false);
  assert.equal(isDefiniteRejection(httpError(502)), false);
  assert.equal(isDefiniteRejection(new Error("network")), false);

  const plan = planImport(snapshot(), "copy", emptyTarget(), DEFAULT_IMPORT_OPTIONS);
  const rejected = recordingTarget({ messages: { s1: httpError(422) } });
  const partial = await runImport(plan, rejected.target);
  assert.equal(partial.stopped, null);
  assert.equal(partial.failures.length, 1);
  assert.equal(partial.messagesWritten, 1);
  assert.ok(rejected.calls.some((c) => c[0] === "session" && c[1] === "s2"));

  const ambiguous = recordingTarget({ messages: { s1: httpError(502) } });
  const stopped = await runImport(plan, ambiguous.target);
  assert.match(stopped.stopped, /outcome of s1 batch 1 is unknown/);
  assert.equal(ambiguous.calls.some((c) => c[0] === "session" && c[1] === "s2"), false);
});

test("a failed peer skips its sessions, and abort stops before the next write", async () => {
  const plan = planImport(snapshot(), "copy", emptyTarget(), DEFAULT_IMPORT_OPTIONS);
  const { calls, target } = recordingTarget({ peer: { assistant: httpError(422) } });
  const result = await runImport(plan, target);
  assert.ok(result.failures.some((f) => f.step === "session" && /peer assistant/.test(f.message)));
  assert.equal(calls.some((c) => c[0] === "session" && c[1] === "s1"), false);
  assert.ok(calls.some((c) => c[0] === "session" && c[1] === "s2"));

  const controller = new AbortController();
  const aborting = recordingTarget();
  aborting.target.createPeer = async () => { controller.abort(); };
  const aborted = await runImport(plan, aborting.target, { signal: controller.signal });
  assert.match(aborted.stopped, /Stopped by the operator/);
  assert.equal(aborting.calls.some((c) => c[0] === "session"), false);
});

test("export reads the workspace into a snapshot the importer accepts", async () => {
  const source = {
    getWorkspace: async () => ({ id: "live", uid: "u", metadata: {}, configuration: {}, created_at: "x" }),
    listPeers: async () => [{ id: "alice", metadata: {}, configuration: {} }, { id: "scope.team", metadata: {}, configuration: {} }],
    listSessions: async () => [{ id: "s1", metadata: {}, configuration: {}, is_active: true }],
    listSessionPeers: async () => ["alice", "scope.team"],
    sessionPeerConfig: async () => ({ observe_me: null, observe_others: true }),
    listMessages: async () => [{ id: "m1", peer_id: "alice", content: "hi", metadata: {}, created_at: "2026-01-01T00:00:00Z" }],
    listConclusions: async () => [{ id: "c", content: "x", observer_id: "alice", observed_id: "alice", level: "explicit", source_ids: [] }],
    listScopes: async () => [{ id: "team", metadata: {}, sessions: ["s1"] }],
  };
  const progress = [];
  const exported = await exportWorkspace(source, { messages: true, conclusions: true, scopes: true }, {
    onProgress: (p) => progress.push(p.phase), honchoVersion: "3.4.0", now: () => new Date("2026-10-22T00:00:00Z"),
  });
  assert.deepEqual(exported.peers.map((p) => p.id), ["alice"]);
  assert.deepEqual(exported.sessions[0].peers, [{ id: "alice", config: { observe_me: null, observe_others: true } }]);
  assert.equal(exported.exported_at, "2026-10-22T00:00:00.000Z");
  assert.ok(progress.includes("SESSIONS") && progress.includes("SCOPES"));
  const roundTrip = parseWorkspaceSnapshot(JSON.parse(JSON.stringify(exported)));
  assert.deepEqual(roundTrip, exported);

  const lean = await exportWorkspace(source, { messages: false, conclusions: false, scopes: false });
  assert.equal(lean.sessions[0].messages, null);
  assert.equal(lean.conclusions, null);
  assert.equal(lean.scopes, null);
  await assert.rejects(exportWorkspace({ ...source, getWorkspace: async () => null }, { messages: false, conclusions: false, scopes: false }), /not found/);
});
