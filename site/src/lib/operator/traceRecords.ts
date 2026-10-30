/** Metadata-only projection of Honcho's CloudEvents stream.
 * Call traces: plastic-labs/honcho v3.2.0, src/telemetry/events/trace.py.
 * v3.3.0 adds `custom_instructions_ref` (a content hash, not the instructions).
 * Agent runs: `dream.specialist` and `dialectic.completed` (src/telemetry/events/
 * dream.py and dialectic.py). v3.4.0 adds tool-loop budget, write-window,
 * working-notes, and since-last-dream counters without bumping their schema.
 * Never forward trace.content, tool inputs/outputs, or arbitrary event fields.
 */
export type CallTraceType = "llm.call.traced" | "embedding.call.traced";
export type AgentRunType = "dream.specialist" | "dialectic.completed";
export type TraceRecordType = CallTraceType | AgentRunType;

export interface TraceRecord {
  id: string;
  type: TraceRecordType;
  schema_version: number | null;
  metadata: Record<string, string | number | boolean | string[]>;
}

export interface TraceResult {
  available: boolean;
  reason?: string;
  entries: TraceRecord[];
  bytes_read: number;
  truncated: boolean;
  skipped: number;
  malformed: number;
  generated_at: string;
}

const CALL_TYPES: readonly string[] = ["llm.call.traced", "embedding.call.traced"];
const AGENT_TYPES: readonly string[] = ["dream.specialist", "dialectic.completed"];

export function isAgentRun(type: TraceRecordType): type is AgentRunType {
  return AGENT_TYPES.includes(type);
}

const STRING_FIELDS = [
  "trace_id", "span_id", "parent_span_id", "parent_event_id", "run_id",
  "call_purpose", "parent_category", "session_id", "workspace_name", "observed",
  "peer_name", "agent_type", "track_name", "transport", "provider_label", "provider",
  "model", "system_prompt_ref", "output_content_ref", "output_thinking_ref",
  "output_reasoning_ref", "raw_response_ref", "custom_instructions_ref", "finish_reason", "error_class",
  "honcho_version",
] as const;
const NUMBER_FIELDS = [
  "iteration", "step_seq", "attempt", "duration_ms", "retry_attempts",
  "effective_max_output_tokens", "provider_input_tokens", "provider_output_tokens",
  "cache_read_tokens", "cache_creation_tokens", "input_count",
] as const;
const BOOL_FIELDS = ["was_fallback", "was_stream", "is_final_attempt", "was_truncated"] as const;
const LIST_FIELDS = [
  "observers", "source_message_ids", "input_message_refs", "system_prompt_refs", "tool_schema_refs",
] as const;

/** Counters and identifiers only. `custom_instructions_source` names a config level, not text. */
const AGENT_STRING_FIELDS = [
  "run_id", "workspace_name", "observer", "observed", "specialist_type", "peer_name",
  "session_name", "reasoning_level", "error_class", "custom_instructions_source", "honcho_version",
] as const;
const AGENT_NUMBER_FIELDS = [
  "iterations", "total_iterations", "iteration_limit", "tool_calls_count", "search_tool_calls_count",
  "refused_search_count", "prefetched_conclusion_count", "duration_ms", "total_duration_ms",
  "input_tokens", "output_tokens", "cache_read_tokens", "cache_creation_tokens",
  "created_observation_count", "deleted_observation_count", "custom_instructions_tokens",
  "notes_added", "notes_replaced", "notes_removed", "notes_entries_loaded", "notes_tokens_loaded",
  "pending_loaded", "pending_resolved", "pending_expired",
  "new_conclusions_shown", "new_conclusions_remaining",
] as const;
const AGENT_BOOL_FIELDS = [
  "success", "hit_iteration_limit", "budget_line_enabled", "write_window_used",
  "peer_card_updated", "hit_input_token_cap",
] as const;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function boundedString(value: unknown): string | undefined {
  return typeof value === "string" ? value.slice(0, 512) : undefined;
}

function schemaVersion(event: Record<string, unknown>, type: string): number | null | false {
  if (event.dataschema === undefined) return null;
  if (typeof event.dataschema !== "string") return false;
  const match = event.dataschema.match(/^https:\/\/honcho\.dev\/schemas\/([a-z.]+)\/v(\d{1,3})$/);
  if (!match || match[1] !== type) return false;
  const version = Number(match[2]);
  // Call traces have shipped v1 and v2 only; agent events evolve additively.
  if (CALL_TYPES.includes(type) && version !== 1 && version !== 2) return false;
  return version >= 1 ? version : false;
}

function copyFields(
  data: Record<string, unknown>,
  metadata: TraceRecord["metadata"],
  fields: { strings: readonly string[]; numbers: readonly string[]; bools: readonly string[] },
) {
  for (const key of fields.strings) {
    const text = boundedString(data[key]);
    if (text !== undefined) metadata[key] = text;
  }
  for (const key of fields.numbers) {
    const n = data[key];
    if (typeof n === "number" && Number.isFinite(n) && n >= 0) metadata[key] = n;
  }
  for (const key of fields.bools) {
    if (typeof data[key] === "boolean") metadata[key] = data[key];
  }
}

export function projectTrace(value: unknown): TraceRecord | null {
  const event = object(value);
  if (!event || event.specversion !== "1.0" || typeof event.id !== "string") return null;
  const type = event.type;
  if (typeof type !== "string" || (!CALL_TYPES.includes(type) && !AGENT_TYPES.includes(type))) return null;
  const data = object(event.data);
  if (!data) return null;
  const version = schemaVersion(event, type);
  if (version === false) return null;
  const metadata: TraceRecord["metadata"] = {};
  if (AGENT_TYPES.includes(type)) {
    copyFields(data, metadata, { strings: AGENT_STRING_FIELDS, numbers: AGENT_NUMBER_FIELDS, bools: AGENT_BOOL_FIELDS });
    // dream.specialist reports success; dialectic.completed has no outcome field.
    if (typeof data.success === "boolean") metadata.outcome = data.success ? "success" : "error";
  } else {
    copyFields(data, metadata, { strings: STRING_FIELDS, numbers: NUMBER_FIELDS, bools: BOOL_FIELDS });
    for (const key of LIST_FIELDS) {
      if (Array.isArray(data[key])) {
        metadata[key] = data[key].filter((v): v is string => typeof v === "string")
          .slice(0, 100).map((v) => v.slice(0, 512));
      }
    }
    if (Array.isArray(data.queue_item_ids)) {
      metadata.queue_item_ids = data.queue_item_ids
        .filter((v): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0)
        .slice(0, 100).map(String);
    }
    if (typeof data.outcome === "string" && ["success", "error", "cancelled"].includes(data.outcome)) metadata.outcome = data.outcome;
  }
  const timestamp = boundedString(event.time ?? data.timestamp);
  if (timestamp && Number.isFinite(Date.parse(timestamp))) metadata.timestamp = new Date(timestamp).toISOString();
  const source = boundedString(event.source);
  if (source) metadata.source = source;
  return { id: event.id.slice(0, 512), type: type as TraceRecordType, schema_version: version, metadata };
}

/** A collector can persist individual events or compact CloudEvents batches per line. */
export function parseTraceLines(text: string, limit = 200) {
  const entries: TraceRecord[] = [];
  let skipped = 0;
  let malformed = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { malformed++; continue; }
    for (const value of Array.isArray(parsed) ? parsed : [parsed]) {
      const record = projectTrace(value);
      if (record) entries.push(record);
      else skipped++;
    }
  }
  const cappedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 200;
  return { entries: entries.slice(-cappedLimit).reverse(), skipped, malformed };
}

export function filterTraces(entries: TraceRecord[], query: string, outcome: string, kind: string): TraceRecord[] {
  const needle = query.trim().toLowerCase();
  return entries.filter((entry) =>
    (outcome === "all" || (entry.metadata.outcome ?? "unknown") === outcome)
    && (kind === "all" || entry.type === kind || (kind === "agent" && isAgentRun(entry.type)))
    && (!needle || [entry.id, ...Object.values(entry.metadata).flat()].join(" ").toLowerCase().includes(needle)),
  );
}

export interface AgentRunSummary {
  runs: number;
  /** Runs that recorded the 3.4 budget fields; older events leave them out. */
  withBudget: number;
  hitIterationLimit: number;
  writeWindowUsed: number;
  notesTouched: number;
}

/** Rollup for the loaded window. Counts only what each event recorded. */
export function summarizeAgentRuns(entries: TraceRecord[]): AgentRunSummary {
  const runs = entries.filter((entry) => isAgentRun(entry.type));
  const notes = (entry: TraceRecord) =>
    ["notes_added", "notes_replaced", "notes_removed"].some((key) => Number(entry.metadata[key] ?? 0) > 0);
  return {
    runs: runs.length,
    withBudget: runs.filter((entry) => typeof entry.metadata.hit_iteration_limit === "boolean").length,
    hitIterationLimit: runs.filter((entry) => entry.metadata.hit_iteration_limit === true).length,
    writeWindowUsed: runs.filter((entry) => entry.metadata.write_window_used === true).length,
    notesTouched: runs.filter(notes).length,
  };
}
