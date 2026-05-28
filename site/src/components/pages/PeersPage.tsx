"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Chip, Field, TextInput, RefreshButton, ToggleButton } from "@/components/atoms";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import { useToast } from "@/components/toast";
import { honcho as raw } from "@/lib/honcho/client";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { formatApiError, invalidate, useHonchoQuery } from "@/lib/honcho/useQuery";
import { getSdk } from "@/lib/honcho/sdk";
import { toApiPeer } from "@/lib/honcho/adapters";
import type { ApiPeer } from "@/lib/honcho/types";
import { cn } from "@/lib/utils";
import { useNav } from "@/lib/nav";

type TypeFilter = "all" | "user" | "agent";

interface DecoratedPeer extends ApiPeer {
  derivedType: TypeFilter; // "user" | "agent" | "unknown" mapped to all
}

function classifyPeer(p: ApiPeer): TypeFilter {
  const cfg = p.configuration ?? {};
  const observeMe =
    (cfg as { observe_me?: boolean }).observe_me ??
    (cfg as { observeMe?: boolean }).observeMe;
  if (observeMe === true) return "user";
  if (observeMe === false) return "agent";
  return "all"; // unknown → bucket-all
}

export function PeersPage() {
  const apiOpts = useActiveHonchoOptions();
  const { workspaceId: activeWorkspaceId } = useActiveWorkspace();
  const { push } = useToast();
  const { navigate } = useNav();

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [workspaceFilter, setWorkspaceFilter] = useState<string>("__active__");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [observeMe, setObserveMe] = useState<boolean>(true);
  const [busy, setBusy] = useState(false);

  // Workspaces list for the per-page dropdown ("all" / each workspace).
  const wsList = useHonchoQuery("workspaces/list?size=100", (o) =>
    raw.workspaces.list(o, { size: 100 }),
  );

  const targetWorkspaces = useMemo(() => {
    if (workspaceFilter === "all") {
      return (wsList.data?.items ?? []).map((w) => w.id);
    }
    if (workspaceFilter === "__active__") {
      return activeWorkspaceId ? [activeWorkspaceId] : [];
    }
    return [workspaceFilter];
  }, [workspaceFilter, activeWorkspaceId, wsList.data]);

  // Fetch peers for each targeted workspace; merge into one list.
  const peersKey = targetWorkspaces.length
    ? `sdk/peers/${targetWorkspaces.join(",")}`
    : null;
  const { data, error, isLoading, refetch } = useHonchoQuery<{ items: DecoratedPeer[] }>(
    peersKey,
    async (o) => {
      const pages = await Promise.all(
        targetWorkspaces.map((ws) =>
          getSdk(o, ws)
            .peers({ size: 100 })
            .then((p) => p.items.map((peer) => toApiPeer(peer)))
            .catch(() => [] as ApiPeer[]),
        ),
      );
      const seen = new Set<string>();
      const items: DecoratedPeer[] = [];
      for (const arr of pages) {
        for (const p of arr) {
          const key = `${p.workspace_id}::${p.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          items.push({ ...p, derivedType: classifyPeer(p) });
        }
      }
      return { items };
    },
  );

  const all = data?.items ?? [];
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
    return all.filter((p) => {
      if (q && !p.id.toLowerCase().includes(q)) return false;
      if (typeFilter !== "all" && p.derivedType !== typeFilter) return false;
      return true;
    });
  }, [all, search, typeFilter]);

  const create = async () => {
    if (!apiOpts) return;
    const trimmed = name.trim();
    if (!trimmed) {
      push({ type: "error", message: "Peer id is required" });
      return;
    }
    const targetWs = workspaceFilter === "all" || workspaceFilter === "__active__"
      ? activeWorkspaceId
      : workspaceFilter;
    if (!targetWs) {
      push({ type: "error", message: "Pick a workspace first" });
      return;
    }
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
      opts.push({ value: w.id, label: w.id });
    }
    return opts;
  }, [wsList.data]);

  const effectiveWorkspaceValue =
    workspaceFilter === "__active__" && activeWorkspaceId
      ? activeWorkspaceId
      : workspaceFilter === "__active__"
        ? ""
        : workspaceFilter;

  return (
    <div className="space-y-3">
      <PageHeader
        title="PEERS"
        subtitle="users and agents that interact within sessions"
        actions={
          <div className="flex items-center gap-2">
            <RefreshButton label="REFRESH" onClick={() => refetch()} />
            <Button icon="plus" onClick={() => setOpen(true)} disabled={!activeWorkspaceId}>
              NEW_PEER
            </Button>
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
              placeholder="search peers by name or id…"
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
              onChange={(v) => setWorkspaceFilter(v)}
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
                workspaceFilter === "all" ? " across all workspaces" : ""
              }`}
        </div>
      </Panel>

      {error ? (
        <Panel title="ERROR" status="processing">
          <div className="text-xs text-red-400">{formatApiError(error)}</div>
        </Panel>
      ) : isLoading ? (
        <div className="space-y-2">
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
          <AnimatePresence initial={false}>
            {filtered.map((p, i) => (
              <motion.div
                key={`${p.workspace_id}::${p.id}`}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ delay: Math.min(i * 0.02, 0.2), duration: 0.2 }}
              >
                <PeerRow peer={p} onAction={() => refetch()} navigate={navigate} />
              </motion.div>
            ))}
          </AnimatePresence>
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

function PeerRow({
  peer,
  onAction,
  navigate,
}: {
  peer: DecoratedPeer;
  onAction: () => void;
  navigate: (k: "sessions" | "messages") => void;
}) {
  const apiOpts = useActiveHonchoOptions();
  const [expanded, setExpanded] = useState(true);
  const [details, setDetails] = useState<{
    loading: boolean;
    sessions: number | null;
    peerCard: string[] | null;
    error?: string;
  }>({ loading: false, sessions: null, peerCard: null });

  useEffect(() => {
    if (!apiOpts || !expanded || details.peerCard !== null || details.loading) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setDetails((d) => ({ ...d, loading: true, error: undefined }));
      (async () => {
        try {
          const sdk = getSdk(apiOpts, peer.workspace_id);
          const peerObj = await sdk.peer(peer.id);
          const [sessionsPage, card] = await Promise.all([
            peerObj.sessions({ size: 1 }).catch(() => null),
            peerObj.card().catch(() => null),
          ]);
          if (cancelled) return;
          setDetails({
            loading: false,
            sessions: sessionsPage?.total ?? null,
            peerCard: card ?? [],
          });
        } catch (err) {
          if (cancelled) return;
          setDetails({
            loading: false,
            sessions: null,
            peerCard: null,
            error: formatApiError(err),
          });
        }
      })();
    });
    return () => {
      cancelled = true;
    };
  }, [apiOpts, expanded, peer.id, peer.workspace_id, details.peerCard, details.loading]);

  const created = new Date(peer.created_at).toLocaleString();
  const typeChip =
    peer.derivedType === "user" ? (
      <Chip tone="accent">USER</Chip>
    ) : peer.derivedType === "agent" ? (
      <Chip tone="purple">AGENT</Chip>
    ) : (
      <Chip tone="muted">PEER</Chip>
    );

  return (
    <motion.div
      whileHover={{ borderColor: "rgba(60, 130, 247, 0.35)" }}
      transition={{ duration: 0.15 }}
      className="bg-surface border border-border"
    >
      <div className="flex items-start justify-between gap-3 p-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="w-8 h-8 border border-border-light text-text-muted flex items-center justify-center shrink-0">
            <Icon name={peer.derivedType === "agent" ? "bot" : "user"} size={14} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-text-primary font-mono truncate">{peer.id}</span>
              <span className="text-[10px] text-text-muted">@{peer.workspace_id}</span>
              {typeChip}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-text-muted mt-1.5">
              <span className="flex items-center gap-1">
                <Icon name="git-branch" size={10} />
                {details.loading ? "…" : details.sessions ?? "—"} sessions
              </span>
              <span className="flex items-center gap-1">
                <Icon name="file-search" size={10} />
                {details.peerCard ? details.peerCard.length : "—"} card lines
              </span>
              <span className="flex items-center gap-1">
                <Icon name="clock" size={10} />
                created {created}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-right text-[10px] text-text-muted">
            <div>created</div>
            <div className="text-text-primary font-mono">{created}</div>
          </div>
          <button
            className="w-7 h-7 border border-border-light text-text-muted hover:text-text-primary flex items-center justify-center"
            title="Edit metadata"
            onClick={() => onAction()}
          >
            <Icon name="settings" size={12} />
          </button>
          <motion.button
            onClick={() => setExpanded((e) => !e)}
            className="w-7 h-7 border border-border-light text-text-muted hover:text-text-primary flex items-center justify-center"
            aria-label={expanded ? "Collapse" : "Expand"}
            animate={{ rotate: expanded ? 0 : -90 }}
            transition={{ type: "spring", stiffness: 400, damping: 22 }}
          >
            <Icon name="chevron-down" size={12} />
          </motion.button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            key="expanded"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-3 border-t border-border pt-3">
              <PeerCardSection
                loading={details.loading && details.peerCard === null}
                card={details.peerCard}
                error={details.error}
              />
              <ObserveMeRow peer={peer} />
              <div className="flex items-center gap-2 flex-wrap pt-1">
                <Button
                  variant="outline"
                  onClick={() => {
                    window.location.hash = `#/sessions?peer=${encodeURIComponent(peer.id)}`;
                    navigate("sessions");
                  }}
                >
                  VIEW_SESSIONS
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    window.location.hash = `#/messages?peer=${encodeURIComponent(peer.id)}`;
                    navigate("messages");
                  }}
                >
                  VIEW_MESSAGES
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    window.location.hash = `#/context?peer=${encodeURIComponent(peer.id)}`;
                  }}
                >
                  VIEW_CONTEXT
                </Button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

function PeerCardSection({
  loading,
  card,
  error,
}: {
  loading: boolean;
  card: string[] | null;
  error?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon name="sparkles" size={11} className="text-accent" />
        <span className="text-[10px] text-accent uppercase tracking-wider">peer_card</span>
        {card ? (
          <span className="text-[10px] text-text-muted">({card.length})</span>
        ) : null}
      </div>
      {loading ? (
        <div className="space-y-1.5">
          <div className="h-2.5 bg-border/60 animate-pulse w-3/4" />
          <div className="h-2.5 bg-border/60 animate-pulse w-2/3" />
          <div className="h-2.5 bg-border/60 animate-pulse w-1/2" />
        </div>
      ) : error ? (
        <div className="text-[11px] text-red-400">{error}</div>
      ) : card === null || card.length === 0 ? (
        <div
          className={cn(
            "text-[11px] text-text-muted italic",
            "py-1",
          )}
        >
          No peer card yet. The deriver fills this in once the peer has been observed in a
          session.
        </div>
      ) : (
        <ul className="space-y-1 text-xs text-text-primary">
          {card.map((line, i) => (
            <motion.li
              key={i}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03, duration: 0.15 }}
              className="flex gap-2"
            >
              <span className="text-text-muted">•</span>
              <span className="font-mono">{line}</span>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ObserveMeRow({ peer }: { peer: DecoratedPeer }) {
  const cfg = (peer.configuration ?? {}) as { observe_me?: boolean; observeMe?: boolean };
  const observeMe = cfg.observe_me ?? cfg.observeMe;
  return (
    <div className="text-[11px] text-text-muted">
      observe_me:{" "}
      <span
        className={
          observeMe === true
            ? "text-accent"
            : observeMe === false
              ? "text-purple-400"
              : "text-text-muted"
        }
      >
        {observeMe === undefined ? "(unset)" : String(observeMe)}
      </span>
    </div>
  );
}
