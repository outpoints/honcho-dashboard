"use client";

import { useState } from "react";
import { Button, Chip } from "@/components/atoms";
import { Markdown } from "@/components/Markdown";
import { Modal } from "@/components/Modal";
import { Panel } from "@/components/Panel";
import { HonchoFeatureNotice } from "@/components/HonchoFeatureNotice";
import { useHonchoCapabilities } from "@/lib/honcho/useCapabilities";
import { useActiveWorkspace } from "@/lib/honcho/config";
import { formatApiError, useHonchoQuery } from "@/lib/honcho/useQuery";
import { getSdk } from "@/lib/honcho/sdk";
import { getConclusion, getDerived, getPremises } from "@/lib/honcho/provenance";
import { citedMessageIds, noCitationReason } from "@/lib/honcho/citations";
import { honcho } from "@/lib/honcho/client";
import type { ApiConclusion } from "@/lib/honcho/types";
import { MessageBody } from "@/components/MessageLine";

export function ConclusionInspector({ id, onClose, workspaceId: workspaceOverride }: {
  id: string;
  onClose: () => void;
  /** The conclusion's workspace when it differs from the active one (Peers across workspaces). */
  workspaceId?: string;
}) {
  const active = useActiveWorkspace();
  const workspaceId = workspaceOverride ?? active.workspaceId;
  const { provenance, messageCitations } = useHonchoCapabilities();
  const [history, setHistory] = useState([id]);
  const [sourcePage, setSourcePage] = useState(1);
  const [derivedPage, setDerivedPage] = useState(1);
  const current = history.at(-1)!;
  const enabled = provenance === "available" && !!workspaceId;
  const detail = useHonchoQuery(enabled ? `provenance/${workspaceId}/${current}` : null,
    (o) => getConclusion(getSdk(o, workspaceId!), current, provenance));
  const sources = useHonchoQuery(enabled && detail.data ? `provenance/${workspaceId}/${current}/sources/${sourcePage}` : null,
    (o) => getPremises(getSdk(o, workspaceId!), detail.data?.source_ids ?? [], sourcePage, provenance));
  const derived = useHonchoQuery(enabled && detail.data ? `provenance/${workspaceId}/${current}/derived/${derivedPage}` : null,
    (o) => getDerived(getSdk(o, workspaceId!), current, derivedPage, provenance));
  const open = (next: string) => {
    setHistory((old) => {
      const index = old.indexOf(next);
      return index >= 0 ? old.slice(0, index + 1) : [...old.slice(-49), next];
    });
    setSourcePage(1);
    setDerivedPage(1);
  };
  return (
    <Modal title="CONCLUSION_PROVENANCE" open onClose={onClose} className="max-w-3xl"
      footer={<Button variant="secondary" onClick={onClose}>CLOSE</Button>}>
      <div className="max-h-[65vh] overflow-y-auto space-y-3 pr-1" role="region" aria-label="Conclusion provenance">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" disabled={history.length < 2} onClick={() => open(history[history.length - 2])}>BACK</Button>
          <span className="text-[11px] text-accent break-all min-w-0">{current}</span>
        </div>
        <HonchoFeatureNotice state={provenance} minimum="3.2" feature="Conclusion provenance" />
        {detail.isLoading ? <p className="text-xs text-text-primary" role="status">Loading conclusion…</p>
          : detail.error ? <ReadError error={detail.error} retry={detail.refetch} />
          : detail.data ? <>
            <Panel title="CONCLUSION">
              <div className="flex flex-wrap gap-2 mb-2">
                <Chip tone="purple">{detail.data.level ?? "explicit"}</Chip>
                <Chip tone="accent">{detail.data.times_derived ?? 1} derivations</Chip>
              </div>
              <Markdown text={detail.data.content} className="text-xs text-text-primary" />
              <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-text-primary">
                <div><dt className="text-text-muted">OBSERVER → OBSERVED</dt><dd className="break-all">{detail.data.observer_id} → {detail.data.observed_id}</dd></div>
                <div><dt className="text-text-muted">CREATED</dt><dd>{new Date(detail.data.created_at).toLocaleString()}</dd></div>
              </dl>
            </Panel>
            {messageCitations === "available" && workspaceId ? (
              <Panel title="CITED_MESSAGES">
                <CitedMessages conclusion={detail.data} workspaceId={workspaceId} />
              </Panel>
            ) : null}
            <Panel title="PARENT_CONCLUSIONS">
              <p className="text-[11px] text-text-primary mb-3">Premises recorded for this conclusion. These IDs refer to conclusions, not source messages.</p>
              {sources.isLoading ? <p className="text-xs text-text-primary">Loading premises…</p>
                : sources.error ? <ReadError error={sources.error} retry={sources.refetch} />
                : sources.data?.items.length ? <div className="divide-y divide-border">{sources.data.items.map(({ id: sourceId, conclusion }) =>
                  conclusion ? <ConclusionLink key={sourceId} conclusion={conclusion} onOpen={open} />
                    : <p key={sourceId} className="py-2 text-[11px] text-text-primary break-all">{sourceId} · unavailable or deleted</p>)}</div>
                : <p className="text-xs text-text-primary">No parent conclusions recorded{detail.data.level === "explicit" ? ` — explicit facts are extracted directly from messages${messageCitations === "available" ? ", listed above" : ""}` : ""}.</p>}
              <Pagination page={sourcePage} pages={sources.data?.pages ?? 1} onChange={setSourcePage} />
            </Panel>
            <Panel title="DERIVED_CONCLUSIONS">
              <p className="text-[11px] text-text-primary mb-3">Conclusions across this workspace that cite this conclusion as a premise.</p>
              {derived.isLoading ? <p className="text-xs text-text-primary">Loading derived conclusions…</p>
                : derived.error ? <ReadError error={derived.error} retry={derived.refetch} />
                : derived.data?.items.length ? <div className="divide-y divide-border">{derived.data.items.map((item) => <ConclusionLink key={item.id} conclusion={item} onOpen={open} />)}</div>
                : <p className="text-xs text-text-primary">No derived conclusions found.</p>}
              <Pagination page={derivedPage} pages={derived.data?.pages ?? 1} onChange={setDerivedPage} />
            </Panel>
          </> : null}
      </div>
    </Modal>
  );
}

/** The messages a conclusion cites, read without creating anything. */
function CitedMessages({ conclusion, workspaceId }: { conclusion: ApiConclusion; workspaceId: string }) {
  const ids = citedMessageIds(conclusion);
  if (!ids.length) return <p className="text-xs text-text-primary">{noCitationReason(conclusion)}</p>;
  if (!conclusion.session_id) {
    return <div className="space-y-1 text-[11px] text-text-primary">
      <p>This conclusion has no session recorded, so its cited messages can&apos;t be read.</p>
      {ids.map((id) => <p key={id} className="text-text-muted break-all">#{id}</p>)}
    </div>;
  }
  return <>
    <p className="text-[11px] text-text-primary mb-3">Messages the deriver cited when it wrote this conclusion, in citation order.</p>
    <ol className="space-y-2">
      {ids.map((id, index) => <CitedMessage key={id} index={index + 1} workspaceId={workspaceId} sessionId={conclusion.session_id!} messageId={id} />)}
    </ol>
  </>;
}

/** Long messages clamp behind SHOW_MORE, as on message lines, so the modal never nests a scroll box. */
function CitedMessage({ index, workspaceId, sessionId, messageId }: {
  index: number;
  workspaceId: string;
  sessionId: string;
  messageId: string;
}) {
  const result = useHonchoQuery(`citation/message/${workspaceId}/${sessionId}/${messageId}`,
    (o) => honcho.messages.get(o, workspaceId, sessionId, messageId));
  const message = result.data;
  return <li className="border border-border p-2 space-y-1.5">
    <div className="flex flex-wrap items-center gap-2 text-[10px] text-text-muted">
      <span className="tabular-nums">{index}.</span>
      {/* No kind icon: this panel does not know whether the peer is a user or an agent. */}
      {message ? <Chip tone="cyan">{message.peer_id}</Chip> : null}
      {message ? <time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString()}</time> : null}
      <span className="break-all">{sessionId} · #{messageId}</span>
    </div>
    {result.isLoading ? <p className="text-xs text-text-primary" role="status">Loading message…</p>
      : result.error ? <ReadError resource="message" error={result.error} retry={result.refetch} />
      : message ? <MessageBody content={message.content || "This message has no text."} raw={false} /> : null}
  </li>;
}

function ConclusionLink({ conclusion, onOpen }: { conclusion: ApiConclusion; onOpen: (id: string) => void }) {
  return <div className="py-2 space-y-2">
    <p className="text-xs text-text-primary break-words leading-relaxed"><Markdown inline text={conclusion.content} /></p>
    <div className="flex flex-wrap items-center gap-2">
      <Chip tone="purple">{conclusion.level ?? "explicit"}</Chip>
      <Button size="sm" variant="ghost" onClick={() => onOpen(conclusion.id)} aria-label={`Inspect conclusion ${conclusion.id}`}>INSPECT</Button>
      <span className="text-[10px] text-text-muted break-all">{conclusion.id}</span>
    </div>
  </div>;
}

function Pagination({ page, pages, onChange }: { page: number; pages: number; onChange: (page: number) => void }) {
  return pages > 1 ? <div className="flex items-center justify-between gap-2 pt-3 text-[11px] text-text-primary">
    <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>PREV</Button>
    <span>page {page} / {pages}</span>
    <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onChange(page + 1)}>NEXT</Button>
  </div> : null;
}

export function ReadError({ error, retry, resource = "conclusion" }: { error: unknown; retry: () => void; resource?: "conclusion" | "message" }) {
  const status = (error as { status?: number })?.status;
  const hint = status === 401 || status === 403 ? "Access denied. Check the key in CONFIG."
    : status === 404 ? `This ${resource} is unavailable or has been deleted.`
    : "Check the connection in CONFIG, then retry.";
  return <div className="space-y-2" role="alert">
    <p className="text-[11px] text-red-400 break-words">{formatApiError(error)}</p>
    <p className="text-[11px] text-text-primary">{hint}</p>
    <Button size="sm" variant="ghost" onClick={retry}>RETRY</Button>
  </div>;
}
