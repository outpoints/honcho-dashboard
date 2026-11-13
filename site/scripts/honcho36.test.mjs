import assert from "node:assert/strict";
import test from "node:test";
import { HONCHO_36_FEATURES, honcho36Capability } from "../src/lib/honcho/capabilities.ts";
import {
  DREAM_PAGE_SIZE,
  STUCK_CEILING_MS,
  STUCK_FLOOR_MS,
  cardLineKey,
  changeCounts,
  dreamRefreshMs,
  dreamRunHash,
  dreamsHash,
  formatDuration,
  formatElapsed,
  getDreamRun,
  groupRunsByStart,
  listDreamRuns,
  missingCreated,
  normalizeRunDetail,
  peerCardChanges,
  peerCardDiff,
  readDreamsHash,
  readLinkedRun,
  replacementFor,
  runChanges,
  runDurationMs,
  runFlags,
  runLooksStuck,
  stuckAfterMs,
  summarizeRuns,
  triggerLabel,
  unusualSpecialist,
} from "../src/lib/honcho/dreams.ts";
import { formatListTotal, formatPageCount, totalIsLowerBound, totalsMayBeCapped } from "../src/lib/honcho/listTotals.ts";
import { getSdk, invalidateSdk } from "../src/lib/honcho/sdk.ts";
import {
  expectedHeadIndex,
  messageSearchIndexProbe,
  queueBatchProbe,
  queueIndexProbe,
  revisionProbe,
  schemaProbes,
  tenancyProbe,
} from "../src/lib/operator/schemaHealth.ts";

// --- OpenAPI evidence -------------------------------------------------------
// Shapes from plastic-labs/honcho docs/v3/openapi.json at v3.5.0 and v3.6.1
// (3.6.1 changes no API; its schema equals 3.6.0's).
const TOTAL_361 = "Number of matching rows, exact up to the server's PAGINATION_COUNT_LIMIT (default 100000) and reported as that limit plus one when there are more.";
const openapi350 = {
  info: { version: "3.5.0" },
  components: { schemas: {
    Conclusion: { properties: { id: {}, source_message_ids: {} } },
    Page_Conclusion_: { properties: { items: {}, total: { type: "integer", title: "Total" } } },
  } },
};
const openapi361 = {
  info: { version: "3.6.1" },
  components: { schemas: {
    ...openapi350.components.schemas,
    Page_Conclusion_: { properties: { items: {}, total: { type: "integer", description: TOTAL_361 } } },
    DreamRun: { properties: { id: {}, status: {} } },
    DreamRunDetail: { properties: { id: {}, created: {}, removed: {}, peer_card: {} } },
  } },
};
// A main-branch build after 3.5.0 that has Representation History but still
// counts list totals exactly.
const mainBuild = {
  info: { version: "3.5.0" },
  components: { schemas: { ...openapi350.components.schemas, DreamRunDetail: openapi361.components.schemas.DreamRunDetail } },
};

test("3.6 features come from the schema first and fail closed without evidence", () => {
  for (const feature of Object.keys(HONCHO_36_FEATURES)) {
    assert.equal(honcho36Capability(openapi361, "3.6.1", feature), "available", feature);
    assert.equal(honcho36Capability(openapi350, "3.5.0", feature), "unsupported", feature);
    assert.equal(honcho36Capability(undefined, undefined, feature), "unknown", feature);
    assert.equal(honcho36Capability({}, "3.6.0", feature), "available", feature);
    assert.equal(honcho36Capability({}, "3.6.0-rc.1", feature), "unsupported", feature);
  }
  assert.equal(honcho36Capability(mainBuild, "3.5.0", "dreamHistory"), "available");
  assert.equal(honcho36Capability(mainBuild, "3.5.0", "cappedListTotals"), "unsupported");
});

// --- Capped list totals (#1500) --------------------------------------------
test("list totals past the default count limit read as a lower bound unless the server predates the cap", () => {
  assert.equal(totalsMayBeCapped("available"), true);
  assert.equal(totalsMayBeCapped("unknown"), true);
  assert.equal(totalsMayBeCapped("checking"), true);
  assert.equal(totalsMayBeCapped("unsupported"), false);
  assert.equal(formatListTotal(100_001, true), "100,000+");
  // Past the limit, later pages report a total just past the page, still a lower bound.
  assert.equal(formatListTotal(150_051, true), "100,000+");
  assert.equal(formatListTotal(100_000, true), "100,000");
  assert.equal(formatListTotal(42, true), "42");
  assert.equal(formatListTotal(100_001, false), "100,001");
  assert.equal(totalIsLowerBound(100_001, true), true);
  assert.equal(totalIsLowerBound(100_001, false), false);
});

test("page counts from a capped total read as a lower bound until the last page", () => {
  // 166,765 rows at 25 a page: page 1 reports total 100,001, so pages 4,001.
  assert.equal(formatPageCount(1, 4001, 100_001, true), "4,001+");
  // Walking past the cap, the server keeps pages one past the current page.
  assert.equal(formatPageCount(4500, 4501, 112_501, true), "4,501+");
  // On the last page the total covers every row walked, so the count is exact.
  assert.equal(formatPageCount(6671, 6671, 166_765, true), "6,671");
  assert.equal(formatPageCount(1, 12, 300, true), "12");
  assert.equal(formatPageCount(1, 4001, 100_001, false), "4,001");
});

// --- Representation History ------------------------------------------------
const run = (overrides = {}) => ({
  id: "run-1",
  observer_id: "alice",
  observed_id: "alice",
  dream_type: "omni",
  trigger_reason: "document_threshold",
  status: "completed",
  created_count: 2,
  removed_count: 1,
  peer_card_updated: true,
  started_at: "2026-11-10T12:00:00Z",
  finished_at: "2026-11-10T12:00:42.500Z",
  pruned_at: null,
  created: [
    {
      conclusion: { id: "c-new", content: "Alice prefers async standups", level: "inductive", status: "current", removed_in_run: null },
      sources: [{ id: "c-old", content: null, level: "explicit", status: "unavailable", removed_in_run: null }],
      specialist: "induction",
    },
  ],
  removed: [
    { id: "c-dup", content: "Alice likes async standups", level: "inductive", replaced_by: "c-new", specialist: "induction" },
    { id: "c-gone", content: "Alice works nights", level: "deductive", replaced_by: "c-elsewhere", specialist: "deduction" },
  ],
  peer_card: { before: ["ATTRIBUTE: Role: Engineer", "ATTRIBUTE: Team: Infra"], after: ["ATTRIBUTE: Role: Engineer", "ATTRIBUTE: Team: Platform"] },
  ...overrides,
});

test("dreams hash reads the Peers link alias and round-trips filters", () => {
  assert.deepEqual(readDreamsHash("#/dreams?peer=alice"), { observed: "alice", observer: null });
  assert.deepEqual(readDreamsHash("#/dreams?observed=bob&peer=alice&observer=carol"), { observed: "bob", observer: "carol" });
  assert.deepEqual(readDreamsHash("#/dreams?observed=%20%20"), { observed: null, observer: null });
  assert.deepEqual(readDreamsHash("#/dreams"), { observed: null, observer: null });
  assert.equal(dreamsHash({ observed: null, observer: null }), "#/dreams");
  const hash = dreamsHash({ observed: "a b/c", observer: "d&e" });
  assert.deepEqual(readDreamsHash(hash), { observed: "a b/c", observer: "d&e" });
});

test("dream list sends only the filters set, pages at the page size, and refuses without the capability", async () => {
  const calls = [];
  const sdk = {
    dreams: async (options) => {
      calls.push(options);
      return { items: [run()], total: 1, page: options.page, pages: 1 };
    },
    getDream: async (id) => {
      calls.push(id);
      return { ...run({ id }), created: undefined, removed: null, peer_card: undefined };
    },
  };
  const page = await listDreamRuns(sdk, { observed: "alice", observer: null }, 2, "available");
  assert.deepEqual(calls[0], { observed: "alice", page: 2, size: DREAM_PAGE_SIZE });
  assert.equal(page.page, 2);
  await listDreamRuns(sdk, { observed: null, observer: null }, 1, "available");
  assert.deepEqual(calls[1], { page: 1, size: DREAM_PAGE_SIZE });
  const detail = await getDreamRun(sdk, "run-9", "available");
  assert.deepEqual([detail.created, detail.removed, detail.peer_card], [[], [], null], "a malformed reply degrades to empty sections");
  for (const state of ["unsupported", "unknown", "restricted", "checking"]) {
    await assert.rejects(listDreamRuns(sdk, { observed: null, observer: null }, 1, state), /3\.6/);
    await assert.rejects(getDreamRun(sdk, "run-1", state), /3\.6/);
  }
  assert.equal(calls.length, 3, "no request without the capability");
});

test("SDK 2.9 reads dream runs through the proxy with the documented request shapes", async (t) => {
  invalidateSdk();
  t.after(invalidateSdk);
  const opts = { baseUrl: "http://honcho.test:8000", token: "synthetic-test-token" };
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const parsed = new URL(String(url), "http://localhost");
    calls.push({ method: init.method ?? "GET", path: parsed.pathname, query: parsed.search, body: init.body ? JSON.parse(init.body) : undefined, headers: new Headers(init.headers) });
    const reply = (value) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
    if (parsed.pathname === "/v3/workspaces") return reply({ id: "ws", metadata: {}, configuration: {}, created_at: "2026-11-01T00:00:00Z" });
    if (parsed.pathname === "/v3/workspaces/ws/dreams/list") return reply({ items: [run()], total: 1, page: 1, size: 20, pages: 1 });
    if (parsed.pathname === "/v3/workspaces/ws/dreams/run-1") return reply(run());
    throw new Error(`Unexpected request: ${parsed.pathname}`);
  });
  const sdk = getSdk(opts, "ws");
  const page = await listDreamRuns(sdk, { observed: "alice", observer: "bob" }, 1, "available");
  assert.equal(page.items[0].id, "run-1");
  const detail = await getDreamRun(sdk, "run-1", "available");
  assert.equal(detail.created[0].conclusion.id, "c-new");
  const list = calls.find((call) => call.path.endsWith("/dreams/list"));
  assert.equal(list.method, "POST");
  assert.deepEqual(list.body, { observed_id: "alice", observer_id: "bob" });
  assert.match(list.query, /page=1/);
  assert.match(list.query, /size=20/);
  assert.equal(calls.find((call) => call.path.endsWith("/dreams/run-1")).method, "GET");
  // The SDK's workspace get-or-create runs against the workspace already selected.
  assert.deepEqual(calls.filter((call) => call.path === "/v3/workspaces").map((call) => call.body?.id), ["ws"]);
  assert.ok(calls.every(({ headers }) => headers.get("X-Honcho-Base-Url") === opts.baseUrl));
  assert.ok(calls.every(({ headers }) => headers.get("X-Honcho-Host")?.startsWith("honcho-typescript/2.9.0")));
});

test("peer card diff counts repeated lines and knows when there was no card", () => {
  const diff = peerCardDiff(run().peer_card);
  assert.deepEqual(diff, {
    added: ["ATTRIBUTE: Team: Platform"],
    removed: ["ATTRIBUTE: Team: Infra"],
    kept: ["ATTRIBUTE: Role: Engineer"],
    hadCard: true,
  });
  const repeated = peerCardDiff({ before: ["A", "A", "B"], after: ["A", "B", "B"] });
  assert.deepEqual([repeated.added, repeated.removed, repeated.kept], [["B"], ["A"], ["A", "B"]]);
  const first = peerCardDiff({ before: null, after: ["IDENTITY: Name: Alice"] });
  assert.deepEqual([first.added, first.removed, first.hadCard], [["IDENTITY: Name: Alice"], [], false]);
});

test("run helpers: replacement, missing created conclusions, duration", () => {
  const detail = run();
  assert.equal(replacementFor(detail, detail.removed[0])?.conclusion.id, "c-new");
  assert.equal(replacementFor(detail, detail.removed[1]), null, "a replacement outside this run is not invented");
  assert.equal(replacementFor(detail, { ...detail.removed[0], replaced_by: null }), null);
  assert.equal(missingCreated(detail), 1, "retention or deletion dropped one of the two created");
  assert.equal(missingCreated(run({ created_count: 0, created: [] })), 0);
  assert.equal(runDurationMs(detail), 42_500);
  assert.equal(runDurationMs(run({ finished_at: null })), null);
  assert.equal(runDurationMs(run({ finished_at: "2026-11-10T11:00:00Z" })), null, "clock skew is not a negative duration");
  assert.deepEqual([formatDuration(850), formatDuration(4_210), formatDuration(42_500), formatDuration(125_000), formatDuration(120_000)],
    ["850 ms", "4.2 s", "43 s", "2 min 5 s", "2 min"]);
  const normalized = normalizeRunDetail({ ...detail, created: [{ ...detail.created[0], sources: undefined }] });
  assert.deepEqual(normalized.created[0].sources, []);
});

test("a run reads as a diff: rewrites pair with their replacement, the rest is added or forgotten", () => {
  const detail = run();
  const changes = runChanges(detail);
  assert.deepEqual(changes.map((c) => c.kind), ["rewritten", "rewritten"], "both removals were replaced");
  assert.equal(changes[0].replacement?.conclusion.id, "c-new", "the replacement from this run is shown once, under ~");
  assert.equal(changes[1].replacement, null, "a replacement written elsewhere is named by id, not invented");
  assert.equal(changes.filter((c) => c.kind === "added").length, 0, "c-new is not listed again as added");
  // Two near-duplicates folded into one replacement are one entry.
  const merged = runChanges({
    created: detail.created,
    removed: [
      { id: "d1", content: "A", level: "inductive", replaced_by: "c-new", specialist: "induction" },
      { id: "d2", content: "B", level: "inductive", replaced_by: "c-new", specialist: "induction" },
      { id: "gone", content: "C", level: "explicit", replaced_by: null, specialist: "deduction" },
    ],
  });
  assert.deepEqual(merged.map((c) => c.kind), ["forgotten", "rewritten"], "a loss is listed before a rewrite");
  assert.deepEqual(merged[1].removed.map((r) => r.id), ["d1", "d2"]);
  const plain = runChanges({ created: detail.created, removed: [] });
  assert.deepEqual(plain.map((c) => c.kind), ["added"]);
});

test("change counts split removals into rewritten and forgotten, and give up on a pruned run", () => {
  const detail = run({ removed_count: 2 });
  assert.deepEqual(changeCounts(detail), { added: 1, rewritten: 2, forgotten: 0 }, "2 created, one of them the in-run replacement");
  const forgot = run({ removed_count: 1, removed: [{ id: "x", content: "X", level: "explicit", replaced_by: null, specialist: "deduction" }] });
  assert.deepEqual(changeCounts(forgot), { added: 2, rewritten: 0, forgotten: 1 });
  assert.equal(changeCounts(run({ pruned_at: "2026-11-11T00:00:00Z" })), null);
  assert.equal(changeCounts(run({ removed_count: 5 })), null, "a removed list shorter than its count cannot be split");
});

test("peer card changes pair a dropped and an added line that share a key", () => {
  assert.equal(cardLineKey("ATTRIBUTE: Billing day: 15th"), "ATTRIBUTE: Billing day");
  assert.equal(cardLineKey("IDENTITY: Name: Ana"), "IDENTITY: Name");
  assert.equal(cardLineKey("INSTRUCTION: Avoid UIKit."), null, "one colon is not a key");
  assert.equal(cardLineKey("ATTRIBUTE: Empty:"), null, "a key needs a value");
  const card = peerCardChanges(run().peer_card);
  assert.deepEqual(card.changed, [{ before: "ATTRIBUTE: Team: Infra", after: "ATTRIBUTE: Team: Platform" }]);
  assert.deepEqual([card.added, card.removed, card.kept], [[], [], ["ATTRIBUTE: Role: Engineer"]]);
  // A key repeated on one side is ambiguous, so nothing is paired.
  const repeated = peerCardChanges({ before: ["ATTRIBUTE: Pet: Cat", "ATTRIBUTE: Pet: Dog"], after: ["ATTRIBUTE: Pet: Fish"] });
  assert.deepEqual([repeated.changed, repeated.added, repeated.removed], [[], ["ATTRIBUTE: Pet: Fish"], ["ATTRIBUTE: Pet: Cat", "ATTRIBUTE: Pet: Dog"]]);
  const first = peerCardChanges({ before: null, after: ["IDENTITY: Name: Ana"] });
  assert.deepEqual([first.changed, first.added, first.hadCard], [[], ["IDENTITY: Name: Ana"], false]);
});

test("runs group by start time, newest first, without claiming a cycle id", () => {
  const at = (id, started_at) => run({ id, started_at });
  const groups = groupRunsByStart([
    at("a", "2026-11-12T20:23:15.826Z"),
    at("b", "2026-11-12T20:23:15.826Z"),
    at("c", "2026-11-12T20:22:30Z"),
    at("d", "2026-11-12T19:00:00Z"),
    at("e", "not a date"),
    at("f", "2026-11-12T18:59:00Z"),
  ]);
  assert.deepEqual(groups.map((g) => g.runs.map((r) => r.id)), [["a", "b", "c"], ["d"], ["e"], ["f"]]);
  assert.equal(groups[0].startedAt, "2026-11-12T20:22:30Z", "a group starts at its earliest run");
  assert.deepEqual(groupRunsByStart([]), []);
  assert.deepEqual([triggerLabel("document_threshold"), triggerLabel("manual"), triggerLabel("new_reason"), triggerLabel(null)],
    ["auto", "scheduled", "new reason", null]);
});

test("a run left running long past the others reads as stuck and slows polling", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  const done = run({ started_at: "2026-11-12T10:00:00Z", finished_at: "2026-11-12T10:20:00Z" });
  const fresh = run({ id: "live", status: "running", finished_at: null, started_at: "2026-11-12T11:50:00Z" });
  const old = run({ id: "old", status: "running", finished_at: null, started_at: "2026-11-11T14:00:00Z" });
  assert.equal(stuckAfterMs([done]), 60 * 60_000, "three times the longest finished run");
  assert.equal(stuckAfterMs([]), STUCK_FLOOR_MS, "never under the floor");
  const skewed = run({ started_at: "2026-10-01T00:00:00Z", finished_at: "2026-11-10T00:00:00Z" });
  assert.equal(stuckAfterMs([skewed]), STUCK_CEILING_MS, "one bad finish time cannot hide a stuck run");
  const after = stuckAfterMs([done, fresh, old]);
  assert.equal(runLooksStuck(fresh, now, after), false);
  assert.equal(runLooksStuck(old, now, after), true);
  assert.equal(runLooksStuck(done, now, after), false, "a finished run is never stuck");
  assert.equal(dreamRefreshMs([done, fresh, old], now, after), 5_000, "a live run keeps fast polling");
  assert.equal(dreamRefreshMs([done, old], now, after), 60_000, "only a stuck run polls slowly");
  assert.equal(dreamRefreshMs([done], now, after), 30_000);
  assert.deepEqual([formatElapsed(800), formatElapsed(45_000), formatElapsed(6 * 60_000), formatElapsed(22 * 3_600_000), formatElapsed(3 * 86_400_000)],
    ["1 s", "45 s", "6 min", "22 h", "3 d"]);
});

test("a run link opens one run and filters drop it", () => {
  assert.equal(dreamRunHash("Eb C4/x"), "#/dreams?run=Eb+C4%2Fx");
  assert.equal(readLinkedRun(dreamRunHash("Eb C4/x")), "Eb C4/x");
  assert.equal(readLinkedRun("#/dreams?peer=alice"), null);
  assert.deepEqual(readDreamsHash("#/dreams?run=abc&peer=alice"), { observed: "alice", observer: null });
  assert.equal(dreamsHash({ observed: "alice", observer: null }), "#/dreams?observed=alice", "setting a filter closes a linked run");
});

// --- Schema heads ----------------------------------------------------------
const QUEUE = [
  "ix_queue_pending_observers", "ix_queue_pending_observed", "ix_queue_pending_observer",
  "ix_queue_pending_scope_peer", "ix_queue_pending_session_name",
];
const facts = (overrides = {}) => ({
  revision: "4f9c2a7e8d31",
  invalidIndexes: [],
  presentQueueIndexes: QUEUE,
  btreeGin: true,
  pgTrgm: true,
  presentMessageSearchIndexes: ["ix_messages_tenant_content_fts", "ix_messages_tenant_content_trgm"],
  tenantIdColumn: true,
  queueBatchTable: true,
  queueBatchTriggers: ["trg_queue_item_batches_insert", "trg_queue_item_batches_update", "trg_queue_item_batches_delete"],
  tenantCount: 1,
  rowSecurityHidesRows: false,
  ...overrides,
});

test("Diagnostics knows the 3.6 schema head, 3.6.1 included", () => {
  assert.equal(expectedHeadIndex("3.6.0"), 6);
  assert.equal(expectedHeadIndex("3.6.1"), 6);
  assert.equal(expectedHeadIndex("3.6.4"), 6);
  assert.equal(expectedHeadIndex("3.7.0"), null);
  assert.match(revisionProbe(facts(), "3.6.1").message, /matches server 3\.6\.1/);
  const pending = revisionProbe(facts({ revision: "c4d8e2f6a1b3", tenantIdColumn: false }), "3.6.1");
  assert.equal(pending.status, "warn");
  assert.match(pending.message, /3\.5\.0 schema; server 3\.6\.1 expects 4f9c2a7e8d31/);
  // Rolling back to an image from 3.2.2 on is supported by compat.toml.
  const rolledBack = revisionProbe(facts(), "3.5.0");
  assert.equal(rolledBack.status, "ok");
  assert.match(rolledBack.message, /3\.6\.0–3\.6\.1 schema, ahead of server 3\.5\.0; compatible back to 3\.2\.2/);
  assert.equal(revisionProbe(facts(), "3.2.1").status, "warn");
});

test("a stopped 3.6 upgrade is told apart from a main-branch build", () => {
  // 3.6.1 commits the tenant migration step by step: tenant_id with the 3.5.0 head means it stopped.
  const partial = revisionProbe(facts({ revision: "c4d8e2f6a1b3", tenantIdColumn: true }), "3.6.1");
  assert.equal(partial.status, "warn");
  assert.match(partial.message, /e5fe7f8bcf62\) stopped part-way/);
  // A revision inside 3.6.0's chain: a main build reporting 3.5.0, or an upgrade that stopped.
  const main = revisionProbe(facts({ revision: "b7d2f4a81c39" }), "3.5.0");
  assert.equal(main.status, "ok");
  assert.match(main.message, /between the Honcho 3\.5\.0 and 3\.6\.0 schemas \(a build from Honcho's main branch\)/);
  const stopped = revisionProbe(facts({ revision: "b7d2f4a81c39" }), "3.6.1");
  assert.equal(stopped.status, "warn");
  assert.match(stopped.message, /expects 4f9c2a7e8d31\. The upgrade stopped part-way/);
  // The same rule now covers the 3.5 chain.
  assert.equal(revisionProbe(facts({ revision: "d8c4f6a2b901" }), "3.4.1").status, "ok");
  assert.equal(revisionProbe(facts({ revision: "d8c4f6a2b901" }), "3.5.0").status, "warn");
  // The 3.4 queue indexes are checked on the 3.6 head and inside its chain.
  assert.equal(queueIndexProbe(facts())?.status, "ok");
  assert.equal(queueIndexProbe(facts({ revision: "a7e3c1d9f2b4", presentQueueIndexes: [] }))?.status, "warn");
});

test("a main build past 3.6.1 keeps every 3.6 check", () => {
  // 0e32bf9d5a22 (webhook event types) is on main after v3.6.1; the server still reports 3.6.1.
  const past = revisionProbe(facts({ revision: "0e32bf9d5a22" }), "3.6.1");
  assert.equal(past.status, "ok");
  assert.equal(past.message, "0e32bf9d5a22 · past 3.6.1: a build from Honcho's main branch");
  assert.deepEqual(schemaProbes(facts({ revision: "0e32bf9d5a22" }), "3.6.1").map((probe) => probe.id), [
    "db.schema_revision", "db.invalid_indexes", "db.queue_pending_indexes", "db.queue_item_batches",
    "db.message_search_indexes", "db.tenancy",
  ]);
  assert.equal(queueBatchProbe(facts({ revision: "0e32bf9d5a22", queueBatchTriggers: [] }))?.status, "err");
  // A revision no map knows yet, on a server at or past the newest release, says why checks are missing.
  const unknown = revisionProbe(facts({ revision: "ffffffffffff" }), "3.6.1");
  assert.equal(unknown.status, "skip");
  assert.match(unknown.message, /probably a build from Honcho's main branch with a newer migration/);
  assert.equal(revisionProbe(facts({ revision: "ffffffffffff" }), "3.5.0").message, "ffffffffffff · not a release head this dashboard knows");
  assert.equal(queueBatchProbe(facts({ revision: "ffffffffffff" })), null);
});

test("3.6 probes: deriver claim table, message search indexes, tenants", () => {
  assert.equal(queueBatchProbe(facts())?.status, "ok");
  const noTrigger = queueBatchProbe(facts({ queueBatchTriggers: ["trg_queue_item_batches_insert"] }));
  assert.equal(noTrigger?.status, "err");
  assert.match(noTrigger.message, /trg_queue_item_batches_update, trg_queue_item_batches_delete.*refuses to start/);
  assert.match(queueBatchProbe(facts({ queueBatchTable: false, queueBatchTriggers: [] })).message, /^Missing queue_item_batches, /);
  assert.equal(queueBatchProbe(facts({ revision: "c4d8e2f6a1b3" })), null, "only on the 3.6 head");
  assert.equal(queueBatchProbe(facts({ queueBatchTable: undefined })), null, "an older collector skips it");

  assert.equal(messageSearchIndexProbe(facts())?.message, "2/2 tenant-scoped indexes present");
  const kept = messageSearchIndexProbe(facts({ btreeGin: false, presentMessageSearchIndexes: ["ix_messages_content_gin", "ix_messages_content_trgm"] }));
  assert.equal(kept?.status, "warn");
  assert.match(kept.message, /btree_gin is not installed, so Honcho kept ix_messages_content_gin, ix_messages_content_trgm and search works as before/);
  const noTrgm = messageSearchIndexProbe(facts({ pgTrgm: false, presentMessageSearchIndexes: ["ix_messages_tenant_content_fts"] }));
  assert.match(noTrgm.message, /pg_trgm is not installed/);
  assert.match(messageSearchIndexProbe(facts({ presentMessageSearchIndexes: [] })).message, /^0\/2 present · missing/);
  assert.equal(messageSearchIndexProbe(facts({ revision: "c4d8e2f6a1b3" })), null);

  assert.deepEqual(tenancyProbe(facts()), { id: "db.tenancy", category: "database", label: "tenants", status: "ok", message: "one tenant" });
  assert.match(tenancyProbe(facts({ tenantCount: 3 })).message, /3 tenants share this database/);
  assert.match(tenancyProbe(facts({ rowSecurityHidesRows: true })).message, /Row-level security/);
  assert.equal(tenancyProbe(facts({ tenantIdColumn: false })), null);

  assert.deepEqual(schemaProbes(facts(), "3.6.1").map((probe) => probe.id), [
    "db.schema_revision", "db.invalid_indexes", "db.queue_pending_indexes", "db.queue_item_batches",
    "db.message_search_indexes", "db.tenancy",
  ]);
  // A 3.5.0 database with the old collector shape shows the same probes as before.
  assert.deepEqual(
    schemaProbes({ revision: "c4d8e2f6a1b3", invalidIndexes: [], presentQueueIndexes: QUEUE, btreeGin: true }, "3.5.0").map((probe) => probe.id),
    ["db.schema_revision", "db.invalid_indexes", "db.queue_pending_indexes"],
  );
});

test("the dreams link keeps a triage view and drops one it does not know", () => {
  assert.deepEqual(readDreamsHash("#/dreams?show=failed&peer=alice"), { observed: "alice", observer: null, show: "failed" });
  assert.deepEqual(readDreamsHash("#/dreams?show=everything"), { observed: null, observer: null });
  assert.equal(dreamsHash({ observed: null, observer: null, show: "forgotten" }), "#/dreams?show=forgotten");
  assert.equal(dreamsHash({ observed: null, observer: null, show: null }), "#/dreams");
  assert.deepEqual(readDreamsHash(dreamsHash({ observed: "bob", observer: null, show: "card" })), { observed: "bob", observer: null, show: "card" });
});

test("triage flags and the page summary say what needs attention, and only what is known", () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  const after = 30 * 60_000;
  const seen = Date.parse("2026-11-11T06:00:00Z");
  const runs = [
    run({ id: "ok", started_at: "2026-11-11T08:00:00Z", removed_count: 0, peer_card_updated: false }),
    run({ id: "lost", started_at: "2026-11-10T08:00:00Z", removed_count: 1, peer_card_updated: true }),
    run({ id: "bad", status: "failed", started_at: "2026-11-10T08:00:00Z", removed_count: 0, peer_card_updated: false }),
    run({ id: "stuck", status: "running", finished_at: null, started_at: "2026-11-11T09:00:00Z", removed_count: 0, peer_card_updated: false }),
    run({ id: "live", status: "running", finished_at: null, started_at: "2026-11-11T11:55:00Z", removed_count: 2, peer_card_updated: false }),
    run({ id: "pruned", pruned_at: "2026-11-11T00:00:00Z", started_at: "2026-10-01T08:00:00Z", removed_count: 3, peer_card_updated: false }),
  ];
  const counts = { ok: { added: 2, rewritten: 0, forgotten: 0 }, lost: { added: 2, rewritten: 0, forgotten: 1 }, bad: { added: 2, rewritten: 0, forgotten: 0 }, stuck: { added: 2, rewritten: 0, forgotten: 0 } };
  const countsOf = (i) => counts[runs[i].id] ?? null;
  assert.deepEqual(runFlags(runs[1], counts.lost, now, after, seen), { failed: false, stuck: false, forgotten: true, card: true, new: false });
  assert.equal(runFlags(runs[0], counts.ok, now, after, seen).new, true, "started after the last visit");
  assert.equal(runFlags(runs[0], counts.ok, now, after, null).new, false, "a first visit marks nothing new");
  assert.equal(runFlags(runs[3], counts.stuck, now, after, seen).stuck, true);
  assert.equal(runFlags(run({ status: "interrupted" }), null, now, after, seen).failed, true, "an interrupted run needs a look too");
  assert.deepEqual(summarizeRuns(runs, countsOf, now, after, seen), {
    runs: 6, failed: 1, stuck: 1, running: 1, forgotten: 1, unsplit: 2, cards: 1, new: 3,
  }, "a live and a pruned run with removals are not split, so they add nothing to forgotten");
});

test("a specialist is named only when it is not the one a level normally comes from", () => {
  assert.equal(unusualSpecialist("deductive", "deduction"), null);
  assert.equal(unusualSpecialist("inductive", "induction"), null);
  assert.equal(unusualSpecialist("explicit", "deduction"), "deduction");
  assert.equal(unusualSpecialist("inductive", "deduction"), "deduction");
  assert.equal(unusualSpecialist(null, "induction"), "induction");
  assert.equal(unusualSpecialist("deductive", null), null);
});
