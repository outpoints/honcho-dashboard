"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/Panel";
import { Markdown } from "@/components/Markdown";
import { Button, Chip, Field } from "@/components/atoms";
import { Select } from "@/components/Select";
import { ServerUid } from "@/components/ServerUid";
import { Icon } from "@/components/icons";
import { honcho } from "@/lib/honcho/client";
import { formatApiError, useHonchoQuery } from "@/lib/honcho/useQuery";
import { useListTotal } from "@/lib/honcho/useListTotal";
import type { ApiPeer } from "@/lib/honcho/types";

interface PeerRef {
  workspaceId: string;
  peerId: string;
}

const SEP = "::";
const keyOf = (peer: Pick<ApiPeer, "workspace_id" | "id">) => `${peer.workspace_id}${SEP}${peer.id}`;
function parseKey(value: string): PeerRef | null {
  const at = value.indexOf(SEP);
  return at > 0 ? { workspaceId: value.slice(0, at), peerId: value.slice(at + SEP.length) } : null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[10px] text-text-muted uppercase tracking-wider">{title}</h3>
      {children}
    </section>
  );
}

function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-1.5" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="h-3 bg-border/50 animate-pulse" style={{ width: `${90 - i * 15}%` }} />)}
    </div>
  );
}

function ErrorLine({ error }: { error: Error }) {
  return <p role="alert" className="text-[11px] text-red-400 break-words">{formatApiError(error)}</p>;
}

/** One side of the comparison. Reads only: card, representation, sessions, conclusion count. */
function PeerColumn({ peer, uid }: { peer: PeerRef; uid?: string }) {
  const base = `compare/${peer.workspaceId}/${peer.peerId}`;
  const card = useHonchoQuery(`${base}/card`, (o) => honcho.peers.card(o, peer.workspaceId, peer.peerId));
  const representation = useHonchoQuery(`${base}/representation`, (o) => honcho.peers.representation(o, peer.workspaceId, peer.peerId));
  const sessions = useHonchoQuery(`${base}/sessions`, (o) => honcho.peers.sessions(o, peer.workspaceId, peer.peerId, { size: 1 }));
  const about = useHonchoQuery(`${base}/about`, (o) =>
    honcho.conclusions.list(o, peer.workspaceId, { size: 1, filters: { observed_id: peer.peerId } }));
  const listTotal = useListTotal();

  return (
    <div className="min-w-0 space-y-3 border border-border bg-void/30 p-3">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-text-primary break-all">{peer.peerId}</span>
          <span className="text-[10px] text-text-muted">@{peer.workspaceId}</span>
        </div>
        <ServerUid uid={uid} />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-text-muted tabular-nums">
          <span className="flex items-center gap-1">
            <Icon name="git-branch" size={10} />
            {sessions.error ? "—" : sessions.data ? listTotal.format(sessions.data.total) : "…"} sessions
          </span>
          <span className="flex items-center gap-1">
            <Icon name="brain" size={10} />
            {about.error ? "—" : about.data ? listTotal.format(about.data.total) : "…"} conclusions about
          </span>
        </div>
      </div>

      <Section title="PEER_CARD">
        {card.error ? <ErrorLine error={card.error} /> : card.data === undefined ? <Loading /> : card.data && card.data.length ? (
          <ul className="space-y-1 text-[11px] text-text-primary">
            {card.data.map((line, i) => <li key={i} className="border-l border-border-light pl-2 break-words">{line}</li>)}
          </ul>
        ) : <p className="text-[11px] text-text-muted">No peer card yet.</p>}
      </Section>

      <Section title="REPRESENTATION">
        {representation.error ? <ErrorLine error={representation.error} /> : representation.data === undefined ? <Loading rows={5} /> : representation.data.trim() ? (
          <div className="max-h-72 overflow-y-auto pr-1">
            <Markdown text={representation.data} className="text-[12px] text-text-primary" />
          </div>
        ) : <p className="text-[11px] text-text-muted">Honcho has not concluded anything about this peer yet.</p>}
      </Section>
    </div>
  );
}

/** What each peer knows about the other: Honcho's local representations. */
function Perspective({ from, to }: { from: PeerRef; to: PeerRef }) {
  const view = useHonchoQuery(`compare/${from.workspaceId}/${from.peerId}/about/${to.peerId}`, (o) =>
    honcho.peers.representation(o, from.workspaceId, from.peerId, { target: to.peerId }));
  return (
    <div className="min-w-0 border border-border bg-void/30 p-3 space-y-1.5">
      <div className="text-[10px] uppercase tracking-wider text-text-muted">
        <span className="font-mono normal-case text-accent">{from.peerId}</span> about{" "}
        <span className="font-mono normal-case text-text-primary">{to.peerId}</span>
      </div>
      {view.error ? <ErrorLine error={view.error} /> : view.data === undefined ? <Loading /> : view.data.trim() ? (
        <div className="max-h-56 overflow-y-auto pr-1">
          <Markdown text={view.data} className="text-[12px] text-text-primary" />
        </div>
      ) : (
        <p className="text-[11px] text-text-muted">
          No local representation. Honcho builds one only when {from.peerId} observes {to.peerId} in a shared session.
        </p>
      )}
    </div>
  );
}

function SharedSessions({ a, b }: { a: PeerRef; b: PeerRef }) {
  // Both lists are read in full pages of 100; a peer in more sessions shows a capped intersection.
  const list = (p: PeerRef) => (o: Parameters<typeof honcho.peers.sessions>[0]) =>
    honcho.peers.sessions(o, p.workspaceId, p.peerId, { size: 100, reverse: true });
  const left = useHonchoQuery(`compare/${a.workspaceId}/${a.peerId}/sessions100`, list(a));
  const right = useHonchoQuery(`compare/${b.workspaceId}/${b.peerId}/sessions100`, list(b));
  const shared = useMemo(() => {
    if (!left.data || !right.data) return null;
    const ids = new Set(right.data.items.map((s) => s.id));
    return left.data.items.filter((s) => ids.has(s.id));
  }, [left.data, right.data]);
  const capped = (left.data?.total ?? 0) > 100 || (right.data?.total ?? 0) > 100;
  const error = left.error ?? right.error;
  return (
    <Section title={`SHARED_SESSIONS${shared ? ` (${shared.length}${capped ? "+" : ""})` : ""}`}>
      {error ? <ErrorLine error={error} /> : shared === null ? <Loading rows={1} /> : shared.length === 0 ? (
        <p className="text-[11px] text-text-muted">These peers have not been in a session together.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {shared.slice(0, 20).map((session) => (
            <span key={session.id} className="px-2 py-1 border border-border bg-void/40 text-[11px] font-mono text-text-primary break-all">
              {session.id}
            </span>
          ))}
          {shared.length > 20 ? <span className="text-[10px] text-text-muted self-center">+{shared.length - 20} more</span> : null}
        </div>
      )}
      {capped ? <p className="text-[10px] text-text-muted">Compared within each peer&apos;s 100 most recent sessions.</p> : null}
    </Section>
  );
}

export function PeerCompare({ peers, initial, onClose }: { peers: ApiPeer[]; initial?: string; onClose: () => void }) {
  const options = useMemo(() => {
    const mixed = new Set(peers.map((p) => p.workspace_id)).size > 1;
    return peers.map((peer) => ({ value: keyOf(peer), label: mixed ? `${peer.workspace_id} / ${peer.id}` : peer.id }));
  }, [peers]);
  const [left, setLeft] = useState(initial ?? options[0]?.value ?? "");
  const [right, setRight] = useState(() => options.find((o) => o.value !== (initial ?? options[0]?.value))?.value ?? "");
  const a = parseKey(left);
  const b = parseKey(right);
  const uid = (ref: PeerRef | null) => peers.find((p) => ref && p.workspace_id === ref.workspaceId && p.id === ref.peerId)?.uid;
  const sameWorkspace = a && b && a.workspaceId === b.workspaceId;
  const ready = a && b && left !== right;

  return (
    <Panel title="PEER_COMPARE" actions={<Button size="sm" variant="ghost" icon="x" onClick={onClose}>CLOSE</Button>}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="PEER_A"><Select value={left} onChange={setLeft} options={options} placeholder="select a peer…" /></Field>
          <Field label="PEER_B"><Select value={right} onChange={setRight} options={options.filter((o) => o.value !== left)} placeholder="select a peer…" /></Field>
        </div>
        {options.length < 2 ? (
          <p className="text-[11px] text-text-muted">Comparing needs at least two peers in view. Change the workspace filter or create another peer.</p>
        ) : !ready ? (
          <p className="text-[11px] text-text-muted">Pick two different peers.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
              <PeerColumn key={left} peer={a} uid={uid(a)} />
              <PeerColumn key={right} peer={b} uid={uid(b)} />
            </div>
            {sameWorkspace ? (
              <>
                <SharedSessions key={`${left}|${right}`} a={a} b={b} />
                <Section title="PERSPECTIVES">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
                    <Perspective key={`${left}>${right}`} from={a} to={b} />
                    <Perspective key={`${right}>${left}`} from={b} to={a} />
                  </div>
                </Section>
              </>
            ) : (
              <div className="flex items-center gap-2 text-[11px] text-text-muted">
                <Chip tone="muted">CROSS_WORKSPACE</Chip>
                Shared sessions and perspectives exist only within one workspace.
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
