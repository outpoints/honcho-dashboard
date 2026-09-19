/** Metadata-only projection of Honcho's CloudEvents trace stream.
 * Schema source: plastic-labs/honcho v3.2.0, src/telemetry/events/trace.py.
 * Never forward trace.content, tool inputs/outputs, or arbitrary event fields.
 */
export interface TraceRecord {
  id: string;
  type: "llm.call.traced" | "embedding.call.traced";
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

const STRING_FIELDS = [
  "trace_id", "span_id", "parent_span_id", "parent_event_id", "run_id",
  "call_purpose", "parent_category", "session_id", "workspace_name", "observed",
  "peer_name", "agent_type", "track_name", "transport", "provider_label", "provider",
  "model", "system_prompt_ref", "output_content_ref", "output_thinking_ref",
  "output_reasoning_ref", "raw_response_ref", "finish_reason", "error_class",
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

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function boundedString(value: unknown): string | undefined {
  return typeof value === "string" ? value.slice(0, 512) : undefined;
}

export function projectTrace(value: unknown): TraceRecord | null {
  const event = object(value);
  if (!event || event.specversion !== "1.0" || typeof event.id !== "string") return null;
  const type = event.type;
  if (type !== "llm.call.traced" && type !== "embedding.call.traced") return null;
  const data = object(event.data);
  if (!data) return null;
  let version: number | null = null;
  if (event.dataschema !== undefined) {
    const match = typeof event.dataschema === "string"
      ? event.dataschema.match(/^https:\/\/honcho\.dev\/schemas\/(llm\.call\.traced|embedding\.call\.traced)\/v([12])$/)
      : null;
    if (!match || match[1] !== type) return null;
    version = Number(match[2]);
  }
  const metadata: TraceRecord["metadata"] = {};
  for (const key of STRING_FIELDS) {
    const text = boundedString(data[key]);
    if (text !== undefined) metadata[key] = text;
  }
  for (const key of NUMBER_FIELDS) {
    const n = data[key];
    if (typeof n === "number" && Number.isFinite(n) && n >= 0) metadata[key] = n;
  }
  for (const key of BOOL_FIELDS) {
    if (typeof data[key] === "boolean") metadata[key] = data[key];
  }
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
  const timestamp = boundedString(event.time ?? data.timestamp);
  if (timestamp && Number.isFinite(Date.parse(timestamp))) metadata.timestamp = new Date(timestamp).toISOString();
  const source = boundedString(event.source);
  if (source) metadata.source = source;
  return { id: event.id.slice(0, 512), type, schema_version: version, metadata };
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
    && (kind === "all" || entry.type === kind)
    && (!needle || [entry.id, ...Object.values(entry.metadata).flat()].join(" ").toLowerCase().includes(needle)),
  );
}
