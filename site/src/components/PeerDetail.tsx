"use client";

import { useMemo, useState } from "react";
import { Button, Checkbox, Chip, Field } from "@/components/atoms";
import { Icon } from "@/components/icons";
import { Markdown } from "@/components/Markdown";
import { Modal } from "@/components/Modal";
import { PeerConclusions } from "@/components/PeerConclusions";
import { ServerUid } from "@/components/ServerUid";
import { useConfirm } from "@/components/confirm";
import { useToast } from "@/components/toast";
import { honcho as raw } from "@/lib/honcho/client";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { getSdk } from "@/lib/honcho/sdk";
import { formatApiError, invalidate, useHonchoQuery } from "@/lib/honcho/useQuery";
import type { ApiPeer } from "@/lib/honcho/types";
import { cardWarnings, readsInline, structureCard, type CardGroup, type StructuredCard } from "@/lib/peerCard";
import { useWriteActions } from "@/lib/writeActions";
import { cn } from "@/lib/utils";

export type PeerType = "all" | "user" | "agent";
export interface DecoratedPeer extends ApiPeer {
  derivedType: PeerType;
}
/** Per-peer numbers from the operator database, when it is configured. */
export interface PeerSummary {
  workspace_id: string;
  peer_id: string;
  conclusions: number;
  last_message_at: string | null;
}

export function classifyPeer(p: ApiPeer): PeerType {
  const cfg = (p.configuration ?? {}) as { observe_me?: boolean; observeMe?: boolean };
  const observeMe = cfg.observe_me ?? cfg.observeMe;
  if (observeMe === true) return "user";
  if (observeMe === false) return "agent";
  return "all";
}

export function PeerTypeChip({ type }: { type: PeerType }) {
  if (type === "user") return <Chip tone="accent">USER</Chip>;
  if (type === "agent") return <Chip tone="purple">AGENT</Chip>;
  return <Chip tone="muted">PEER</Chip>;
}

export function PeerAvatar({ type, active = false }: { type: PeerType; active?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "w-9 h-9 border flex items-center justify-center shrink-0",
        active ? "border-accent/50 text-accent" : "border-border-light text-text-muted",
      )}
    >
      <Icon name={type === "agent" ? "bot" : "user"} size={14} />
    </span>
  );
}

function observeMeOf(peer: ApiPeer): boolean | null {
  const cfg = (peer.configuration ?? {}) as { observe_me?: boolean; observeMe?: boolean };
  return cfg.observe_me ?? cfg.observeMe ?? null;
}

function metadataPreview(meta: Record<string, unknown> | undefined): string | null {
  if (!meta || Object.keys(meta).length === 0) return null;
  const text = JSON.stringify(meta);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

interface PeerOverview {
  sessions?: number;
  messages?: number | null;
  card?: string[] | null;
  cardLoading: boolean;
  cardError?: unknown;
  refetchCard: () => void;
}

/** Sessions and card from the Honcho API; the message count only from the operator database. */
function usePeerOverview(peer: ApiPeer): PeerOverview {
  const base = `peers/${peer.workspace_id}/${peer.id}`;
  const sessions = useHonchoQuery(`${base}/sessions-total`, (o) =>
    raw.peers.sessions(o, peer.workspace_id, peer.id, { size: 1 }).then((p) => p.total));
  const card = useHonchoQuery(`${base}/card`, (o) => raw.peers.card(o, peer.workspace_id, peer.id));
  const messages = useHonchoQuery(`operator/peer_detail/${peer.workspace_id}/${peer.id}`, async () => {
    const url = `/api/operator/db?view=peer_detail&limit=1&workspace_id=${encodeURIComponent(peer.workspace_id)}&peer_id=${encodeURIComponent(peer.id)}`;
    const body = (await fetch(url, { cache: "no-store" }).then((r) => r.json())) as { available?: boolean; messages?: number };
    return body.available ? body.messages ?? null : null;
  });
  return {
    sessions: sessions.data,
    messages: messages.data,
    card: card.data,
    cardLoading: card.data === undefined && !card.error,
    cardError: card.error,
    refetchCard: card.refetch,
  };
}

function PeerActions({ peer, overview, onEdit }: { peer: ApiPeer; overview: PeerOverview; onEdit?: () => void }) {
  const { setWorkspaceId } = useActiveWorkspace();
  const go = (route: string) => {
    setWorkspaceId(peer.workspace_id);
    window.location.hash = `#/${route}?peer=${encodeURIComponent(peer.id)}`;
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button variant="outline" size="sm" icon="git-branch" onClick={() => go("sessions")}>
        SESSIONS{overview.sessions !== undefined ? <>{" "}<span className="text-text-muted ml-1 tabular-nums">{overview.sessions.toLocaleString()}</span></> : null}
      </Button>
      <Button variant="outline" size="sm" icon="message-square" onClick={() => go("messages")}>
        MESSAGES{overview.messages != null ? <>{" "}<span className="text-text-muted ml-1 tabular-nums">{overview.messages.toLocaleString()}</span></> : null}
      </Button>
      <Button variant="outline" size="sm" icon="file-search" onClick={() => go("context")}>CONTEXT</Button>
      <Button variant="outline" size="sm" icon="bot" onClick={() => go("chat")}>CHAT</Button>
      {onEdit ? <Button variant="ghost" size="sm" icon="settings" onClick={onEdit}>EDIT_PEER</Button> : null}
    </div>
  );
}

function Value({ text }: { text: string }) {
  return <Markdown inline text={text} className="min-w-0 break-words" />;
}

/**
 * Every card group shares one grid: key and value columns sized once for the
 * whole card, so rows line up across both pairs and from group to group.
 * Two key/value pairs per row in a wide container, one in a narrow one.
 */
const SPEC_GRID =
  "grid gap-x-4 text-xs leading-5 " +
  "grid-cols-[fit-content(7.5rem)_minmax(0,1fr)] " +
  "@xl:grid-cols-[fit-content(12rem)_minmax(0,1fr)] " +
  "@5xl:grid-cols-[fit-content(12rem)_minmax(0,1fr)_fit-content(12rem)_minmax(0,1fr)]";
// Rows within a group share this rhythm; groups get more space above than below.
const SPEC_ROWS = "col-span-full grid grid-cols-subgrid gap-y-1.5";
// The first pair in a two-pair row keeps clear of the second pair's key.
const FIRST_PAIR = "@5xl:[&>*:last-child]:pr-10";

function GroupHead({ label, count, hint }: { label: string; count: number; hint?: string }) {
  return (
    <h4 className="col-span-full mt-5 first:mt-0 mb-1.5 flex flex-wrap items-baseline gap-x-2 text-[10px] uppercase tracking-wider text-text-muted font-normal">
      {label}
      <span className="tabular-nums">{count}</span>
      {hint ? <span className="normal-case tracking-normal">· {hint}</span> : null}
    </h4>
  );
}

function PairValue({ values }: { values: string[] }) {
  if (readsInline(values)) {
    return (
      <>
        {values.map((v, j) => (
          <span key={j}>
            {j > 0 ? <span className="text-text-muted" aria-hidden> · </span> : null}
            <Value text={v} />
          </span>
        ))}
      </>
    );
  }
  if (values.length === 1) return <Value text={values[0]} />;
  return <ul>{values.map((v, j) => <li key={j}><Value text={v} /></li>)}</ul>;
}

function PairRows({ groups }: { groups: CardGroup[] }) {
  return (
    <dl className={SPEC_ROWS}>
      {groups.map((g, i) => (
        <div key={`${g.key ?? "statement"}-${i}`} className={cn("contents", i % 2 === 0 && FIRST_PAIR)}>
          {g.key === null ? (
            // A plain statement ("Prefers tea") has no key; it takes the whole pair.
            <dd className="col-span-2 min-w-0 text-text-primary"><PairValue values={g.values} /></dd>
          ) : (
            <>
              <dt className="text-text-muted break-words">{g.key}</dt>
              <dd className="min-w-0 text-text-primary"><PairValue values={g.values} /></dd>
            </>
          )}
        </div>
      ))}
    </dl>
  );
}

/** Sentences (instructions, unprefixed lines) in the same grid, the marker in the key column. */
function LineRows({ lines, numbered }: { lines: string[]; numbered: boolean }) {
  const List = numbered ? "ol" : "ul";
  return (
    <List className={SPEC_ROWS}>
      {lines.map((line, i) => (
        <li key={i} className={cn("contents", i % 2 === 0 && FIRST_PAIR)}>
          <span className="text-text-muted tabular-nums text-right" aria-hidden>{numbered ? i + 1 : "•"}</span>
          <span className="min-w-0 text-text-primary"><Value text={line} /></span>
        </li>
      ))}
    </List>
  );
}

/** Name and kind lead; the name is skipped when it only repeats the peer id. */
function Headline({ peerId, card }: { peerId: string; card: StructuredCard }) {
  const name = card.identity.find((g) => g.key?.toLowerCase() === "name");
  const kinds = card.identity.find((g) => g.key?.toLowerCase() === "kind");
  const showName = !!name && name.values.some((v) => v.toLowerCase() !== peerId.toLowerCase());
  if (!showName && !kinds) return null;
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-4">
      {showName ? <span className="text-sm text-text-primary">{name!.values.join(" / ")}</span> : null}
      {kinds ? (
        <span className={cn(showName ? "text-xs text-text-muted" : "text-[13px] text-text-primary")}>
          {kinds.values.map((k, i) => (
            <span key={i}>{i > 0 ? <span className="text-text-muted" aria-hidden> · </span> : null}<Value text={k} /></span>
          ))}
        </span>
      ) : null}
    </p>
  );
}

const count = (groups: CardGroup[]) => groups.reduce((n, g) => n + g.values.length, 0);

/**
 * The peer card as Honcho structures it: identity on one line, attributes and
 * relationships as key/value rows, standing instructions as a numbered list.
 * Lines without Honcho's prefixes are shown as written, never dropped.
 */
function PeerProfile({ peer, overview, canWrite }: { peer: ApiPeer; overview: PeerOverview; canWrite: boolean }) {
  const apiOpts = useActiveHonchoOptions();
  const confirm = useConfirm();
  const { push } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const lines = useMemo(() => overview.card ?? [], [overview.card]);
  const card = useMemo(() => structureCard(lines), [lines]);
  const draftLines = draft.split("\n");
  const warnings = editing ? cardWarnings(draftLines) : [];
  const structured = card.total - card.unstructured.length;
  // Name and kind lead the card; any other identity keys join the grid.
  const identityRest = card.identity.filter((g) => !["name", "kind"].includes(g.key?.toLowerCase() ?? ""));

  const save = async () => {
    if (!apiOpts) return;
    const next = draftLines.map((l) => l.trim()).filter(Boolean);
    const ok = await confirm({
      title: "SAVE_PEER_CARD",
      confirmLabel: "SAVE",
      body: (
        <>
          Overwrite the peer card for <span className="text-accent font-mono">{peer.id}</span> on the live instance
          ({next.length} line{next.length === 1 ? "" : "s"})?
        </>
      ),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await (await getSdk(apiOpts, peer.workspace_id).peer(peer.id)).setCard(next);
      invalidate(`peers/${peer.workspace_id}/${peer.id}/card`);
      overview.refetchCard();
      push({ type: "success", message: "Peer card saved" });
      setEditing(false);
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={`Peer card for ${peer.id}`} className="@container min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-3">
        <Icon name="book" size={11} className="text-accent self-center" />
        <h3 className="text-[10px] text-accent uppercase tracking-wider font-normal">peer_card</h3>
        <span className="text-[10px] text-text-muted tabular-nums">
          {overview.card ? `${card.total} entr${card.total === 1 ? "y" : "ies"}` : ""}
        </span>
        {canWrite && !editing && !overview.cardLoading ? (
          <button
            type="button"
            onClick={() => { setDraft(lines.join("\n")); setEditing(true); }}
            className="ml-auto text-[10px] uppercase tracking-wider text-text-muted hover:text-accent inline-flex items-center gap-1 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          >
            <Icon name="edit" size={10} /> EDIT_CARD
          </button>
        ) : null}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(18, Math.max(6, lines.length + 1))}
            spellCheck={false}
            aria-label="Peer card, one entry per line"
            aria-describedby={warnings.length ? `${peer.id}-card-warnings` : undefined}
            placeholder={"IDENTITY: Name: …\nATTRIBUTE: Location: …\nRELATIONSHIP: Employer: …\nINSTRUCTION: …"}
            className="w-full bg-void border border-border px-3 py-2 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:border-accent outline-none transition-colors duration-150 resize-y"
          />
          {warnings.length ? (
            <ul id={`${peer.id}-card-warnings`} className="space-y-0.5 text-[10px] text-yellow-400">
              {warnings.map((w) => <li key={w} className="flex gap-1.5"><Icon name="warning" size={10} className="mt-px shrink-0" />{w}</li>)}
            </ul>
          ) : (
            <p className="text-[10px] text-text-muted">One entry per line, each starting with IDENTITY:, ATTRIBUTE:, RELATIONSHIP:, or INSTRUCTION:.</p>
          )}
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={save} disabled={busy}>{busy ? "SAVING…" : "SAVE_CARD"}</Button>
            <Button variant="secondary" size="sm" onClick={() => setEditing(false)} disabled={busy}>CANCEL</Button>
          </div>
        </div>
      ) : overview.cardLoading ? (
        <div className="space-y-2" aria-label="Loading peer card">
          <div className="h-3.5 bg-border/60 animate-pulse w-1/3" />
          {[70, 55, 62].map((w) => <div key={w} className="h-2.5 bg-border/40 animate-pulse" style={{ width: `${w}%` }} />)}
        </div>
      ) : overview.cardError ? (
        <p role="alert" className="text-[11px] text-red-400 break-words">{formatApiError(overview.cardError)}</p>
      ) : card.total === 0 ? (
        <p className="text-[11px] text-text-muted">No peer card yet. Honcho writes one once it has stable facts about this peer.</p>
      ) : (
        <>
          <Headline peerId={peer.id} card={card} />
          <div className={SPEC_GRID}>
            {identityRest.length ? (
              <>
                <GroupHead label="identity" count={count(identityRest)} />
                <PairRows groups={identityRest} />
              </>
            ) : null}
            {card.attributes.length ? (
              <>
                <GroupHead label="attributes" count={count(card.attributes)} />
                <PairRows groups={card.attributes} />
              </>
            ) : null}
            {card.relationships.length ? (
              <>
                <GroupHead label="relationships" count={count(card.relationships)} />
                <PairRows groups={card.relationships} />
              </>
            ) : null}
            {card.instructions.length ? (
              <>
                <GroupHead label="instructions" count={card.instructions.length} hint="rules this peer set for anyone working with it" />
                <LineRows lines={card.instructions} numbered />
              </>
            ) : null}
            {card.unstructured.length ? (
              <>
                <GroupHead
                  label={structured ? "other_lines" : "entries"}
                  count={card.unstructured.length}
                  hint={structured ? "no Honcho prefix, shown as written" : "no IDENTITY / ATTRIBUTE / RELATIONSHIP / INSTRUCTION prefixes, shown as written"}
                />
                <LineRows lines={card.unstructured} numbered={false} />
              </>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function PeerEditModal({ peer, open, onClose, onSaved }: { peer: ApiPeer; open: boolean; onClose: () => void; onSaved: () => void }) {
  const apiOpts = useActiveHonchoOptions();
  const confirm = useConfirm();
  const { push } = useToast();
  const [observeMe, setObserveMe] = useState(observeMeOf(peer) ?? true);
  const [metadata, setMetadata] = useState(JSON.stringify(peer.metadata ?? {}, null, 2));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!apiOpts) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = metadata.trim() ? JSON.parse(metadata) : {};
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
    } catch {
      push({ type: "error", message: "Metadata must be a JSON object" });
      return;
    }
    const ok = await confirm({
      title: "SAVE_PEER",
      confirmLabel: "SAVE",
      body: <>Save changes to peer <span className="text-accent font-mono">{peer.id}</span> (type + metadata) on the live instance?</>,
    });
    if (!ok) return;
    setSaving(true);
    try {
      // Peer-level config only meaningfully supports observe_me; reasoning is workspace-level.
      const peerObj = await getSdk(apiOpts, peer.workspace_id).peer(peer.id);
      await peerObj.setConfiguration({ observeMe });
      await peerObj.setMetadata(parsed);
      push({ type: "success", message: `Peer ${peer.id} updated` });
      onClose();
      onSaved();
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="EDIT_PEER"
      open={open}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>CANCEL</Button>
          <Button variant="primary" onClick={save} disabled={saving}>{saving ? "SAVING…" : "SAVE"}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="PEER_ID" hint={`@${peer.workspace_id}`}>
          <div className="w-full bg-void border border-border px-3 py-2 text-sm font-mono text-text-muted">{peer.id}</div>
        </Field>
        <Checkbox
          checked={observeMe}
          onChange={setObserveMe}
          label="Observe me (enable reasoning about this peer)"
          hint="When enabled, Honcho will reason over this peer's messages and build a representation (observe_me). Reasoning itself is configured at the workspace level."
        />
        <div className="border-t border-border pt-4">
          <Field label="METADATA (JSON)" hint="Stored on the peer. Must be a JSON object.">
            <textarea
              value={metadata}
              onChange={(e) => setMetadata(e.target.value)}
              rows={6}
              spellCheck={false}
              className="w-full bg-void border border-border px-3 py-2 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:border-accent outline-none transition-colors duration-150 resize-y"
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/** An open peer row: facts and actions, the structured card, then conclusions, each full width. */
export function PeerRowBody({ peer, onChanged }: { peer: DecoratedPeer; onChanged: () => void }) {
  const { enabled: canWrite } = useWriteActions();
  const overview = usePeerOverview(peer);
  const [editOpen, setEditOpen] = useState(false);
  const observeMe = observeMeOf(peer);
  const meta = metadataPreview(peer.metadata);
  return (
    <div className="border-t border-border">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2.5 bg-void/40 border-b border-border">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-text-muted min-w-0">
          {peer.uid ? <ServerUid uid={peer.uid} className="justify-start gap-1.5 text-[10px]" /> : null}
          <span>created <span className="text-text-primary tabular-nums">{new Date(peer.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</span></span>
          <span>observe_me <span className="text-text-primary">{observeMe === null ? "(unset)" : String(observeMe)}</span></span>
          {meta ? <span className="min-w-0">metadata <span className="text-text-primary font-mono break-all">{meta}</span></span> : null}
        </div>
        <PeerActions peer={peer} overview={overview} onEdit={canWrite ? () => setEditOpen(true) : undefined} />
      </div>
      <div className="p-4">
        <PeerProfile peer={peer} overview={overview} canWrite={canWrite} />
      </div>
      <div className="p-4 border-t border-border">
        <PeerConclusions workspaceId={peer.workspace_id} peerId={peer.id} />
      </div>
      {editOpen ? <PeerEditModal peer={peer} open onClose={() => setEditOpen(false)} onSaved={onChanged} /> : null}
    </div>
  );
}
