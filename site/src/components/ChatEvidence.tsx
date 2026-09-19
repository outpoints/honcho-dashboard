"use client";

import { useState } from "react";
import type { Evidence, EvidenceMessageRef } from "@honcho-ai/sdk";
import { Button, Chip } from "@/components/atoms";
import { ConclusionInspector, ReadError } from "@/components/ConclusionInspector";
import { useActiveWorkspace } from "@/lib/honcho/config";
import { useHonchoQuery } from "@/lib/honcho/useQuery";
import { honcho } from "@/lib/honcho/client";

export function ChatEvidence({ evidence }: { evidence: Evidence | null }) {
  const [open, setOpen] = useState(false);
  const [inspected, setInspected] = useState<string | null>(null);
  return <div className="mt-3 pt-3 border-t border-border space-y-3">
    <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
      {open ? "HIDE_EVIDENCE" : "SHOW_EVIDENCE"}
      {evidence ? ` · ${evidence.conclusions.length + evidence.messages.length} records` : ""}
    </Button>
    {open ? <div className="space-y-3 text-[11px] text-text-primary">
      <p>Records Honcho accessed while answering. Access does not prove the answer relied on a record. Tool calls omit failed calls and results.</p>
      {!evidence ? <p>No evidence was returned by the server for this answer.</p> : <>
        <section aria-label="Evidence conclusions" className="space-y-2">
          <h3 className="text-[10px] tracking-wider">CONCLUSIONS · {evidence.conclusions.length}</h3>
          {evidence.conclusions.length ? evidence.conclusions.map((item) => <div key={item.id} className="border border-border p-2 space-y-2">
            <p className="whitespace-pre-wrap break-words leading-relaxed">{item.content}</p>
            <div className="flex flex-wrap items-center gap-2"><Chip tone="purple">{item.level}</Chip>
              <Button size="sm" variant="ghost" onClick={() => setInspected(item.id)}>PROVENANCE</Button>
              <span className="break-all text-text-muted">{item.id}</span>
            </div>
          </div>) : <p>No conclusions were recorded.</p>}
        </section>
        <section aria-label="Evidence messages" className="space-y-2">
          <h3 className="text-[10px] tracking-wider">MESSAGES · {evidence.messages.length}</h3>
          {evidence.messages.length ? evidence.messages.map((item) => <EvidenceMessage key={`${item.session_id}/${item.id}`} message={item} />) : <p>No messages were recorded.</p>}
        </section>
        <section aria-label="Evidence tools" className="space-y-2">
          <h3 className="text-[10px] tracking-wider">TOOL_CALLS · {evidence.tool_calls.length}</h3>
          {evidence.tool_calls.length ? evidence.tool_calls.map((tool, index) => <details key={index} className="border border-border p-2">
            <summary className="cursor-pointer text-accent break-all">{tool.tool_name}</summary>
            <pre className="mt-2 whitespace-pre-wrap break-all max-h-48 overflow-auto">{JSON.stringify(tool.tool_input, null, 2)}</pre>
          </details>) : <p>No successful tool calls were recorded.</p>}
        </section>
        {evidence.reasoning_trace_id ? <p className="break-all text-text-muted">TRACE_ID · {evidence.reasoning_trace_id}</p> : null}
      </>}
    </div> : null}
    {inspected ? <ConclusionInspector key={inspected} id={inspected} onClose={() => setInspected(null)} /> : null}
  </div>;
}

function EvidenceMessage({ message }: { message: EvidenceMessageRef }) {
  const { workspaceId } = useActiveWorkspace();
  const [open, setOpen] = useState(false);
  const result = useHonchoQuery(open && workspaceId ? `evidence/message/${workspaceId}/${message.session_id}/${message.id}` : null,
    (o) => honcho.messages.get(o, workspaceId!, message.session_id, message.id));
  return <div className="border border-border p-2 space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <Chip tone="cyan">{message.peer_id}</Chip>
      <span className="break-all">{message.session_id}</span>
      <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "HIDE_MESSAGE" : "READ_MESSAGE"}</Button>
    </div>
    <p className="text-[10px] text-text-muted break-all">{message.id} · {new Date(message.created_at).toLocaleString()}</p>
    {open ? result.isLoading ? <p role="status">Loading message…</p> : result.error ? <ReadError resource="message" error={result.error} retry={result.refetch} />
      : <p className="whitespace-pre-wrap break-words leading-relaxed">{result.data?.content || "This message has no text."}</p> : null}
  </div>;
}
