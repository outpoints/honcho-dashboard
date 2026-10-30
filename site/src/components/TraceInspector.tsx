"use client";

import { useState } from "react";
import { Panel } from "@/components/Panel";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import { Button, Chip, Field, TextInput } from "@/components/atoms";
import type { OperatorQueryState } from "@/lib/operator/client";
import {
  filterTraces,
  isAgentRun,
  summarizeAgentRuns,
  type TraceRecord,
  type TraceResult,
} from "@/lib/operator/traceRecords";

type DetailGroups = readonly (readonly [string, readonly string[]])[];

const CALL_DETAIL_GROUPS: DetailGroups = [
  ["EXECUTION", ["timestamp", "model", "transport", "provider", "provider_label", "outcome", "duration_ms", "attempt", "retry_attempts", "is_final_attempt", "was_fallback", "was_stream", "error_class", "finish_reason", "was_truncated"]],
  ["CORRELATION", ["source", "workspace_name", "session_id", "agent_type", "call_purpose", "track_name", "parent_category", "trace_id", "span_id", "parent_span_id", "run_id", "parent_event_id", "iteration", "step_seq", "peer_name", "observers", "observed", "source_message_ids", "queue_item_ids"]],
  ["CONTENT_REFERENCES", ["system_prompt_ref", "system_prompt_refs", "input_message_refs", "tool_schema_refs", "output_content_ref", "output_thinking_ref", "output_reasoning_ref", "raw_response_ref", "custom_instructions_ref"]],
  ["ACCOUNTING", ["provider_input_tokens", "provider_output_tokens", "cache_read_tokens", "cache_creation_tokens", "effective_max_output_tokens", "input_count", "honcho_version"]],
];

const AGENT_DETAIL_GROUPS: DetailGroups = [
  ["RUN", ["timestamp", "source", "run_id", "workspace_name", "specialist_type", "observer", "observed", "peer_name", "session_name", "reasoning_level", "outcome", "error_class", "duration_ms", "total_duration_ms", "honcho_version"]],
  ["TOOL_LOOP_BUDGET", ["iterations", "total_iterations", "iteration_limit", "hit_iteration_limit", "budget_line_enabled", "write_window_used", "refused_search_count", "tool_calls_count", "search_tool_calls_count", "prefetched_conclusion_count", "hit_input_token_cap"]],
  ["WORKING_NOTES", ["notes_added", "notes_replaced", "notes_removed", "notes_entries_loaded", "notes_tokens_loaded", "pending_loaded", "pending_resolved", "pending_expired"]],
  ["SINCE_LAST_DREAM", ["new_conclusions_shown", "new_conclusions_remaining"]],
  ["OUTPUT", ["created_observation_count", "deleted_observation_count", "peer_card_updated", "custom_instructions_source", "custom_instructions_tokens"]],
  ["ACCOUNTING", ["input_tokens", "output_tokens", "cache_read_tokens", "cache_creation_tokens"]],
];

const TYPE_LABEL: Record<TraceRecord["type"], string> = {
  "llm.call.traced": "LLM",
  "embedding.call.traced": "EMBEDDING",
  "dream.specialist": "DREAM",
  "dialectic.completed": "DIALECTIC",
};

function value(entry: TraceRecord, key: string): string {
  const val = entry.metadata[key];
  return val === undefined ? "Not recorded" : Array.isArray(val) ? val.join("\n") || "None" : String(val);
}

function duration(entry: TraceRecord): string {
  const ms = entry.metadata.duration_ms ?? entry.metadata.total_duration_ms;
  return typeof ms === "number" ? `${Math.round(ms)} ms` : "Timing not recorded";
}

/** Dream specialists and dialectic runs: identity, iteration budget, and notes deltas. */
function AgentRunRow({ entry }: { entry: TraceRecord }) {
  const m = entry.metadata;
  const iterations = m.iterations ?? m.total_iterations;
  const notes = [
    typeof m.notes_added === "number" ? `+${m.notes_added}` : null,
    typeof m.notes_replaced === "number" ? `~${m.notes_replaced}` : null,
    typeof m.notes_removed === "number" ? `-${m.notes_removed}` : null,
  ].filter(Boolean).join(" ");
  const dream = entry.type === "dream.specialist";
  return (
    <>
      <p className="text-[11px] text-accent break-all">
        {value(entry, "workspace_name")} / {dream ? `${value(entry, "observer")} → ${value(entry, "observed")}` : value(entry, "peer_name")}
      </p>
      <p className="text-[10px] text-text-primary break-all">
        {value(entry, "timestamp")} · {dream ? value(entry, "specialist_type") : value(entry, "reasoning_level")}
      </p>
      <p className="text-[10px] text-text-primary tabular-nums">
        Iterations {iterations ?? "—"} / {m.iteration_limit ?? "limit not recorded"}
        {typeof m.tool_calls_count === "number" ? ` · ${m.tool_calls_count} tool calls` : ""}
        {notes ? ` · notes ${notes}` : ""}
        {typeof m.new_conclusions_shown === "number"
          ? ` · ${m.new_conclusions_shown} new shown${typeof m.new_conclusions_remaining === "number" && m.new_conclusions_remaining > 0 ? `, ${m.new_conclusions_remaining} left` : ""}`
          : ""}
      </p>
    </>
  );
}

export function TraceInspector({ traces }: { traces: OperatorQueryState<TraceResult> }) {
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState("all");
  const [kind, setKind] = useState("all");
  const [selected, setSelected] = useState<TraceRecord | null>(null);
  const entries = traces.data?.entries ?? [];
  const filtered = filterTraces(entries, query, outcome, kind);
  const agents = summarizeAgentRuns(entries);
  const selectedIsRun = selected !== null && isAgentRun(selected.type);

  return (
    <>
      <Panel title="CALL_TRACES" status={traces.isLoading ? "processing" : traces.data?.available ? "active" : "idle"}>
        <div className="space-y-3">
          <p className="text-[11px] text-text-primary leading-relaxed">
            Dashboard-host source: <span className="text-accent">HONCHO_TRACE_FILE</span>.
            This file does not change with the selected Honcho instance. Inspect SOURCE and WORKSPACE in each record to confirm attribution.
          </p>
          {traces.error ? (
            <p role="alert" className="text-xs text-red-400">Trace request failed. Use RE_RUN above to retry, or check <a href="#/config" className="underline">CONFIG</a> and the dashboard service.</p>
          ) : !traces.data ? (
            <div role="status" aria-label="Loading trace records" className="space-y-2 py-2">
              {[0, 1, 2].map((n) => <div key={n} className="h-7 bg-border motion-safe:animate-pulse" />)}
            </div>
          ) : !traces.data.available ? (
            <div className="space-y-2 py-2 text-xs text-text-primary">
              <p>{traces.data.reason}</p>
              <p className="text-[11px]">Honcho emits traces to a CloudEvents collector. Persist its individual events or compact batches as JSONL and mount that file read-only for this dashboard. Ordinary application logs and reasoning JSONL are different sources.</p>
              <a href="#/config" className="text-accent underline">OPEN_CONFIG</a>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_160px_170px] gap-3">
                <Field label="FIND_TRACE" hint="Search workspace, session, agent, source message ID, or another recorded value.">
                  <TextInput aria-label="Find trace" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Workspace, session, run, or message ID" />
                </Field>
                <Field label="OUTCOME"><Select value={outcome} onChange={setOutcome} options={[
                  { value: "all", label: "ALL_OUTCOMES" }, { value: "success", label: "SUCCESS" }, { value: "error", label: "ERROR" },
                  { value: "cancelled", label: "CANCELLED" }, { value: "unknown", label: "NOT_RECORDED" },
                ]} /></Field>
                <Field label="RECORD_TYPE"><Select value={kind} onChange={setKind} options={[
                  { value: "all", label: "ALL_RECORDS" }, { value: "llm.call.traced", label: "LLM" }, { value: "embedding.call.traced", label: "EMBEDDING" },
                  { value: "agent", label: "AGENT_RUNS" }, { value: "dream.specialist", label: "DREAM" }, { value: "dialectic.completed", label: "DIALECTIC" },
                ]} /></Field>
              </div>
              <p className="text-[10px] text-text-primary" role="status">
                {filtered.length} / {entries.length} records · newest file entries first · read at {traces.data.generated_at} · UTC
              </p>
              {agents.runs > 0 ? (
                <p className="text-[10px] text-text-primary tabular-nums">
                  {agents.runs} agent run{agents.runs === 1 ? "" : "s"} in this window
                  {agents.withBudget > 0
                    ? ` · ${agents.hitIterationLimit} of ${agents.withBudget} hit the iteration limit · ${agents.writeWindowUsed} used the write window · ${agents.notesTouched} changed working notes`
                    : " · budget counters not recorded (Honcho 3.4 adds them)"}
                </p>
              ) : null}
              {traces.data.truncated || traces.data.malformed > 0 || traces.data.skipped > 0 ? (
                <p className="text-[10px] text-text-primary">
                  {traces.data.truncated ? "File exceeds the 2 MiB read window; earlier records and the first partial line are omitted. " : ""}
                  {traces.data.malformed > 0 ? `${traces.data.malformed} incomplete or malformed lines skipped. ` : ""}
                  {traces.data.skipped > 0 ? `${traces.data.skipped} content, unrelated, or unsupported events omitted.` : ""}
                </p>
              ) : null}
              {entries.length === 0 ? (
                <p className="py-4 text-xs text-text-primary">No supported call traces in this file window. The collector must include llm.call.traced or embedding.call.traced CloudEvents (schema v1 or v2). Agent runs come from dream.specialist and dialectic.completed events.</p>
              ) : filtered.length === 0 ? (
                <div className="flex flex-wrap items-center gap-3 py-4">
                  <p className="text-xs text-text-primary">No records match these filters in the loaded window.</p>
                  <Button size="sm" variant="secondary" onClick={() => { setQuery(""); setOutcome("all"); setKind("all"); }}>CLEAR_FILTERS</Button>
                </div>
              ) : (
                <div className="max-h-[440px] overflow-y-auto border border-border divide-y divide-border">
                  {filtered.map((entry, index) => {
                    const run = isAgentRun(entry.type);
                    return (
                      <div key={`${entry.id}:${index}`} className="flex flex-wrap sm:flex-nowrap items-start gap-3 p-3 bg-void/30">
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2 text-[10px]">
                            <Chip tone={run ? "purple" : "muted"}>{TYPE_LABEL[entry.type]}</Chip>
                            <Chip tone={entry.metadata.outcome === "error" ? "danger" : entry.metadata.outcome === "success" ? "accent" : "muted"}>{entry.metadata.outcome ?? "NOT_RECORDED"}</Chip>
                            {entry.metadata.hit_iteration_limit === true ? <Chip tone="warn" icon="warning">ITERATION_LIMIT</Chip> : null}
                            {entry.metadata.write_window_used === true ? <Chip tone="cyan">WRITE_WINDOW</Chip> : null}
                            {run ? null : <span className="text-text-primary break-all">{value(entry, "model")}</span>}
                            <span className="text-text-primary">{duration(entry)}</span>
                          </div>
                          {run ? <AgentRunRow entry={entry} /> : (
                            <>
                              <p className="text-[11px] text-accent break-all">{value(entry, "workspace_name")} / {value(entry, "session_id")}</p>
                              <p className="text-[10px] text-text-primary break-all">{value(entry, "timestamp")} · {value(entry, "call_purpose")}</p>
                              <p className="text-[10px] text-text-primary">Attempt {entry.metadata.attempt ?? "—"} / {entry.metadata.retry_attempts ?? "—"}{entry.metadata.was_fallback ? " · fallback" : ""}</p>
                            </>
                          )}
                        </div>
                        <Button size="sm" variant="secondary" aria-label={`${run ? "Inspect run" : "Inspect trace"} ${entry.id}`} onClick={() => setSelected(entry)}>INSPECT</Button>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-[10px] text-text-primary">Up to 200 records from the last 2 MiB. Filters apply to this window. Prompts, content payloads, tool arguments, and signatures are excluded by the server. Agent runs keep counters and identifiers only. Reference lists show at most 100 items; values at most 512 characters.</p>
            </>
          )}
        </div>
      </Panel>
      <Modal title={selectedIsRun ? "AGENT_RUN_DETAILS" : "TRACE_DETAILS"} open={selected !== null} onClose={() => setSelected(null)} className="max-w-3xl"
        footer={<Button variant="secondary" onClick={() => setSelected(null)}>CLOSE</Button>}>
        {selected ? <div className="max-h-[60vh] overflow-y-auto space-y-4">
          <p className="text-[11px] text-accent break-all">{selected.id} · {selected.type} · schema {selected.schema_version ?? "not supplied"}</p>
          <p className="text-[11px] text-text-primary">
            {selectedIsRun
              ? "Missing values are not recorded, not zero. Honcho 3.4 added the tool-loop budget, write-window, working-notes, and since-last-dream counters; earlier runs omit them. Working notes stay at zero unless DREAM_NOTES_MODE is shadow or on."
              : "Missing values are not recorded, not zero. Older v1 archives may omit execution diagnostics. RETRY_ATTEMPTS is the total allowed attempts, including the initial call. Embedding input tokens are estimates. Source message IDs identify triggering work, not every retrieved message."}
          </p>
          {(selectedIsRun ? AGENT_DETAIL_GROUPS : CALL_DETAIL_GROUPS).map(([title, fields]) => <section key={title} className="space-y-2">
            <h3 className="text-xs text-text-primary">{title}</h3>
            <dl className="border border-border divide-y divide-border">
              {fields.map((field) => <div key={field} className="grid grid-cols-1 sm:grid-cols-[200px_minmax(0,1fr)] gap-1 sm:gap-3 p-2 text-[11px]">
                <dt className="text-text-primary uppercase">{field}</dt>
                <dd className="text-text-primary whitespace-pre-wrap break-all">{value(selected, field)}</dd>
              </div>)}
            </dl>
          </section>)}
        </div> : null}
      </Modal>
    </>
  );
}
