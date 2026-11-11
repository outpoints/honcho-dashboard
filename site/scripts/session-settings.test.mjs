import assert from "node:assert/strict";
import test from "node:test";
import {
  hasSessionOverrides,
  learnersAbout,
  learningOff,
  loadSessionSettings,
  planMemberChanges,
  planSessionChanges,
  resolveInstructions,
  resolveIntervals,
  resolveMember,
  resolveSwitches,
  saveSessionSettings,
  seedSessionSettingsForm,
  sessionConfigurationPatch,
  settingsRevision,
  validateSessionSettings,
} from "../src/lib/honcho/sessionSettings.ts";
import {
  conclusionsHash,
  deleteConclusions,
  findDerivedElsewhere,
  listAllConclusions,
  readConclusionsHash,
  withSessionFilter,
} from "../src/lib/honcho/sessionConclusions.ts";

const CI = { customInstructions: true };
const byKey = (rows) => Object.fromEntries(rows.map((row) => [row.key, row]));

// --- Resolution -------------------------------------------------------------

test("switches resolve session, then workspace, then the server's unreported default", () => {
  const rows = byKey(resolveSwitches(
    { reasoning: { enabled: false }, summary: {} },
    { summary: { enabled: false }, dream: { enabled: true } },
  ));
  assert.deepEqual([rows.reasoning.effective, rows.reasoning.source, rows.reasoning.choice], [false, "session", "off"]);
  assert.deepEqual([rows.summary.effective, rows.summary.source, rows.summary.choice], [false, "workspace", "inherit"]);
  assert.deepEqual([rows.dream.effective, rows.dream.source], [true, "workspace"]);
  assert.deepEqual([rows.peer_card_use.effective, rows.peer_card_use.source], [null, "server"]);
  // An unread workspace is unknown, not the server default.
  assert.equal(byKey(resolveSwitches({}, undefined)).summary.source, "unknown");
});

test("legacy deriver keys decide conclusions the way normalize_configuration_dict does", () => {
  const legacy = byKey(resolveSwitches({ deriver: { enabled: false } }, {}));
  assert.deepEqual([legacy.reasoning.effective, legacy.reasoning.legacy, legacy.reasoning.choice], [false, true, "inherit"]);
  assert.equal(byKey(resolveSwitches({ skip_deriver: true }, {})).reasoning.effective, false);
  // An explicit reasoning.enabled wins over both.
  assert.equal(byKey(resolveSwitches({ reasoning: { enabled: true }, skip_deriver: true }, {})).reasoning.effective, true);
  assert.equal(learningOff({ skip_deriver: true }, {}).source, "session");
  assert.equal(learningOff({}, { reasoning: { enabled: false } }).source, "workspace");
  assert.equal(learningOff({}, {}), null);
  assert.equal(hasSessionOverrides({}), false);
  assert.equal(hasSessionOverrides({ dream: { enabled: false } }), true);
});

test("SDK-shaped session configuration is read back in the API's shape", async () => {
  const { apiSessionConfiguration } = await import("../src/lib/honcho/adapters.ts");
  // What the SDK's sessionConfigFromApi() returns for {} and for a real config.
  const empty = { customInstructions: undefined, reasoning: undefined, peerCard: undefined, summary: undefined, dream: undefined, dialectic: undefined };
  assert.deepEqual(apiSessionConfiguration(empty), {});
  assert.equal(hasSessionOverrides(apiSessionConfiguration(empty)), false);
  const sdk = {
    customInstructions: "Be brief.",
    reasoning: { enabled: false, customInstructions: undefined },
    peerCard: { use: undefined, create: false, customInstructions: undefined },
    summary: { enabled: undefined, messagesPerShortSummary: 15, messagesPerLongSummary: undefined, customInstructions: undefined },
    dream: {},
  };
  const api = apiSessionConfiguration(sdk);
  assert.deepEqual(api, {
    custom_instructions: "Be brief.", reasoning: { enabled: false }, peer_card: { create: false }, summary: { messages_per_short_summary: 15 }, dream: {},
  });
  assert.equal(learningOff(api, {}).source, "session");
  assert.equal(byKey(resolveSwitches(api, {})).peer_card_create.effective, false);
  assert.equal(hasSessionOverrides({ dream: {} }), false);
});

test("summary intervals report where each comes from", () => {
  const { short, long } = resolveIntervals({ summary: { messages_per_short_summary: 15 } }, { summary: { messages_per_long_summary: 90 } });
  assert.deepEqual(short, { stored: 15, effective: 15, source: "session" });
  assert.deepEqual(long, { stored: null, effective: 90, source: "workspace" });
  assert.equal(resolveIntervals({}, {}).short.source, "server");
});

test("instructions resolve like resolve_custom_instructions", () => {
  const rows = byKey(resolveInstructions(
    { custom_instructions: "Session shared.", dream: { custom_instructions: "" } },
    { custom_instructions: "Workspace shared.", summary: { custom_instructions: "Workspace summary." }, peer_card: { custom_instructions: "Card." } },
  ));
  // A session's shared text beats the workspace's own module text.
  assert.deepEqual([rows.summary.effective, rows.summary.source], ["Session shared.", "session.shared"]);
  // "" is an explicit none and stops the fallback.
  assert.deepEqual([rows.dream.effective, rows.dream.source, rows.dream.stored], [null, "session.dream", ""]);
  // Peer card never falls back to the shared text.
  assert.deepEqual([rows.peer_card.effective, rows.peer_card.source], ["Card.", "workspace.peer_card"]);
  assert.deepEqual([rows.shared.effective, rows.shared.source], ["Session shared.", "session.shared"]);
  // Before 3.3 only reasoning instructions exist, with no shared fallback.
  const old = resolveInstructions({ custom_instructions: "ignored" }, { reasoning: { custom_instructions: "Old." } }, { shared: false });
  assert.deepEqual(old.map((row) => [row.key, row.effective, row.source]), [["reasoning", "Old.", "workspace.reasoning"]]);
});

// --- Patch ------------------------------------------------------------------

test("a patch sends only changed sections, rebuilt from the stored ones", () => {
  const stored = {
    reasoning: { custom_instructions: "Keep me." },
    summary: { enabled: true, messages_per_short_summary: 15 },
    dream: { enabled: false },
    extra_key: { keep: true },
  };
  const form = seedSessionSettingsForm(stored);
  form.switches.reasoning = "off";
  form.switches.dream = "inherit";
  const patch = sessionConfigurationPatch(stored, form, CI);
  assert.deepEqual(patch, {
    reasoning: { custom_instructions: "Keep me.", enabled: false },
    dream: {},
  });
  // No change, no patch.
  assert.deepEqual(sessionConfigurationPatch(stored, seedSessionSettingsForm(stored), CI), {});
});

test("instructions are left alone on servers without 3.3 support", () => {
  const stored = { summary: { custom_instructions: "Stored." }, custom_instructions: "Shared." };
  const form = seedSessionSettingsForm(stored);
  form.switches.summary = "off";
  form.instructions.summary = "Changed but unmanaged.";
  assert.deepEqual(sessionConfigurationPatch(stored, form, { customInstructions: false }), {
    summary: { custom_instructions: "Stored.", enabled: false },
  });
});

test("shared session instructions can't go back to inherit, but can go to none", () => {
  const stored = { custom_instructions: "Shared." };
  const form = seedSessionSettingsForm(stored);
  form.sharedInstructions = null;
  assert.throws(() => sessionConfigurationPatch(stored, form, CI), /can't return a session's shared instructions to inherit/);
  form.sharedInstructions = "";
  assert.deepEqual(sessionConfigurationPatch(stored, form, CI), { custom_instructions: "" });
});

test("changes list readable before and after values", () => {
  const form = seedSessionSettingsForm({});
  form.switches.summary = "off";
  form.shortInterval = "030";
  form.instructions.dialectic = "Be brief.";
  assert.deepEqual(planSessionChanges({}, form, CI).map((c) => [c.label, c.from, c.to]), [
    ["SUMMARIES", "inherit", "off"],
    ["SHORT_SUMMARY_INTERVAL", "inherit", "30"],
    ["CHAT_INSTRUCTIONS", "inherit", "Be brief."],
  ]);
});

test("validation checks the server's bounds and the effective pair", () => {
  const form = seedSessionSettingsForm({});
  form.shortInterval = "9";
  assert.match(validateSessionSettings(form, {}), /at least 10/);
  form.shortInterval = "70";
  assert.match(validateSessionSettings(form, { summary: { messages_per_long_summary: 60 } }), /less than the long one/);
  form.longInterval = "80";
  assert.equal(validateSessionSettings(form, { summary: { messages_per_long_summary: 60 } }), null);
});

// --- Members ----------------------------------------------------------------

const members = [
  { id: "alice", peerObserveMe: true, observeMe: null, observeOthers: null },
  { id: "assistant", peerObserveMe: false, observeMe: null, observeOthers: true },
  { id: "bob", peerObserveMe: null, observeMe: false, observeOthers: null },
];

test("member flags resolve like get_effective_observe_me", () => {
  assert.deepEqual(resolveMember(members[0]).observeMe, { effective: true, source: "peer" });
  assert.deepEqual(resolveMember(members[1]).observeOthers, { effective: true, source: "session" });
  assert.deepEqual(resolveMember(members[2]).observeMe, { effective: false, source: "session" });
  assert.deepEqual(resolveMember({ id: "x", peerObserveMe: null, observeMe: null, observeOthers: null }).observeMe, { effective: true, source: "default" });
  // Unobserved peers get nobody, not even observers.
  assert.deepEqual(learnersAbout(members), { alice: ["alice", "assistant"], assistant: [], bob: [] });
});

test("member edits are limited to current members, on or off", () => {
  assert.deepEqual(planMemberChanges(members, { alice: { observe_me: "off", observe_others: "unset" } }).map((c) => [c.id, c.from, c.to]), [
    ["member.alice.observe_me", "unset", "off"],
  ]);
  assert.throws(() => planMemberChanges(members, { carol: { observe_me: "on" } }), /isn't a member/);
  assert.throws(() => planMemberChanges(members, { bob: { observe_me: "unset" } }), /can't clear/);
  assert.throws(() => planMemberChanges([{ id: "scope.billing", peerObserveMe: null, observeMe: null, observeOthers: true }], { "scope.billing": { observe_others: "off" } }), /managed by its scope/);
});

// --- Save against a fake Honcho 3.5 -------------------------------------------

/** Merges writes the way Honcho 3.5 does, get-or-creates on session PUT, and adds non-members on config PUT. */
function fakeHoncho({ configuration = {}, roster = members, active = true, failWrite, failReadAfterWrite } = {}) {
  const db = {
    session: { is_active: active, configuration: structuredClone(configuration) },
    members: new Map(roster.map((m) => [m.id, structuredClone(m)])),
  };
  const calls = [];
  let wrote = false;
  const io = {
    async readSession() {
      calls.push(["readSession"]);
      if (wrote && failReadAfterWrite) throw new Error("read failed");
      return db.session ? structuredClone(db.session) : null;
    },
    async readMembers() {
      calls.push(["readMembers"]);
      return { members: [...db.members.values()].map((m) => structuredClone(m)), truncated: false };
    },
    async writeSession(patch) {
      calls.push(["writeSession", patch]);
      if (failWrite === "session") throw new Error("HTTP 500: boom");
      wrote = true;
      if (!db.session) db.session = { is_active: true, configuration: {} }; // get-or-create
      db.session.configuration = { ...db.session.configuration, ...patch };
    },
    async writeMember(peerId, body) {
      calls.push(["writeMember", peerId, body]);
      if (failWrite === peerId) throw new Error("HTTP 500: member");
      wrote = true;
      const member = db.members.get(peerId) ?? { id: peerId, peerObserveMe: null, observeMe: null, observeOthers: null };
      if (body.observe_me !== undefined) member.observeMe = body.observe_me;
      if (body.observe_others !== undefined) member.observeOthers = body.observe_others;
      db.members.set(peerId, member);
    },
  };
  return { io, db, calls, writes: () => calls.filter(([name]) => name.startsWith("write")) };
}

test("a save writes each change once, keeps unshown fields, and reads every value back", async () => {
  const stored = { reasoning: { custom_instructions: "Keep me." }, other: 1 };
  const fake = fakeHoncho({ configuration: stored });
  const state = await loadSessionSettings(fake.io);
  const form = seedSessionSettingsForm(state.configuration);
  form.switches.reasoning = "off";
  form.switches.summary = "off";
  const result = await saveSessionSettings(fake.io, {
    revision: state.revision, form, memberEdits: { alice: { observe_me: "off" } }, options: CI,
  });
  assert.equal(result.outcome, "saved");
  assert.deepEqual(result.changes.map((c) => c.status), ["saved", "saved", "saved"]);
  assert.deepEqual(fake.writes(), [
    ["writeSession", { reasoning: { custom_instructions: "Keep me.", enabled: false }, summary: { enabled: false } }],
    ["writeMember", "alice", { observe_me: false }],
  ]);
  assert.deepEqual(fake.db.session.configuration, {
    reasoning: { custom_instructions: "Keep me.", enabled: false }, summary: { enabled: false }, other: 1,
  });
});

test("a change made after the settings were read blocks the save", async () => {
  const fake = fakeHoncho();
  const state = await loadSessionSettings(fake.io);
  fake.db.session.configuration = { dream: { enabled: false } }; // someone else
  const form = seedSessionSettingsForm(state.configuration);
  form.switches.reasoning = "off";
  const result = await saveSessionSettings(fake.io, { revision: state.revision, form, memberEdits: {}, options: CI });
  assert.equal(result.outcome, "stale");
  assert.deepEqual(fake.writes(), []);
  // A member flag changed elsewhere counts too.
  const other = fakeHoncho();
  const before = await loadSessionSettings(other.io);
  other.db.members.get("alice").observeOthers = true;
  assert.notEqual((await loadSessionSettings(other.io)).revision, before.revision);
});

test("a deleted or deleting session is never recreated by a save", async () => {
  for (const setup of [(db) => { db.session = null; }, (db) => { db.session.is_active = false; }]) {
    const fake = fakeHoncho();
    const state = await loadSessionSettings(fake.io);
    setup(fake.db);
    const form = seedSessionSettingsForm(state.configuration);
    form.switches.reasoning = "off";
    const result = await saveSessionSettings(fake.io, { revision: state.revision, form, memberEdits: {}, options: CI });
    assert.equal(result.outcome, "missing");
    assert.deepEqual(fake.writes(), []);
  }
});

test("a failed write is not retried and later writes are skipped", async () => {
  const fake = fakeHoncho({ failWrite: "session" });
  const state = await loadSessionSettings(fake.io);
  const form = seedSessionSettingsForm(state.configuration);
  form.switches.reasoning = "off";
  const result = await saveSessionSettings(fake.io, {
    revision: state.revision, form, memberEdits: { alice: { observe_me: "off" } }, options: CI,
  });
  assert.equal(result.outcome, "failed");
  assert.deepEqual(result.changes.map((c) => [c.id, c.status]), [
    ["switch.reasoning", "not_saved"],
    ["member.alice.observe_me", "not_sent"],
  ]);
  assert.equal(fake.writes().length, 1);
  assert.match(result.message, /boom/);
});

test("a partial save reports which changes landed", async () => {
  const fake = fakeHoncho({ failWrite: "bob" });
  const state = await loadSessionSettings(fake.io);
  const form = seedSessionSettingsForm(state.configuration);
  form.switches.dream = "off";
  const result = await saveSessionSettings(fake.io, {
    revision: state.revision, form, memberEdits: { bob: { observe_me: "on" } }, options: CI,
  });
  assert.equal(result.outcome, "partial");
  assert.deepEqual(result.changes.map((c) => c.status), ["saved", "not_saved"]);
});

test("a lost readback reports unknown, not saved", async () => {
  const fake = fakeHoncho({ failReadAfterWrite: true });
  const state = await loadSessionSettings(fake.io);
  const form = seedSessionSettingsForm(state.configuration);
  form.switches.reasoning = "off";
  const result = await saveSessionSettings(fake.io, { revision: state.revision, form, memberEdits: {}, options: CI });
  assert.equal(result.outcome, "unknown");
  assert.deepEqual(result.changes.map((c) => c.status), ["unknown"]);
});

test("edits for someone who left the session are refused before any write", async () => {
  const fake = fakeHoncho();
  const state = await loadSessionSettings(fake.io);
  const result = await saveSessionSettings(fake.io, {
    revision: state.revision, form: seedSessionSettingsForm(state.configuration), memberEdits: { carol: { observe_me: "on" } }, options: CI,
  });
  assert.equal(result.outcome, "rejected");
  assert.deepEqual(fake.writes(), []);
  assert.equal(fake.db.members.has("carol"), false);
});

test("a failed member read keeps session settings editable but blocks member edits", async () => {
  const fake = fakeHoncho();
  fake.io.readMembers = async () => { throw new Error("403"); };
  const state = await loadSessionSettings(fake.io);
  assert.equal(state.members, null);
  assert.equal(state.revision, settingsRevision(state.configuration, null));
  const form = seedSessionSettingsForm(state.configuration);
  const blocked = await saveSessionSettings(fake.io, { revision: state.revision, form, memberEdits: { alice: { observe_me: "off" } }, options: CI });
  assert.equal(blocked.outcome, "rejected");
  form.switches.summary = "off";
  const ok = await saveSessionSettings(fake.io, { revision: state.revision, form, memberEdits: {}, options: CI });
  assert.equal(ok.outcome, "saved");
});

// --- Session conclusions ----------------------------------------------------

test("the conclusions hash and filter carry one session", () => {
  assert.deepEqual(readConclusionsHash("#/conclusions?session=a%20b"), { session: "a b" });
  assert.deepEqual(readConclusionsHash("#/conclusions"), { session: null });
  assert.equal(conclusionsHash("a b"), "#/conclusions?session=a%20b");
  assert.deepEqual(withSessionFilter(undefined, "s1"), { session_id: "s1" });
  assert.deepEqual(withSessionFilter({ observer_id: { in: ["scope.x"] } }, "s1"), { AND: [{ observer_id: { in: ["scope.x"] } }, { session_id: "s1" }] });
  assert.equal(withSessionFilter(null, "s1"), null);
  assert.equal(withSessionFilter(undefined, null), undefined);
});

function lister(rows, size = 2) {
  const calls = [];
  const match = (row, filters) => {
    if (filters.session_id) return row.session_id === filters.session_id;
    const wanted = filters.source_ids?.in;
    assert.ok(Array.isArray(wanted) && wanted.length > 0, "never send an empty source_ids.in");
    return (row.source_ids ?? []).some((id) => wanted.includes(id));
  };
  const list = async ({ page, filters }) => {
    calls.push(filters);
    const all = rows.filter((row) => match(row, filters));
    const pages = Math.max(1, Math.ceil(all.length / size));
    return { items: all.slice((page - 1) * size, page * size), total: all.length, page, size, pages };
  };
  return { list, calls };
}

const conclusion = (id, session_id, source_ids = []) => ({ id, session_id, source_ids, content: id, observer_id: "a", observed_id: "a", created_at: "2026-11-01T00:00:00Z" });

test("derived conclusions filed elsewhere are found one level deep", async () => {
  const rows = [
    conclusion("e1", "nest"), conclusion("e2", "nest"), conclusion("e3", "nest"),
    conclusion("d-same", "nest", ["e1"]),
    conclusion("d-other", "work", ["e1", "e2"]),
    conclusion("d-none", null, ["e3"]),
    conclusion("d-deeper", "work", ["d-other"]),
    conclusion("unrelated", "work", ["x"]),
  ];
  const { list } = lister(rows);
  const found = await findDerivedElsewhere(list, "nest");
  assert.equal(found.scanned, 4); // e1, e2, e3 and d-same are all filed under nest
  assert.deepEqual(found.items.map((item) => [item.conclusion.id, item.cites]).sort(), [["d-none", 1], ["d-other", 2]]);
  assert.equal(found.truncated, false);
  const empty = await findDerivedElsewhere(lister([]).list, "nest");
  assert.deepEqual([empty.items, empty.scanned], [[], 0]);
});

test("listing stops at the limit and says so", async () => {
  const rows = Array.from({ length: 7 }, (_, i) => conclusion(`c${i}`, "s"));
  const all = await listAllConclusions(lister(rows).list, { session_id: "s" }, 5);
  assert.deepEqual([all.items.length, all.truncated], [5, true]);
  const whole = await listAllConclusions(lister(rows).list, { session_id: "s" }, 50);
  assert.deepEqual([whole.items.length, whole.truncated], [7, false]);
});

test("bulk delete goes one by one, never retries, and treats 404 as already gone", async () => {
  const attempts = [];
  const progress = [];
  const outcome = await deleteConclusions(
    [conclusion("a", "s"), conclusion("b", "s"), conclusion("c", "s")],
    async (id) => {
      attempts.push(id);
      if (id === "b") throw Object.assign(new Error("HTTP 404"), { status: 404 });
      if (id === "c") throw Object.assign(new Error("HTTP 500: nope"), { status: 500 });
    },
    (done, total) => progress.push(`${done}/${total}`),
  );
  assert.deepEqual(attempts, ["a", "b", "c"]);
  assert.deepEqual(outcome.deleted.map((c) => c.id), ["a"]);
  assert.deepEqual(outcome.gone, ["b"]);
  assert.deepEqual(outcome.failed, [{ id: "c", error: "HTTP 500: nope" }]);
  assert.deepEqual(progress, ["1/3", "2/3", "3/3"]);
});
