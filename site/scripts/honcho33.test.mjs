import assert from "node:assert/strict";
import test from "node:test";
import { capabilityAtVersion } from "../src/lib/honcho/capabilities.ts";
import { honcho } from "../src/lib/honcho/client.ts";
import {
  buildWorkspaceConfiguration,
  instructionFieldsInError,
  instructionState,
  seedWorkspaceConfigForm,
  validateWorkspaceConfiguration,
  withClearedKeys,
} from "../src/lib/honcho/workspaceConfig.ts";
import { parseTraceLines } from "../src/lib/operator/traceRecords.ts";

// Contracts from plastic-labs/honcho v3.3.0: src/schemas/configuration.py and
// src/crud/workspace.py::update_workspace. The server validates the body, dumps
// it with exclude_none=True, and merges only top-level keys into the stored row.
function dropNone(value) {
  if (Array.isArray(value)) return value;
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null).map(([k, v]) => [k, dropNone(v)]));
}
const serverMerge = (stored, sent) => ({ ...stored, ...dropNone(sent) });

const on33 = { customInstructions: true };
const unverified = { customInstructions: false };

const stored33 = {
  custom_instructions: "Write in plain English.",
  reasoning: { enabled: true, custom_instructions: "Only durable facts." },
  peer_card: { use: true, custom_instructions: "Keep cards short." },
  summary: { enabled: true, messages_per_short_summary: 20, custom_instructions: "" },
  dream: { enabled: false, custom_instructions: "Merge duplicates." },
  dialectic: { custom_instructions: "Answer briefly." },
  extra_flag: { keep: true },
};

test("3.3 instruction gates require a released 3.3.0 or later", () => {
  for (const version of ["3.1.2", "3.2.0", "3.2.2", "3.3.0-rc.1"]) {
    assert.equal(capabilityAtVersion(version, [3, 3, 0]), "unsupported");
  }
  for (const version of ["3.3.0", "v3.3.0", "3.3.1", "3.4.0", "4.0.0"]) {
    assert.equal(capabilityAtVersion(version, [3, 3, 0]), "available");
  }
  for (const version of [undefined, "unknown", "development"]) {
    assert.equal(capabilityAtVersion(version, [3, 3, 0]), "unknown");
  }
});

test("an untouched form round-trips every 3.3 key, including explicit empty instructions", () => {
  for (const options of [on33, unverified]) {
    const built = buildWorkspaceConfiguration(stored33, seedWorkspaceConfigForm(stored33), options);
    assert.deepEqual(built, stored33);
    assert.deepEqual(serverMerge(stored33, withClearedKeys(stored33, built)), stored33);
  }
});

test("editing a toggle on an unverified server keeps nested instructions the form hides", () => {
  const form = { ...seedWorkspaceConfigForm(stored33), summary: false, dream: null };
  const built = buildWorkspaceConfiguration(stored33, form, unverified);
  const saved = serverMerge(stored33, withClearedKeys(stored33, built));
  assert.deepEqual(saved.summary, { enabled: false, messages_per_short_summary: 20, custom_instructions: "" });
  assert.deepEqual(saved.dream, { custom_instructions: "Merge duplicates." });
  assert.equal(saved.custom_instructions, "Write in plain English.");
  assert.deepEqual(saved.dialectic, stored33.dialectic);
  assert.deepEqual(saved.peer_card, stored33.peer_card);
});

test("3.3 form distinguishes inherit, explicit none, and custom text", () => {
  const seeded = seedWorkspaceConfigForm(stored33);
  assert.equal(seeded.instructions.summary, "");
  assert.equal(seeded.instructions.dialectic, "Answer briefly.");
  const form = {
    ...seeded,
    sharedInstructions: "  Be concise.  ",
    instructions: {
      ...seeded.instructions,
      reasoning: "   ",      // whitespace means inherit
      summary: null,         // was explicit none, now inherit
      dream: "",             // explicit none
      dialectic: null,       // the only key in the section
      peer_card: "Names and roles only.",
    },
  };
  const saved = serverMerge(stored33, withClearedKeys(stored33, buildWorkspaceConfiguration(stored33, form, on33)));
  assert.equal(saved.custom_instructions, "Be concise.");
  assert.deepEqual(saved.reasoning, { enabled: true });
  assert.deepEqual(saved.summary, { enabled: true, messages_per_short_summary: 20 });
  assert.deepEqual(saved.dream, { enabled: false, custom_instructions: "" });
  assert.deepEqual(saved.dialectic, {});
  assert.deepEqual(saved.peer_card, { use: true, custom_instructions: "Names and roles only." });
  assert.deepEqual(saved.extra_flag, { keep: true });
});

test("resetting a section or the shared text clears it despite the server's top-level merge", () => {
  const stored = { custom_instructions: "Old", dream: { enabled: false }, summary: { enabled: false } };
  const form = { ...seedWorkspaceConfigForm(stored), sharedInstructions: null, dream: null, summary: null };
  const sent = withClearedKeys(stored, buildWorkspaceConfiguration(stored, form, on33));
  assert.deepEqual(sent, { custom_instructions: "", dream: {}, summary: {} });
  assert.deepEqual(serverMerge(stored, sent), { custom_instructions: "", dream: {}, summary: {} });
  // A fresh workspace sends nothing for unset sections.
  assert.deepEqual(buildWorkspaceConfiguration({}, seedWorkspaceConfigForm({}), on33), {});
});

test("JSON edits that remove keys clear them; unclearable scalars are left alone", () => {
  const stored = { reasoning: { enabled: false }, custom_instructions: "Old", legacy_count: 3, empty: {} };
  assert.deepEqual(withClearedKeys(stored, { dream: { enabled: true } }), {
    dream: { enabled: true }, reasoning: {}, custom_instructions: "",
  });
  assert.deepEqual(withClearedKeys(null, { dream: {} }), { dream: {} });
});

test("summary interval validation matches the server's bounds", () => {
  assert.equal(validateWorkspaceConfiguration({}), null);
  assert.equal(validateWorkspaceConfiguration({ summary: { messages_per_short_summary: 10, messages_per_long_summary: 20 } }), null);
  assert.match(validateWorkspaceConfiguration({ summary: { messages_per_short_summary: 9 } }), /≥ 10/);
  assert.match(validateWorkspaceConfiguration({ summary: { messages_per_long_summary: 19 } }), /≥ 20/);
  assert.match(validateWorkspaceConfiguration({ summary: { messages_per_short_summary: 30, messages_per_long_summary: 30 } }), /less than/);
  assert.match(validateWorkspaceConfiguration({ summary: { messages_per_short_summary: "15" } }), /≥ 10/);
  const nanForm = { ...seedWorkspaceConfigForm({}), shortInterval: "abc" };
  assert.match(validateWorkspaceConfiguration(buildWorkspaceConfiguration({}, nanForm, on33)), /≥ 10/);
});

test("collapsed instruction fields summarize custom, none, inherited, and unset states", () => {
  assert.equal(instructionState("Be brief.", true), "custom");
  assert.equal(instructionState("Be brief.", false), "custom");
  assert.equal(instructionState("", true), "none");
  assert.equal(instructionState("", false), "none");
  assert.equal(instructionState(null, true), "inherits");
  assert.equal(instructionState("   ", true), "inherits");
  assert.equal(instructionState(null, false), "unset");
  assert.equal(instructionState("\n\t", false), "unset");
});

// Shapes captured from Honcho 3.3.0's own models and exception handlers for
// PUT /v3/workspaces/{id} and POST /v3/workspaces with oversized instructions.
test("422 locations name the instruction fields to reveal", () => {
  const detail = (...locs) => ({ detail: locs.map((loc) => ({ loc, msg: "Value error", type: "value_error" })) });
  assert.deepEqual(instructionFieldsInError(detail(["body", "configuration", "summary", "custom_instructions"])), ["summary"]);
  assert.deepEqual(instructionFieldsInError(detail(["body", "configuration", "custom_instructions"])), ["shared"]);
  assert.deepEqual(instructionFieldsInError(detail(
    ["body", "configuration", "peer_card", "custom_instructions"],
    ["body", "configuration", "dialectic", "custom_instructions"],
    ["body", "configuration", "dialectic", "custom_instructions"],
  )), ["peer_card", "dialectic"]);
  // Other fields, unknown sections, string details, and malformed bodies reveal nothing.
  assert.deepEqual(instructionFieldsInError(detail(["body", "configuration", "summary", "messages_per_short_summary"])), []);
  assert.deepEqual(instructionFieldsInError(detail(["body", "configuration", "extra", "custom_instructions"])), []);
  assert.deepEqual(instructionFieldsInError(detail(["body", "metadata"])), []);
  for (const body of [undefined, null, "oops", { detail: "Workspace access required" }, { detail: [null, { loc: "x" }] }]) {
    assert.deepEqual(instructionFieldsInError(body), []);
  }
});

test("workspace update sends the built configuration through the instance proxy", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, body: JSON.parse(init.body), headers: new Headers(init.headers) });
    return new Response(JSON.stringify({ id: "workspace-1" }), { headers: { "content-type": "application/json" } });
  });
  const opts = { baseUrl: "http://honcho.test:8000", token: "synthetic-test-token" };
  const form = { ...seedWorkspaceConfigForm(stored33), summary: false };
  const configuration = withClearedKeys(stored33, buildWorkspaceConfiguration(stored33, form, unverified));
  await honcho.workspaces.update(opts, "workspace-1", { configuration });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PUT");
  assert.ok(calls[0].url.endsWith("/api/honcho/v3/workspaces/workspace-1"));
  assert.equal(calls[0].headers.get("X-Honcho-Base-Url"), opts.baseUrl);
  assert.equal(calls[0].body.configuration.summary.custom_instructions, "");
  assert.equal(calls[0].body.configuration.dream.custom_instructions, "Merge duplicates.");
});

test("Honcho 3.3 traces keep the custom-instructions reference but never its text", () => {
  const event = (data, type, version) => ({ id: `evt-${type}`, specversion: "1.0", type,
    source: "/honcho/example/trace", time: "2026-10-14T10:00:00Z",
    dataschema: `https://honcho.dev/schemas/${type}/v${version}`, data });
  const result = parseTraceLines(JSON.stringify([
    event({ honcho_version: "3.3.0", agent_type: "summary", custom_instructions_ref: "sha256:ci",
      system_prompt_refs: ["sha256:prompt"], custom_instructions: "private-canary" }, "llm.call.traced", 2),
    event({ role: "__custom_instructions__", content_hash: "sha256:ci", content: "private-canary" }, "trace.content", 1),
  ]));
  assert.equal(result.entries.length, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.entries[0].metadata.custom_instructions_ref, "sha256:ci");
  assert.ok(!JSON.stringify(result).includes("private-canary"));
});
