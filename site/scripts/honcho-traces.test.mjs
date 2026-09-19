import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectTrace, parseTraceLines, filterTraces } from "../src/lib/operator/traceRecords.ts";
import { readTraceFile, TRACE_TAIL_BYTES } from "../src/lib/operator/traceFile.ts";

function event(data = {}, type = "llm.call.traced", version = 2) {
  return { id: "evt-1", specversion: "1.0", type, source: "/honcho/example/trace",
    time: "2026-09-18T10:00:00-07:00", dataschema: `https://honcho.dev/schemas/${type}/v${version}`, data };
}

test("v2 trace projection preserves diagnostics and provenance without content", () => {
  const projected = projectTrace(event({ model: "model", duration_ms: 0, attempt: 2,
    retry_attempts: 3, is_final_attempt: false, outcome: "cancelled", session_id: "s",
    workspace_name: "w", agent_type: "deriver", source_message_ids: ["m"],
    system_prompt_ref: "sha256:prompt", queue_item_ids: [42],
    content: "private", system_prompt: "private", output_tool_calls: [{ input: "private" }],
    api_key: "private", output_signatures: ["private"], client: { token: "private" },
  }));
  assert.equal(projected.schema_version, 2);
  assert.equal(projected.metadata.duration_ms, 0);
  assert.equal(projected.metadata.is_final_attempt, false);
  assert.equal(projected.metadata.timestamp, "2026-09-18T17:00:00.000Z");
  assert.equal(projected.metadata.outcome, "cancelled");
  assert.deepEqual(projected.metadata.source_message_ids, ["m"]);
  assert.deepEqual(projected.metadata.queue_item_ids, ["42"]);
  assert.equal(projected.metadata.system_prompt_ref, "sha256:prompt");
  assert.ok(!JSON.stringify(projected).includes("private"));
});

test("v1 archives and missing metadata stay unknown rather than invented success or zero", () => {
  const projected = projectTrace(event({ model: "legacy" }, "llm.call.traced", 1));
  assert.equal(projected.schema_version, 1);
  assert.equal(projected.metadata.duration_ms, undefined);
  assert.equal(projected.metadata.outcome, undefined);
  assert.equal(projected.metadata.attempt, undefined);
  const withoutSchema = event();
  delete withoutSchema.dataschema;
  assert.equal(projectTrace(withoutSchema).schema_version, null);
  assert.equal(projectTrace(event({}, "llm.call.traced", 3)), null);
});

test("embedding traces use provider and preserve estimate accounting", () => {
  const projected = projectTrace(event({ provider: "openai", input_count: 5,
    provider_input_tokens: 20, outcome: "error", error_class: "TimeoutError",
    is_final_attempt: true, session_id: "session", duration_ms: 350,
  }, "embedding.call.traced"));
  assert.equal(projected.type, "embedding.call.traced");
  assert.equal(projected.metadata.provider, "openai");
  assert.equal(projected.metadata.input_count, 5);
  assert.equal(projected.metadata.provider_input_tokens, 20);
  assert.equal(projected.metadata.is_final_attempt, true);
});

test("parser skips content/ordinary events and malformed input, handles compact batches", () => {
  const first = event({ workspace_name: "alpha" });
  const second = { ...event({ workspace_name: "beta" }), id: "evt-2" };
  const result = parseTraceLines([
    JSON.stringify(first), "{incomplete", JSON.stringify({ message: "ordinary" }),
    JSON.stringify([event({ content: "secret" }, "trace.content", 1), second]),
  ].join("\n"));
  assert.equal(result.malformed, 1);
  assert.equal(result.skipped, 2);
  assert.deepEqual(result.entries.map((e) => e.id), ["evt-2", "evt-1"]);
  assert.equal(projectTrace(null), null);
  assert.equal(projectTrace({ ...first, data: [] }), null);
});

test("malformed field shapes are discarded and metadata is bounded", () => {
  const projected = projectTrace(event({ duration_ms: -1, attempt: "3", was_stream: "false",
    model: "m".repeat(900), source_message_ids: Array(200).fill("id"), outcome: { toString: null },
    queue_item_ids: [1, -1, "2", 1.5], observers: [null, {}, "peer"],
  }));
  assert.equal(projected.metadata.duration_ms, undefined);
  assert.equal(projected.metadata.attempt, undefined);
  assert.equal(projected.metadata.was_stream, undefined);
  assert.equal(projected.metadata.outcome, undefined);
  assert.equal(projected.metadata.model.length, 512);
  assert.equal(projected.metadata.source_message_ids.length, 100);
  assert.deepEqual(projected.metadata.queue_item_ids, ["1"]);
  assert.deepEqual(projected.metadata.observers, ["peer"]);
});

test("filters combine event kind, outcome, and correlation metadata", () => {
  const entries = [projectTrace(event({ source_message_ids: ["message-abc"], outcome: "error" })),
    projectTrace(event({ session_id: "session-abc" }, "embedding.call.traced"))];
  assert.equal(filterTraces(entries, "MESSAGE-ABC", "error", "llm.call.traced").length, 1);
  assert.equal(filterTraces(entries, "abc", "unknown", "embedding.call.traced").length, 1);
  assert.equal(filterTraces(entries, "abc", "success", "all").length, 0);
});

test("file tail is bounded, survives a partial first/last record, and caps returned calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "honcho-trace-test-"));
  try {
    const file = join(dir, "events.jsonl");
    const lines = Array.from({ length: 250 }, (_, n) => JSON.stringify({ ...event({ model: "fixture" }), id: `evt-${n}` }));
    await writeFile(file, "x".repeat(TRACE_TAIL_BYTES + 10) + "\n" + lines.join("\n") + "\n{partial");
    const result = await readTraceFile(file);
    assert.equal(result.available, true);
    assert.equal(result.bytes_read, TRACE_TAIL_BYTES);
    assert.equal(result.truncated, true);
    assert.equal(result.malformed, 1);
    assert.equal(result.entries.length, 200);
    assert.equal(result.entries[0].id, "evt-249");
    assert.equal(result.entries.at(-1).id, "evt-50");
    await writeFile(file, "");
    assert.deepEqual((await readTraceFile(file)).entries, []);
    assert.equal((await readTraceFile(file)).truncated, false);
    assert.equal((await readTraceFile(dir)).available, false);
    const missing = await readTraceFile(join(dir, "not-found"));
    assert.equal(missing.available, false);
    assert.ok(!missing.reason.includes(dir));
    assert.equal((await readTraceFile(undefined)).available, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
