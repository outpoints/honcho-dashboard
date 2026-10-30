"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Chip, Field, TextInput, RefreshButton, ToggleButton } from "@/components/atoms";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import { PeerCompare } from "@/components/PeerCompare";
import {
  PeerAvatar,
  PeerRowBody,
  PeerTypeChip,
  classifyPeer,
  type DecoratedPeer,
  type PeerSummary,
  type PeerType,
} from "@/components/PeerDetail";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm";
import { useWriteActions } from "@/lib/writeActions";
import { honcho as raw } from "@/lib/honcho/client";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { formatApiError, invalidate, useHonchoQuery } from "@/lib/honcho/useQuery";
import { getSdk } from "@/lib/honcho/sdk";
import { cn } from "@/lib/utils";
import { useNow } from "@/lib/useNow";
import { useHash } from "@/lib/nav";
import { peersHash, readPeerWorkspaceFilter } from "@/lib/peerWorkspaceFilter";
import { readSelectedPeer, shortAge } from "@/lib/peerMemory";

const peerKey = (p: { workspace_id: string; id: string }) => `${p.workspace_id}/${p.id}`;

/** Hash navigation lives outside components so render stays pure. */
function setHash(next: string) {
  window.location.hash = next;
}

export function PeersPage() {
  const apiOpts = useActiveHonchoOptions();
  const { workspaceId: activeWorkspaceId } = useActiveWorkspace();
  const { push } = useToast();
  const confirm = useConfirm();
  const { enabled: canWrite } = useWriteActions();
  // A pinned URL wins over the shared active workspace, including storage events
  // from other tabs. Derive on every hash change so Back/Forward works too.
  const hash = useHash();
  const workspaceFilter = readPeerWorkspaceFilter(hash);
  const selected = readSelectedPeer(hash);
  const workspaceId = workspaceFilter === undefined ? activeWorkspaceId : workspaceFilter;
  const createWorkspaceId = workspaceId ?? activeWorkspaceId;

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<PeerType>("all");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [observeMe, setObserveMe] = useState<boolean>(true);
  const [busy, setBusy] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);

  // Workspaces list for the per-page dropdown ("all" / each workspace).
  const wsList = useHonchoQuery("workspaces/list?size=100", (o) =>
    raw.workspaces.list(o, { size: 100 }),
  );

  const targetWorkspaces = useMemo(() => {
    if (workspaceFilter === null) {
      return (wsList.data?.items ?? []).map((w) => w.id);
    }
    return workspaceId ? [workspaceId] : [];
  }, [workspaceFilter, workspaceId, wsList.data]);

  // Fetch peers for each targeted workspace; merge into one list.
  const peersKey = targetWorkspaces.length
    ? `sdk/peers/${targetWorkspaces.join(",")}`
    : null;
  const { data, error, isLoading, refetch } = useHonchoQuery<{ items: DecoratedPeer[] }>(
    peersKey,
    async (o) => {
      const pages = await Promise.all(
        targetWorkspaces.map((ws) =>
          raw.peers.list(o, ws, { size: 100 }).then((p) => p.items),
        ),
      );
      const seen = new Set<string>();
      const items: DecoratedPeer[] = [];
      for (const arr of pages) {
        for (const p of arr) {
          const key = peerKey(p);
          if (seen.has(key)) continue;
          seen.add(key);
          items.push({ ...p, derivedType: classifyPeer(p) });
        }
      }
      return { items };
    },
  );

  // Conclusion counts and last message per peer, one operator-database read for the whole list.
  const summaries = useHonchoQuery(
    targetWorkspaces.length ? `operator/peer_summaries/${targetWorkspaces.join(",")}` : null,
    async () => {
      const qs = targetWorkspaces.map((w) => `workspace_id=${encodeURIComponent(w)}`).join("&");
      const body = (await fetch(`/api/operator/db?view=peer_summaries&${qs}`, { cache: "no-store" }).then((r) => r.json())) as {
        available?: boolean;
        peers?: PeerSummary[];
      };
      if (!body.available) return null;
      return new Map((body.peers ?? []).map((s) => [`${s.workspace_id}/${s.peer_id}`, s]));
    },
  );
  // Rows sort by activity once these arrive; wait for them (or their failure) so rows
  // never reorder under the pointer after the first paint.
  const summariesSettled = !targetWorkspaces.length || summaries.data !== undefined || summaries.error !== undefined;
  const summaryOf = (p: DecoratedPeer): PeerSummary | undefined =>
    summaries.data
      ? summaries.data.get(peerKey(p)) ?? { workspace_id: p.workspace_id, peer_id: p.id, conclusions: 0, last_message_at: null }
      : undefined;

  const all = useMemo(() => data?.items ?? [], [data]);
  const counts = useMemo(
    () => ({
      all: all.length,
      user: all.filter((p) => p.derivedType === "user").length,
      agent: all.filter((p) => p.derivedType === "agent").length,
    }),
    [all],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = all.filter((p) => {
      // Honcho 3.4+ also returns an immutable uid; an exact paste finds the peer.
      if (q && !p.id.toLowerCase().includes(q) && p.uid?.toLowerCase() !== q) return false;
      if (typeFilter !== "all" && p.derivedType !== typeFilter) return false;
      return true;
    });
    const sums = summaries.data;
    if (!sums) return list;
    // Most recently active first; peers that never sent a message keep API order at the end.
    return [...list].sort((a, b) => {
      const la = sums.get(peerKey(a))?.last_message_at ?? "";
      const lb = sums.get(peerKey(b))?.last_message_at ?? "";
      return la === lb ? 0 : la > lb ? -1 : 1;
    });
  }, [all, search, typeFilter, summaries.data]);

  const create = async () => {
    if (!apiOpts) return;
    const trimmed = name.trim();
    if (!trimmed) {
      push({ type: "error", message: "Peer id is required" });
      return;
    }
    const targetWs = createWorkspaceId;
    if (!targetWs) {
      push({ type: "error", message: "Pick a workspace first" });
      return;
    }
    const ok = await confirm({
      title: "CREATE_PEER",
      confirmLabel: "CREATE",
      body: (
        <>
          Create peer <span className="text-accent font-mono">{trimmed}</span> in workspace{" "}
          <span className="text-accent font-mono">{targetWs}</span> on the live instance?
        </>
      ),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await getSdk(apiOpts, targetWs).peer(trimmed, {
        configuration: { observeMe },
      });
      push({ type: "success", message: `Peer ${trimmed} created` });
      setOpen(false);
      setName("");
      invalidate("sdk/peers/");
      refetch();
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    } finally {
      setBusy(false);
    }
  };

  const workspaceOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [{ value: "all", label: "all" }];
    for (const w of wsList.data?.items ?? []) {
      opts.push({ value: `ws:${w.id}`, label: w.id });
    }
    // The list may be paginated, restricted, or not loaded yet. Never disguise
    // an explicitly linked workspace as another selection or an empty value.
    if (workspaceId && !opts.some((o) => o.value === `ws:${workspaceId}`)) {
      opts.push({ value: `ws:${workspaceId}`, label: workspaceId });
    }
    return opts;
  }, [wsList.data, workspaceId]);

  const effectiveWorkspaceValue =
    workspaceFilter === null ? "all" : workspaceId ? `ws:${workspaceId}` : "";


  return (
    <div className="space-y-3">
      <PageHeader
        title="PEERS"
        subtitle="users and agents that interact within sessions"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <RefreshButton label="REFRESH" onClick={() => { refetch(); summaries.refetch(); }} />
            <Button
              variant="outline"
              icon="users"
              onClick={() => setCompareOpen((v) => !v)}
              disabled={all.length < 2}
              aria-expanded={compareOpen}
              title={all.length < 2 ? "Needs at least two peers" : undefined}
            >
              COMPARE
            </Button>
            {canWrite ? (
              <Button icon="plus" onClick={() => setOpen(true)} disabled={!createWorkspaceId}>
                NEW_PEER
              </Button>
            ) : (
              <Chip tone="muted" icon="key">
                read-only · enable in CONFIG
              </Chip>
            )}
          </div>
        }
      />

      <Panel title="FILTER">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[260px]">
            <Icon
              name="search"
              size={11}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
            />
            <TextInput
              className="pl-7"
              placeholder="search peers by id, or paste a uid…"
              aria-label="Search peers by id or uid"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-muted uppercase tracking-wider">
              workspace:
            </span>
            <Select
              className="min-w-[180px]"
              value={effectiveWorkspaceValue}
              onChange={(v) => setHash(peersHash(v === "all" ? null : v.slice(3)))}
              options={workspaceOptions}
              triggerClassName="py-1.5"
            />
          </div>
          <div className="flex items-center gap-1">
            <ToggleButton active={typeFilter === "all"} onClick={() => setTypeFilter("all")}>
              ALL <span className="opacity-70 ml-1">{counts.all}</span>
            </ToggleButton>
            <ToggleButton active={typeFilter === "user"} onClick={() => setTypeFilter("user")}>
              USER <span className="opacity-70 ml-1">{counts.user}</span>
            </ToggleButton>
            <ToggleButton
              active={typeFilter === "agent"}
              onClick={() => setTypeFilter("agent")}
            >
              AGENT <span className="opacity-70 ml-1">{counts.agent}</span>
            </ToggleButton>
          </div>
        </div>
        <div className="mt-2 text-[10px] text-text-muted">
          {isLoading
            ? "loading…"
            : `${filtered.length} of ${all.length} peers${
                workspaceFilter === null ? " across all workspaces" : ""
              }${summaries.data ? " · most recently active first" : ""}`}
        </div>
      </Panel>

      {compareOpen && all.length >= 2 ? (
        <PeerCompare key={peersKey ?? "none"} peers={all} onClose={() => setCompareOpen(false)} />
      ) : null}

      {error ? (
        <Panel title="ERROR" status="processing">
          <div className="text-xs text-red-400">{formatApiError(error)}</div>
        </Panel>
      ) : isLoading || (data && !summariesSettled) ? (
        <div className="space-y-2" aria-label="Loading peers">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-surface border border-border p-4 space-y-2">
              <div className="h-4 bg-border/60 animate-pulse w-1/4" />
              <div className="h-2 bg-border/40 animate-pulse w-2/3" />
              <div className="h-2 bg-border/40 animate-pulse w-1/2" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Panel title="NO_PEERS">
          <div className="text-xs text-text-muted py-4">
            {search || typeFilter !== "all"
              ? "No peers match the filter."
              : "No peers in this workspace yet."}
          </div>
        </Panel>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <PeerRow
              key={peerKey(p)}
              peer={p}
              summary={summaryOf(p)}
              linked={!!selected && selected.workspaceId === p.workspace_id && selected.peerId === p.id}
              onChanged={() => refetch()}
            />
          ))}
        </div>
      )}

      <StatusBar />

      <Modal
        title="CREATE_PEER"
        open={open}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              CANCEL
            </Button>
            <Button variant="primary" onClick={create} disabled={busy}>
              {busy ? "CREATING…" : "CREATE"}
            </Button>
          </>
        }
      >
        <Field label="PEER_ID" hint="Peer ids are immutable.">
          <TextInput
            placeholder="e.g., alice or support_bot"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) create();
            }}
          />
        </Field>
        <div className="flex items-center gap-2 mt-3">
          <span className="text-[10px] uppercase tracking-wider text-text-muted">type:</span>
          <ToggleButton active={observeMe} onClick={() => setObserveMe(true)}>
            USER (observe_me)
          </ToggleButton>
          <ToggleButton active={!observeMe} onClick={() => setObserveMe(false)}>
            AGENT
          </ToggleButton>
        </div>
      </Modal>
    </div>
  );
}

/** Expanding rows, closed until opened. Details load only for an open row. */
function PeerRow({
  peer,
  summary,
  linked,
  onChanged,
}: {
  peer: DecoratedPeer;
  summary?: PeerSummary;
  /** Named by `#/peers?peer=workspace/id`: opens and scrolls into view. */
  linked: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(linked);
  const rowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (linked) rowRef.current?.scrollIntoView({ block: "start" });
  }, [linked]);
  const reduceMotion = useReducedMotion();
  const bodyId = useId();
  const now = useNow(60_000);
  return (
    <div ref={rowRef} className={cn("bg-surface border transition-colors duration-150 scroll-mt-3", open ? "border-accent/40" : "border-border hover:border-accent/35")}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
        className="w-full grid grid-cols-[36px_minmax(0,1fr)_auto_28px] sm:grid-cols-[36px_minmax(0,1fr)_auto_auto_28px] items-center gap-x-4 px-3 py-2.5 text-left focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent"
      >
        <PeerAvatar type={peer.derivedType} active={open} />
        <span className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={cn("font-mono text-[13px] truncate", open ? "text-accent" : "text-text-primary")}>{peer.id}</span>
          <span className="text-[10px] text-text-muted">@{peer.workspace_id}</span>
          <PeerTypeChip type={peer.derivedType} />
        </span>
        <span className="hidden sm:block text-right text-[10px] text-text-muted tabular-nums leading-tight min-w-[84px]">
          <span className="block text-[11px] text-text-primary">{summary ? summary.conclusions.toLocaleString() : "—"}</span>
          conclusions
        </span>
        <span className="text-right text-[10px] text-text-muted tabular-nums leading-tight min-w-[84px]">
          <span className="block text-[11px] text-text-primary">
            {summary ? (summary.last_message_at ? shortAge(summary.last_message_at, now) : "never") : new Date(peer.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
          {summary ? "last message" : "created"}
        </span>
        <span className="w-7 h-7 border border-border-light text-text-muted flex items-center justify-center" aria-hidden>
          <Icon name="chevron-down" size={12} className={cn("motion-safe:transition-transform motion-safe:duration-150", open ? "rotate-0" : "-rotate-90")} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={bodyId}
            key="body"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, height: "auto" }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="overflow-hidden"
          >
            <PeerRowBody peer={peer} onChanged={onChanged} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
