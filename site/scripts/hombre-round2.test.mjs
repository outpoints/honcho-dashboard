import assert from "node:assert/strict";
import test from "node:test";
import { findMatches, highlightTerms } from "../src/lib/textHighlight.ts";
import { conclusionSourceFilter, scopeOfObserver } from "../src/lib/honcho/scopeCopies.ts";
import { continuationText, countLevels, detectLevel, mergeLogEntries, parseLogChunk, parseLogLine } from "../src/lib/operator/logLines.ts";

const bytes = (text) => new TextEncoder().encode(text);

test("highlight terms are words of two or more characters, longest first", () => {
  assert.deepEqual(highlightTerms('  Audit "logs", a  audit '), ["audit", "logs"]);
  assert.deepEqual(highlightTerms("x"), []);
  assert.equal(highlightTerms("a1 b2 c3 d4 e5 f6 g7 h8 i9 j10").length, 8);
});

test("matches are case-insensitive, non-overlapping, and merged", () => {
  assert.deepEqual(findMatches("Audit logs before audit", ["audit", "logs"]), [[0, 5], [6, 10], [18, 23]]);
  assert.deepEqual(findMatches("billing", ["bill", "billing"]), [[0, 7]]);
  assert.deepEqual(findMatches("", ["a"]), []);
  assert.deepEqual(findMatches("aaaa", ["aa"]), [[0, 4]]);
});

test("scope copies are recognized by their internal observer and filtered on the server", () => {
  assert.equal(scopeOfObserver("scope.billing"), "billing");
  assert.equal(scopeOfObserver("scope."), null);
  assert.equal(scopeOfObserver("ana-customer"), null);
  assert.equal(scopeOfObserver(null), null);
  assert.equal(conclusionSourceFilter("all", ["billing"]), undefined);
  assert.deepEqual(conclusionSourceFilter("scopes", ["billing", "vip", "billing"]), { observer_id: { in: ["scope.billing", "scope.vip"] } });
  assert.deepEqual(conclusionSourceFilter("peers", ["billing"]), { NOT: [{ observer_id: { in: ["scope.billing"] } }] });
  // No scopes: every conclusion is peer memory, and asking for copies needs no request.
  assert.equal(conclusionSourceFilter("peers", []), undefined);
  assert.equal(conclusionSourceFilter("scopes", []), null);
});

test("log levels come from level words, then HTTP status, then loose words", () => {
  assert.equal(detectLevel("src.deriver - ERROR - boom"), "error");
  assert.equal(detectLevel('INFO:     172.25.0.1 - "POST /v3/x HTTP/1.1" 200'), "info");
  assert.equal(detectLevel('INFO:     172.25.0.1 - "POST /v3/x HTTP/1.1" 422'), "warn");
  assert.equal(detectLevel('INFO:     172.25.0.1 - "GET /v3/x HTTP/1.1" 503'), "error");
  assert.equal(detectLevel('172.25.0.1 - "GET /health HTTP/1.1" 200'), "info");
  assert.equal(detectLevel("INFO - retried after error"), "info");
  assert.equal(detectLevel("something failed with an exception"), "error");
  assert.equal(detectLevel("plain text"), "unknown");
});

test("docker timestamps, compose prefixes, python logging, and JSON lines parse", () => {
  const docker = parseLogLine("2026-10-22T20:44:11.217Z 2026-10-22 20:44:11,217 - src.dreamer.orchestrator - INFO - Dream completed", 10);
  assert.equal(docker.timestamp, "2026-10-22T20:44:11.217Z");
  assert.equal(docker.source, "src.dreamer.orchestrator");
  assert.equal(docker.level, "info");
  assert.equal(docker.message, "Dream completed");
  assert.equal(docker.id, "10");
  const compose = parseLogLine("deriver-1  | WARNING: queue backlog", 0);
  assert.equal(compose.source, "deriver-1");
  assert.equal(compose.level, "warn");
  assert.equal(compose.message, "queue backlog");
  const json = parseLogLine('{"level":"warning","message":"slow query","time":"2026-10-22T20:00:00Z","logger":"db"}', 5);
  assert.deepEqual([json.level, json.message, json.timestamp, json.source], ["warn", "slow query", "2026-10-22T20:00:00Z", "db"]);
  assert.equal(parseLogLine("[worker] started", 0).source, "worker");
});

test("chunk offsets are byte-exact and stable when a read starts mid-file", () => {
  const text = "first é line\nsecond line\nthird\n";
  const all = parseLogChunk(bytes(text), 0, 100);
  assert.deepEqual(all.map((e) => e.offset), [0, 14, 26]);
  // Start inside the multi-byte "é": the partial first line is dropped, ids match.
  const tail = parseLogChunk(bytes(text).subarray(7), 7, 100);
  assert.deepEqual(tail.map((e) => [e.offset, e.message]), [[14, "second line"], [26, "third"]]);
  assert.deepEqual(parseLogChunk(bytes("no newline yet"), 3, 10), []);
  assert.equal(parseLogChunk(bytes("a\nb\nc\n"), 0, 2).length, 2);
  assert.equal(parseLogChunk(bytes("one\r\ntwo"), 0, 10)[1].message, "two");
});

test("merging dedupes by offset, keeps order, bounds size, and resets on rotation", () => {
  const e = (offset) => ({ id: String(offset), offset, level: "info", message: `m${offset}` });
  const first = [e(0), e(10), e(20)];
  assert.equal(mergeLogEntries(first, []), first);
  assert.deepEqual(mergeLogEntries(first, [e(20), e(30)]).map((x) => x.offset), [0, 10, 20, 30]);
  assert.deepEqual(mergeLogEntries(first, [e(30), e(40)], 3).map((x) => x.offset), [20, 30, 40]);
  assert.deepEqual(mergeLogEntries(first, [e(0), e(5)]).map((x) => x.offset), [0, 5]);
  // A re-read of the same record replaces the older copy.
  assert.equal(mergeLogEntries(first, [{ ...e(20), message: "longer" }]).at(-1).message, "longer");
  assert.deepEqual(countLevels([e(0), { ...e(1), level: "error" }]), { error: 1, warn: 0, info: 1, debug: 0, unknown: 0 });
});

test("rich-wrapped uvicorn access lines are joined back into one record", () => {
  const raw = [
    '2026-10-22T21:11:57.634243882Z       INFO   172.25.0.1:57820 - "POST                    ',
    "2026-10-22T21:11:57.634324174Z              /v3/workspaces/northwind-support/sessions/ticket-1046",
    '2026-10-22T21:11:57.634333591Z              /messages?size=1',
    '2026-10-22T21:11:57.634333591Z              HTTP/1.1" 422',
    "2026-10-22T21:11:57.699809258Z 2026-10-22 21:11:57,699 - httpx - INFO - HTTP Request: POST http://mock-provider:8000/v1/embeddings",
    "",
  ].join("\n");
  const entries = parseLogChunk(bytes(raw), 0, 100);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].message, '172.25.0.1:57820 - "POST /v3/workspaces/northwind-support/sessions/ticket-1046/messages?size=1 HTTP/1.1" 422');
  assert.equal(entries[0].level, "warn");
  assert.equal(entries[0].timestamp, "2026-10-22T21:11:57.634243882Z");
  assert.equal(entries[1].source, "httpx");
  assert.equal(continuationText("2026-10-22T21:11:57.6Z       INFO   next record"), null);
  assert.equal(continuationText("plain line"), null);
  assert.equal(continuationText("              tail of a wrapped line"), "tail of a wrapped line");
});
