import assert from "node:assert/strict";
import test from "node:test";
import {
  appendPage,
  conclusionFilters,
  defaultLevel,
  foldDuplicates,
  readSelectedPeer,
  shortAge,
} from "../src/lib/peerMemory.ts";

test("filters ask Honcho for conclusions about the peer, narrowed by level, viewpoint, and text", () => {
  assert.deepEqual(conclusionFilters("ana", { level: "all", perspective: "all" }), { observed_id: "ana" });
  assert.deepEqual(conclusionFilters("ana", { level: "inductive", perspective: "own" }), {
    observed_id: "ana",
    level: "inductive",
    observer_id: "ana",
  });
  assert.deepEqual(conclusionFilters("ana", { level: "explicit", perspective: "others", text: "  billing ", since: "2026-10-01T00:00:00.000Z" }), {
    observed_id: "ana",
    level: "explicit",
    NOT: [{ observer_id: "ana" }],
    content: { icontains: "billing" },
    created_at: { gte: "2026-10-01T00:00:00.000Z" },
  });
  assert.equal("content" in conclusionFilters("ana", { level: "all", perspective: "all", text: "   " }), false, "blank text adds no filter");
});

test("the first tab is the rarest synthesized level that has conclusions", () => {
  assert.equal(defaultLevel({ all: 900, inductive: 3, deductive: 9, explicit: 888 }), "inductive");
  assert.equal(defaultLevel({ all: 900, inductive: 0, deductive: 9 }), "deductive");
  assert.equal(defaultLevel({ all: 900, inductive: 0, deductive: 0, explicit: 900 }), "all");
  assert.equal(defaultLevel({}), "all", "counts still loading");
});

const c = (id, content, observer, extra = {}) => ({ id, content, observer_id: observer, observed_id: "ana", created_at: "2026-10-01T00:00:00Z", ...extra });

test("the same text held by several observers shows once, naming the others", () => {
  const rows = foldDuplicates([
    c("1", "Ana prefers annual billing.", "ana"),
    c("2", "Ships on Mondays", "bot"),
    c("3", "  ana prefers  annual billing. ", "support-bot"),
    c("4", "Ana prefers annual billing.", "ana"),
    c("5", "Ana prefers annual billing.", "support-bot"),
  ]);
  assert.deepEqual(rows.map((r) => r.item.id), ["1", "2"], "first (newest) copy is the row; order kept");
  assert.deepEqual(rows[0].alsoHeldBy, ["support-bot"]);
  assert.equal(rows[0].copies, 4);
  assert.deepEqual(rows[1].alsoHeldBy, []);
  assert.equal(rows[1].copies, 1);
});

test("loading more never repeats a conclusion already shown", () => {
  const first = [c("1", "a", "x"), c("2", "b", "x")];
  assert.deepEqual(appendPage(first, [c("2", "b", "x"), c("3", "c", "x")]).map((x) => x.id), ["1", "2", "3"]);
});

test("ages stay short in list rows", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  assert.equal(shortAge("2026-10-25T11:59:40Z", now), "just now");
  assert.equal(shortAge("2026-10-25T11:15:00Z", now), "45m ago");
  assert.equal(shortAge("2026-10-25T02:00:00Z", now), "10h ago");
  assert.equal(shortAge("2026-10-22T12:00:00Z", now), "3d ago");
  assert.match(shortAge("2026-05-21T12:00:00Z", now), /May 21/);
  assert.equal(shortAge(null, now), "—");
  assert.equal(shortAge("not a date", now), "—");
});

test("a peer link names its workspace so ids stay unique across workspaces", () => {
  assert.deepEqual(readSelectedPeer("#/peers?ws=w1&peer=w1%2Fana%2Fx"), { workspaceId: "w1", peerId: "ana/x" });
  assert.equal(readSelectedPeer("#/peers"), null);
  assert.equal(readSelectedPeer("#/peers?peer=nopeer"), null);
  assert.equal(readSelectedPeer("#/peers?peer=%2Fana"), null);
  assert.equal(readSelectedPeer("#/peers?peer=w1%2F"), null);
});
