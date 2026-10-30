import assert from "node:assert/strict";
import test from "node:test";
import { appendOlder, shortStamp, TRANSCRIPT_PAGE } from "../src/lib/sessionTranscript.ts";

const m = (id) => ({ id });

test("earlier pages append after the newest-first list and skip ids already shown", () => {
  const first = [m("m9"), m("m8"), m("m7")];
  assert.deepEqual(appendOlder(first, [m("m6"), m("m5")]).map((x) => x.id), ["m9", "m8", "m7", "m6", "m5"]);
  // A message written between reads shifts the page window; the overlap is dropped.
  assert.deepEqual(appendOlder(first, [m("m7"), m("m6")]).map((x) => x.id), ["m9", "m8", "m7", "m6"]);
  assert.equal(appendOlder(first, []), first);
  assert.equal(appendOlder(first, [m("m8")]), first);
});

test("older pages keep the server's newest-first order, ties included", () => {
  // b1 and b2 share a timestamp; their order is the server's and must survive.
  const first = [m("c"), m("b2"), m("b1")];
  const merged = appendOlder(first, [m("a2"), m("a1")]);
  assert.deepEqual(merged.map((x) => x.id), ["c", "b2", "b1", "a2", "a1"]);
  assert.deepEqual(first.map((x) => x.id), ["c", "b2", "b1"], "input is not mutated");
  assert.ok(TRANSCRIPT_PAGE >= 10 && TRANSCRIPT_PAGE <= 100);
});

test("timestamps shorten by distance from now", () => {
  const now = new Date(2026, 9, 25, 15, 0);
  assert.equal(shortStamp(new Date(2026, 9, 25, 9, 5).toISOString(), now), "09:05");
  assert.equal(shortStamp(new Date(2026, 9, 22, 13, 44).toISOString(), now), "Oct 22 13:44");
  assert.equal(shortStamp(new Date(2025, 0, 3, 8, 0).toISOString(), now), "2025-01-03");
  assert.equal(shortStamp("not a date", now), "—");
});
