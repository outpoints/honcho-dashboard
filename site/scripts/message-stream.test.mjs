import assert from "node:assert/strict";
import test from "node:test";
import { groupRuns, LIVE_PAGE, matchesText, mergeNewer, middleTruncate, PEER_COLUMN_MAX_CHARS, peerColumnWidth, readStreamHash, snippetAround, STREAM_PAGE, streamHash, streamRows, streamUrl, summarize } from "../src/lib/messageStream.ts";

const base = { workspaceId: "ws a", sessionId: null, peerId: null, q: "" };

test("a stream page asks the database for one page, filtered, after a cursor", () => {
  const first = new URL(streamUrl(base), "http://x");
  assert.equal(first.pathname, "/api/operator/db");
  assert.equal(first.searchParams.get("view"), "messages");
  assert.equal(first.searchParams.get("workspace_id"), "ws a");
  assert.equal(first.searchParams.get("limit"), String(STREAM_PAGE));
  for (const key of ["session_id", "peer_id", "q", "before_at", "before_id", "after_at", "after_id"]) assert.equal(first.searchParams.has(key), false, key);

  const next = new URL(streamUrl({ ...base, sessionId: "s/1", peerId: "ana&co", q: "50% off" }, { before: { id: "m9", created_at: "2026-10-25 10:00:00.5+00" } }), "http://x");
  assert.equal(next.searchParams.get("session_id"), "s/1");
  assert.equal(next.searchParams.get("peer_id"), "ana&co");
  assert.equal(next.searchParams.get("q"), "50% off");
  assert.equal(next.searchParams.get("before_at"), "2026-10-25 10:00:00.5+00");
  assert.equal(next.searchParams.get("before_id"), "m9");
  assert.equal(next.searchParams.has("after_at"), false);

  const live = new URL(streamUrl({ ...base, q: "deploy" }, { after: { id: "m12", created_at: "2026-10-25 10:05:00+00" } }), "http://x");
  assert.equal(live.searchParams.get("after_at"), "2026-10-25 10:05:00+00");
  assert.equal(live.searchParams.get("after_id"), "m12");
  assert.equal(live.searchParams.get("q"), "deploy", "live follow keeps the filters");
  assert.equal(live.searchParams.get("limit"), String(LIVE_PAGE));
  assert.equal(live.searchParams.has("before_at"), false);
});

test("filters round-trip through the hash so a link reproduces the view", () => {
  const hash = streamHash({ sessionId: "planning notes", peerId: "alice", q: "  v2 importer " });
  assert.equal(hash, "#/messages?session=planning+notes&peer=alice&q=v2+importer");
  assert.deepEqual(readStreamHash(hash), { sessionId: "planning notes", peerId: "alice", q: "v2 importer" });
  assert.equal(streamHash({ sessionId: null, peerId: null, q: " " }), "#/messages");
  assert.deepEqual(readStreamHash("#/messages"), { sessionId: null, peerId: null, q: "" });
  // Links from Sessions and Search use percent-encoding.
  assert.deepEqual(readStreamHash("#/messages?session=a%2Fb&peer=x%20y"), { sessionId: "a/b", peerId: "x y", q: "" });
});

test("the text filter is a literal, case-insensitive match", () => {
  assert.equal(matchesText("Deploy at 50% load", "50% LOAD"), true);
  assert.equal(matchesText("Deploy", "d.ploy"), false, "no wildcards");
  assert.equal(matchesText("anything", ""), true);
});

test("totals cover the loaded messages", () => {
  assert.deepEqual(summarize([]), { count: 0, tokens: 0, peers: 0, sessions: 0 });
  const rows = [
    { peer_id: "a", session_id: "s1", token_count: 10 },
    { peer_id: "b", session_id: "s1", token_count: 5 },
    { peer_id: "a", session_id: "s2", token_count: Number.NaN },
  ];
  assert.deepEqual(summarize(rows), { count: 3, tokens: 15, peers: 2, sessions: 2 });
});

test("long session ids keep both ends", () => {
  const id = "agent-acmesupport-documents-local-dm-local-0a1b2c3d4e5f60718293a4b";
  const short = middleTruncate(id, 34);
  assert.equal(short.length, 34);
  assert.ok(short.startsWith("agent-acmesupport-do"));
  assert.ok(short.endsWith("18293a4b"));
  assert.ok(short.includes("…"));
  assert.equal(middleTruncate("demo-storefront-01", 34), "demo-storefront-01");
});

test("a search preview starts just before a match deep in the message", () => {
  const long = `${"word ".repeat(40)}then the deployment went live`;
  const snip = snippetAround(long, "DEPLOY");
  assert.ok(snip.startsWith("…"));
  assert.ok(snip.includes("deployment went live"));
  assert.ok(snip.indexOf("deploy") <= 45, "about forty characters of lead-in");
  assert.ok(!/^…\S*word\S/.test(snip), "starts on a word boundary");
  assert.equal(snippetAround("deploy early", "deploy"), null, "a match near the start keeps the normal preview");
  assert.equal(snippetAround(long, "absent"), null);
  assert.equal(snippetAround(long, ""), null);
  assert.equal(snippetAround("a\n\n  b ".repeat(30) + " target", "target").includes("\n"), false, "whitespace collapses");
});

test("the peer column fits the longest name shown, within limits", () => {
  const px = (ids) => Number.parseInt(peerColumnWidth(ids), 10);
  assert.equal(peerColumnWidth(["alice", "claude"]), "79px", "6 characters + 1 slack at 6.6px, plus 32px for the icons");
  assert.ok(px(["alice", "support-escalations"]) > px(["alice", "claude"]));
  assert.equal(px([]), px(["ab"]), "never narrower than the PEER label");
  assert.equal(px(["x".repeat(80)]), px(["x".repeat(PEER_COLUMN_MAX_CHARS)]), "very long ids truncate instead");
});

const msg = (id, session_id, peer_id, minute) => ({ id, session_id, peer_id, content: id, token_count: 1, created_at: `2026-10-25T12:${String(minute).padStart(2, "0")}:00Z` });

test("live follow puts unseen messages in front and never moves shown ones", () => {
  // Two shown messages share a timestamp; their order is the database's and must survive.
  const shown = [msg("Zb", "a", "ana", 3), msg("aA", "a", "bot", 3), msg("m2", "a", "bot", 2)];
  const { list, added } = mergeNewer(shown, [msg("m5", "a", "bot", 5), msg("m4", "b", "ana", 4), msg("Zb", "a", "ana", 3)]);
  assert.equal(added, 2);
  assert.deepEqual(list.map((m) => m.id), ["m5", "m4", "Zb", "aA", "m2"], "new ones in server order, shown ones untouched");
  const again = mergeNewer(list, [msg("m5", "a", "bot", 5)]);
  assert.equal(again.added, 0);
  assert.equal(again.list, list, "nothing new keeps the same list");
});

test("the stream marks where the session changes and dims repeated peers", () => {
  const oldestFirst = [msg("m1", "a", "ana", 1), msg("m2", "a", "ana", 2), msg("m3", "b", "ana", 3), msg("m4", "b", "bot", 4), msg("m5", "a", "bot", 5)];
  const rows = streamRows(oldestFirst, true);
  assert.deepEqual(rows.map((r) => r.sessionStart), [true, false, true, false, true], "a divider at the top and at every change");
  assert.deepEqual(rows.map((r) => r.repeatPeer), [false, true, false, false, false], "a divider resets the repeated peer");
  const one = streamRows(oldestFirst.filter((m) => m.session_id === "a"), false);
  assert.deepEqual(one.map((r) => r.sessionStart), [false, false, false], "one session needs no dividers");
  assert.deepEqual(one.map((r) => r.repeatPeer), [false, true, false]);
  assert.deepEqual(streamRows([], true), []);
});


test("consecutive messages from one session form a group, newest first", () => {
  // Newest first: b runs 9-8, a runs 7-5, b again at 4, a at 3.
  const newestFirst = [msg("m9", "b", "bot", 9), msg("m8", "b", "ana", 8), msg("m7", "a", "bot", 7), msg("m6", "a", "bot", 6), msg("m5", "a", "ana", 5), msg("m4", "b", "ana", 4), msg("m3", "a", "ana", 3)];
  const groups = groupRuns(newestFirst);
  assert.deepEqual(groups.map((g) => g.sessionId), ["b", "a", "b", "a"], "an interleaved session appears in several groups, in time order");
  assert.deepEqual(groups.map((g) => g.messages.map((m) => m.id)), [["m9", "m8"], ["m7", "m6", "m5"], ["m4"], ["m3"]], "newest first inside each group");
  assert.deepEqual(groups.map((g) => g.key), ["m8", "m5", "m4", "m3"], "a group is keyed by its oldest message");
  assert.deepEqual(groups[1].peers, ["bot", "ana"]);
  assert.equal(groups[1].tokens, 3);
  assert.deepEqual(groupRuns([]), []);

  // Live follow adds newer messages to the top group without changing its key.
  const live = groupRuns([msg("m10", "b", "ana", 10), ...newestFirst]);
  assert.deepEqual(live.map((g) => g.key), ["m8", "m5", "m4", "m3"]);
  assert.deepEqual(live[0].messages.map((m) => m.id), ["m10", "m9", "m8"]);
});
