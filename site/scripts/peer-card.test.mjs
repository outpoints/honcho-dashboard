import assert from "node:assert/strict";
import test from "node:test";
import { cardName, cardWarnings, parseCardLine, readsInline, structureCard } from "../src/lib/peerCard.ts";

test("card lines split into Honcho's prefix, key, and value", () => {
  assert.deepEqual(parseCardLine("IDENTITY: Name: Alice"), { kind: "identity", key: "Name", value: "Alice", line: "IDENTITY: Name: Alice" });
  assert.deepEqual(parseCardLine("ATTRIBUTE: Prefers tea"), { kind: "attribute", key: null, value: "Prefers tea", line: "ATTRIBUTE: Prefers tea" });
  assert.equal(parseCardLine("ATTRIBUTE: Homepage: https://example.com/a:b").value, "https://example.com/a:b");
  assert.equal(parseCardLine("ATTRIBUTE: Store URL: `https://x.test/app`").key, "Store URL");
  // Instructions are sentences, never key/value pairs.
  const rule = parseCardLine("INSTRUCTION: Note: always ask first");
  assert.equal(rule.key, null);
  assert.equal(rule.value, "Note: always ask first");
  // A sentence ending before the colon is not a key.
  assert.equal(parseCardLine("ATTRIBUTE: Works remotely. Usually: mornings").key, null);
  // Legacy and hand-written lines keep their text and have no kind.
  assert.deepEqual(parseCardLine("Name: alice"), { kind: null, key: null, value: "Name: alice", line: "Name: alice" });
  assert.equal(parseCardLine("identity: Name: lower case is not Honcho's format").kind, null);
});

test("a card groups repeated keys, keeps rules whole, and never drops unprefixed lines", () => {
  const card = structureCard([
    "IDENTITY: Name: Alice Example",
    "IDENTITY: Kind: Human",
    "IDENTITY: Kind: iOS developer",
    "ATTRIBUTE: Programming language: Swift",
    "ATTRIBUTE: Location: Oslo",
    "ATTRIBUTE: programming language: Python",
    "ATTRIBUTE: Programming language: Swift",
    "ATTRIBUTE: Prefers tea",
    "RELATIONSHIP: GitHub: alice-example",
    "INSTRUCTION: Never push to main without review",
    "Ships on Mondays",
    "   ",
  ]);
  assert.deepEqual(card.identity, [{ key: "Name", values: ["Alice Example"] }, { key: "Kind", values: ["Human", "iOS developer"] }]);
  assert.deepEqual(card.attributes, [
    { key: "Programming language", values: ["Swift", "Python"] },
    { key: "Location", values: ["Oslo"] },
    { key: null, values: ["Prefers tea"] },
  ]);
  assert.deepEqual(card.relationships, [{ key: "GitHub", values: ["alice-example"] }]);
  assert.deepEqual(card.instructions, ["Never push to main without review"]);
  assert.deepEqual(card.unstructured, ["Ships on Mondays"]);
  assert.equal(card.total, 11, "blank lines are not entries");
  assert.equal(cardName(card), "Alice Example");
  assert.equal(cardName(structureCard(["ATTRIBUTE: Location: Oslo"])), null);
});

test("short value lists read inline; long ones stack", () => {
  assert.equal(readsInline(["Swift", "Python", "SQL"]), true);
  assert.equal(readsInline(["Swift"]), false, "a single value is just a value");
  assert.equal(readsInline(["Owner of Example Holdings LLC (DBA Example Labs)", "Owner of an app"]), false);
});

test("hand edits get the warnings Honcho's own writer would enforce", () => {
  assert.deepEqual(cardWarnings(["IDENTITY: Name: A", "ATTRIBUTE: Location: Oslo"]), []);
  const warnings = cardWarnings(["IDENTITY: Name: A", "Name: legacy", `ATTRIBUTE: Bio: ${"x".repeat(200)}`, ...Array.from({ length: 39 }, (_, i) => `ATTRIBUTE: K${i}: v`)]);
  assert.equal(warnings.length, 3);
  assert.match(warnings[0], /^1 line has no IDENTITY/);
  assert.match(warnings[1], /^1 line is over 200 characters/);
  assert.match(warnings[2], /^42 entries; Honcho keeps its own cards to 40/);
});
