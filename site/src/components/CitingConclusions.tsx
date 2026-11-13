"use client";

import { useState } from "react";
import { Button, Chip } from "@/components/atoms";
import { ConclusionInspector, ReadError } from "@/components/ConclusionInspector";
import { Markdown } from "@/components/Markdown";
import { getCitingConclusions } from "@/lib/honcho/citations";
import { SCOPE_OBSERVER_PREFIX } from "@/lib/honcho/scopeCopies";
import { useActiveWorkspace } from "@/lib/honcho/config";
import { getSdk } from "@/lib/honcho/sdk";
import { useHonchoCapabilities } from "@/lib/honcho/useCapabilities";
import { useHonchoQuery } from "@/lib/honcho/useQuery";
import { useListTotal } from "@/lib/honcho/useListTotal";

/**
 * Honcho 3.5+: the conclusions that cite a message. The button shows only when
 * the server records citations; the list reads nothing until it is opened, so
 * a page of message lines costs no requests.
 */
export function CitedByButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { messageCitations } = useHonchoCapabilities();
  const { workspaceId } = useActiveWorkspace();
  if (messageCitations !== "available" || !workspaceId) return null;
  return <Button size="sm" variant="ghost" icon="book" onClick={onToggle} aria-expanded={open}>
    {open ? "HIDE_CITED_BY" : "CITED_BY"}
  </Button>;
}

export function CitingConclusionsPanel({ messageId }: { messageId: string }) {
  const { workspaceId } = useActiveWorkspace();
  return workspaceId ? <CitingConclusions workspaceId={workspaceId} messageId={messageId} /> : null;
}

function CitingConclusions({ workspaceId, messageId }: { workspaceId: string; messageId: string }) {
  const { messageCitations } = useHonchoCapabilities();
  const listTotal = useListTotal();
  const [page, setPage] = useState(1);
  const [inspected, setInspected] = useState<string | null>(null);
  const result = useHonchoQuery(`citations/${workspaceId}/${messageId}/${page}`,
    (o) => getCitingConclusions(getSdk(o, workspaceId), messageId, page, messageCitations));
  const data = result.data;
  // A message line toggles on any click inside it, and React bubbles clicks
  // from the inspector's portal through this tree, so stop them here.
  return <section
    aria-label="Conclusions citing this message"
    onClick={(event) => event.stopPropagation()}
    className="mt-1.5 max-w-[140ch] border border-border p-2 space-y-2 text-[11px] text-text-primary cursor-auto"
  >
    {result.isLoading ? <p role="status">Loading conclusions…</p>
      : result.error ? <ReadError error={result.error} retry={result.refetch} />
      : data && data.total > 0 ? <>
        <p>
          {listTotal.format(data.total)} {data.total === 1 ? "conclusion cites" : "conclusions cite"} this message.
          {data.items.some((item) => item.observer_id.startsWith(SCOPE_OBSERVER_PREFIX))
            ? " Scope copies keep their citations, so a scope can repeat a conclusion."
            : null}
        </p>
        <ul className="divide-y divide-border">
          {data.items.map((item) => <li key={item.id} className="py-1.5 space-y-1">
            <p className="break-words leading-relaxed"><Markdown inline text={item.content} /></p>
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-text-muted">
              <Chip tone="purple">{item.level ?? "explicit"}</Chip>
              <span className="break-all">{item.observer_id} → {item.observed_id}</span>
              <Button size="sm" variant="ghost" onClick={() => setInspected(item.id)} aria-label={`Inspect conclusion ${item.id}`}>INSPECT</Button>
            </div>
          </li>)}
        </ul>
        {data.pages > 1 ? <div className="flex items-center justify-between gap-2">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>PREV</Button>
          <span className="text-text-muted">page {page} / {listTotal.pages(page, data.pages, data.total)}</span>
          <Button size="sm" variant="ghost" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>NEXT</Button>
        </div> : null}
      </>
      : <p>No conclusions cite this message. Honcho records citations only for explicit conclusions derived on 3.5 or later.</p>}
    {inspected ? <ConclusionInspector key={inspected} id={inspected} workspaceId={workspaceId} onClose={() => setInspected(null)} /> : null}
  </section>;
}
