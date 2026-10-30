import assert from "node:assert/strict";
import test from "node:test";
import { honcho35Capability, HONCHO_35_FEATURES, schemaHas } from "../src/lib/honcho/capabilities.ts";
import { citedMessageIds, getCitingConclusions, noCitationReason } from "../src/lib/honcho/citations.ts";
import { listAllScopes, scopeBatches, SCOPE_BATCH_LIMIT } from "../src/lib/honcho/scopeListing.ts";
import { listAllSessions } from "../src/lib/honcho/sessionListing.ts";
import { toApiConclusion, toApiSession } from "../src/lib/honcho/adapters.ts";
import {
  buildWorkspaceConfiguration,
  seedWorkspaceConfigForm,
  workspaceConfigBody,
} from "../src/lib/honcho/workspaceConfig.ts";
import { expectedHeadIndex, queueIndexProbe, revisionProbe } from "../src/lib/operator/schemaHealth.ts";
import { failedCount, FAILED_TASKS_HREF } from "../src/lib/syncStatus.ts";

// --- OpenAPI evidence -------------------------------------------------------
// Shapes from plastic-labs/honcho docs/v3/openapi.json at v3.4.1 and v3.5.0.
const openapi341 = {
  info: { version: "3.4.1" },
  components: { schemas: {
    Conclusion: { properties: { id: {}, source_ids: {} } },
    Scope: { properties: { id: {}, created_at: {} } },
    Session: { properties: { id: {} } },
    WorkspaceUpdate: { properties: { configuration: { anyOf: [{}, { type: "null" }] } } },
  } },
};
const openapi350 = {
  info: { version: "3.5.0" },
  components: { schemas: {
    Conclusion: { properties: { id: {}, source_ids: {}, source_message_ids: {} } },
    Scope: { properties: { id: {}, session_count: {} } },
    Session: { properties: { id: {}, scopes: {} } },
    WorkspaceSessionGet: { properties: { scope: {}, in_no_scope: {} } },
    ScopeSessionsRemove: { properties: { session_ids: {} } },
    WorkspaceUpdate: { properties: { configuration: { description: "Replaces the entire workspace configuration. Send {} to clear explicit settings and use system defaults. Omit or send null to leave unchanged." } } },
  } },
};
// A server built from main between the tags: reports 3.4.1, carries citations
// (#935) and config replace (#1458), but not the scope list changes.
const mainBuild = {
  info: { version: "3.4.1" },
  components: { schemas: {
    ...openapi341.components.schemas,
    Conclusion: openapi350.components.schemas.Conclusion,
    WorkspaceUpdate: openapi350.components.schemas.WorkspaceUpdate,
  } },
};
const features = Object.keys(HONCHO_35_FEATURES);

test("3.5 features come from the schema first and fail closed without evidence", () => {
  for (const feature of features) {
    assert.equal(honcho35Capability(openapi350, "3.5.0", feature), "available", feature);
    assert.equal(honcho35Capability(openapi341, "3.4.1", feature), "unsupported", feature);
    // No document or an unparseable version: nothing to go on.
    assert.equal(honcho35Capability(undefined, undefined, feature), "unknown", feature);
    assert.equal(honcho35Capability({}, "development", feature), "unknown", feature);
    // A released 3.5+ version is enough even if the schema is trimmed.
    assert.equal(honcho35Capability({}, "3.5.1", feature), "available", feature);
    assert.equal(honcho35Capability({}, "3.5.0-rc.1", feature), "unsupported", feature);
  }
  const fromMain = Object.fromEntries(features.map((f) => [f, honcho35Capability(mainBuild, "3.4.1", f)]));
  assert.deepEqual(fromMain, {
    messageCitations: "available",
    sessionScopes: "unsupported",
    scopeSessionCounts: "unsupported",
    scopeBulkRemove: "unsupported",
    workspaceConfigReplace: "available",
  });
});

test("schemaHas checks model, property and description, and tolerates junk", () => {
  assert.equal(schemaHas(openapi350, { model: "ScopeSessionsRemove" }), true);
  assert.equal(schemaHas(openapi350, { model: "Scope", property: "session_count" }), true);
  assert.equal(schemaHas(openapi350, { model: "Scope", property: "nope" }), false);
  assert.equal(schemaHas(openapi350, { model: "WorkspaceUpdate", property: "configuration", description: /replaces/i }), true);
  assert.equal(schemaHas(openapi341, { model: "WorkspaceUpdate", property: "configuration", description: /replaces/i }), false);
  for (const junk of [null, "x", [], { components: [] }, { components: { schemas: { Scope: "x" } } }]) {
    assert.equal(schemaHas(junk, { model: "Scope", property: "session_count" }), false);
  }
});

// --- Workspace configuration: 3.5 replaces, earlier releases merge -----------
// v3.5.0 src/crud/workspace.py::update_workspace stores
// configuration.model_dump(exclude_none=True); v3.4.1 merged top-level keys.
function dropNone(value) {
  if (Array.isArray(value) || value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null).map(([k, v]) => [k, dropNone(v)]));
}
const serverReplace = (_stored, sent) => dropNone(sent);
const serverMerge = (stored, sent) => ({ ...stored, ...dropNone(sent) });

const stored = {
  custom_instructions: "Write in plain English.",
  reasoning: { enabled: true, custom_instructions: "Only durable facts." },
  summary: { enabled: true, messages_per_short_summary: 20 },
  dream: { enabled: false },
  dialectic: { custom_instructions: "Answer briefly." },
  extra_flag: { keep: true },
};
const options35 = { customInstructions: true, replaces: true };
const options34 = { customInstructions: true, replaces: false };

test("an untouched save stores exactly the same configuration on 3.5 and before", () => {
  for (const [opts, server] of [[options35, serverReplace], [options34, serverMerge]]) {
    const built = buildWorkspaceConfiguration(stored, seedWorkspaceConfigForm(stored), opts);
    assert.deepEqual(server(stored, workspaceConfigBody(stored, built, opts)), stored);
  }
});

test("clearing settings removes them on 3.5 without leaving empty placeholders", () => {
  const form = { ...seedWorkspaceConfigForm(stored), dream: null, sharedInstructions: null };
  const expected = { ...stored };
  delete expected.dream;
  delete expected.custom_instructions;

  const built35 = buildWorkspaceConfiguration(stored, form, options35);
  const body35 = workspaceConfigBody(stored, built35, options35);
  assert.deepEqual(body35, expected, "3.5 gets exactly the configuration to store");
  assert.deepEqual(serverReplace(stored, body35), expected);

  // Before 3.5 the same intent needs placeholders, or the merge keeps the old values.
  const built34 = buildWorkspaceConfiguration(stored, form, options34);
  const body34 = workspaceConfigBody(stored, built34, options34);
  assert.deepEqual(body34.dream, {});
  assert.equal(body34.custom_instructions, "");
  const merged = serverMerge(stored, body34);
  assert.deepEqual(merged.dream, {}, "an empty section means defaults");
  assert.equal(merged.custom_instructions, "", "at the workspace level, empty means no shared instructions");

  // The merge-style body is still safe on a 3.5 server (unknown versions get it).
  const onReplace = serverReplace(stored, body34);
  assert.deepEqual({ ...onReplace, dream: undefined, custom_instructions: undefined }, { ...expected, dream: undefined, custom_instructions: undefined });
});

test("raw JSON that drops a key removes it on 3.5 and clears it before", () => {
  const edited = { ...stored };
  delete edited.extra_flag;
  assert.deepEqual(serverReplace(stored, workspaceConfigBody(stored, edited, { replaces: true })), edited);
  assert.deepEqual(serverMerge(stored, workspaceConfigBody(stored, edited, { replaces: false })).extra_flag, {});
  // `{}` clears every explicit setting on 3.5.
  assert.deepEqual(serverReplace(stored, workspaceConfigBody(stored, {}, { replaces: true })), {});
});

test("a configuration the form does not know survives a 3.5 save", () => {
  const future = { ...stored, summary: { ...stored.summary, custom_instructions: "Short.", new_knob: 3 } };
  const opts = { customInstructions: false, replaces: true };
  const form = { ...seedWorkspaceConfigForm(future), summary: false };
  const saved = serverReplace(future, workspaceConfigBody(future, buildWorkspaceConfiguration(future, form, opts), opts));
  assert.deepEqual(saved.summary, { enabled: false, messages_per_short_summary: 20, custom_instructions: "Short.", new_knob: 3 });
  assert.deepEqual(saved.extra_flag, { keep: true });
});

// --- Citations -------------------------------------------------------------
test("cited message ids keep citation order, drop junk and repeats", () => {
  assert.deepEqual(citedMessageIds({ source_message_ids: ["m2", "m1", "m2", "", 7, null] }), ["m2", "m1"]);
  assert.deepEqual(citedMessageIds({ source_message_ids: null }), []);
  assert.deepEqual(citedMessageIds({}), []);
  assert.match(noCitationReason({ level: "explicit" }), /3\.5 or later/);
  assert.match(noCitationReason({ level: undefined }), /3\.5 or later/);
  assert.match(noCitationReason({ level: "deductive" }), /parent conclusions/);
});

test("the SDK 2.8 adapter keeps citations and session scopes", () => {
  const conclusion = { id: "c1", content: "x", observerId: "a", observedId: "b", sessionId: "s1", createdAt: "t", level: "explicit", sourceIds: null, timesDerived: 1, sourceMessageIds: ["m1"] };
  assert.deepEqual(toApiConclusion(conclusion).source_message_ids, ["m1"]);
  for (const none of [undefined, null]) {
    assert.equal("source_message_ids" in toApiConclusion({ ...conclusion, sourceMessageIds: none }), false, "older servers and uncited conclusions look the same");
  }
  const session = { id: "s", workspaceId: "w", metadata: {}, configuration: {}, isActive: true, createdAt: "t", uid: undefined };
  assert.deepEqual(toApiSession({ ...session, scopes: ["billing"] }).scopes, ["billing"]);
  assert.deepEqual(toApiSession({ ...session, scopes: [] }).scopes, [], "in no scope is an empty list, not absent");
  assert.equal("scopes" in toApiSession(session), false, "not listed with include_scopes");
});

test("the reverse lookup filters on source_message_ids, pages, and refuses without the capability", async () => {
  const calls = [];
  const sdk = { conclusions: { list: async (params) => { calls.push(params); return { items: [], pages: 3, total: 51 }; } } };
  const result = await getCitingConclusions(sdk, "m9", 2, "available");
  assert.deepEqual(calls, [{ page: 2, size: 25, filters: { source_message_ids: { contains: "m9" } } }]);
  assert.deepEqual(result, { items: [], pages: 3, total: 51 });
  for (const state of ["unsupported", "unknown", "checking"]) {
    await assert.rejects(getCitingConclusions(sdk, "m9", 1, state), /3\.5\+/);
  }
  assert.equal(calls.length, 1);
});

// --- Scopes and sessions ---------------------------------------------------
test("list helpers only ask for 3.5 extras when told to", async () => {
  const seen = [];
  const page = { toArray: async () => [] };
  const client = {
    scopes: async (params) => { seen.push(["scopes", params]); return page; },
    sessions: async (params) => { seen.push(["sessions", params]); return page; },
  };
  await listAllScopes(client);
  await listAllScopes(client, { includeSessionCount: true });
  await listAllSessions(client);
  await listAllSessions(client, { includeScopes: true });
  assert.deepEqual(seen, [
    ["scopes", { size: 100, reverse: true }],
    ["scopes", { size: 100, reverse: true, includeSessionCount: true }],
    ["sessions", { size: 100, reverse: true }],
    ["sessions", { size: 100, reverse: true, includeScopes: true }],
  ]);
});

test("bulk scope removal splits into batches of 100 without repeats", () => {
  const ids = Array.from({ length: 250 }, (_, i) => `s${i}`);
  const batches = scopeBatches([...ids, "s0", "s1"]);
  assert.deepEqual(batches.map((b) => b.length), [SCOPE_BATCH_LIMIT, SCOPE_BATCH_LIMIT, 50]);
  assert.deepEqual(batches.flat(), ids);
  assert.deepEqual(scopeBatches([]), []);
});

// --- Schema heads ----------------------------------------------------------
const facts = (overrides = {}) => ({
  revision: "c4d8e2f6a1b3",
  invalidIndexes: [],
  presentQueueIndexes: [
    "ix_queue_pending_observers", "ix_queue_pending_observed", "ix_queue_pending_observer",
    "ix_queue_pending_scope_peer", "ix_queue_pending_session_name",
  ],
  btreeGin: true,
  ...overrides,
});

test("Diagnostics knows the 3.5.0 schema head and a main build between releases", () => {
  assert.equal(expectedHeadIndex("3.5.0"), 5);
  assert.equal(expectedHeadIndex("3.4.1"), 4);
  assert.match(revisionProbe(facts(), "3.5.0").message, /matches server 3\.5\.0/);
  const pending = revisionProbe(facts({ revision: "a5f8da8f6d23" }), "3.5.0");
  assert.equal(pending.status, "warn");
  assert.match(pending.message, /expects c4d8e2f6a1b3/);
  // A main build that reports 3.4.1 on the 3.5.0 schema is a supported combination.
  const ahead = revisionProbe(facts(), "3.4.1");
  assert.equal(ahead.status, "ok");
  assert.match(ahead.message, /3\.5\.0 schema, ahead of server 3\.4\.1; compatible back to 3\.2\.2/);
  const between = revisionProbe(facts({ revision: "d8c4f6a2b901" }), "3.4.1");
  assert.equal(between.status, "ok");
  assert.match(between.message, /between the Honcho 3\.4\.1 and 3\.5\.0 schemas/);
  // The 3.4 queue indexes still get checked on both.
  assert.equal(queueIndexProbe(facts())?.status, "ok");
  assert.equal(queueIndexProbe(facts({ revision: "d8c4f6a2b901", presentQueueIndexes: [] }))?.status, "warn");
});

// --- Failed queue items beside the queue -------------------------------------
test("the failed count shows only real failures for the selected workspace", () => {
  const ok = (failed, workspace_id = "ws") => ({ available: true, workspace_id, failed, latest_failed_at: null });
  assert.equal(failedCount(ok(3), "ws"), 3);
  assert.equal(failedCount(ok(0), "ws"), null, "no failures, nothing to show");
  assert.equal(failedCount(ok(3, "other"), "ws"), null, "a response for the previous workspace is ignored");
  assert.equal(failedCount({ available: false, reason: "HONCHO_DATABASE_URL not set" }, "ws"), null, "no database, no claim");
  assert.equal(failedCount(undefined, "ws"), null);
  assert.equal(failedCount(ok(3), null), null);
  assert.equal(failedCount(ok(Number.NaN), "ws"), null);
  assert.equal(FAILED_TASKS_HREF, "#/reasoning?status=failed");
});
