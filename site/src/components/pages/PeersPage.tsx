"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Checkbox, Chip, Field, TextInput, RefreshButton, ToggleButton } from "@/components/atoms";
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

interface PeerConclusion {
  id: string;
  content: string;
  level: string;
  times_derived: number;
  created_at: string;
}

interface PeerDetailResp {
  available: boolean;
  reason?: string;
  messages?: number;
  conclusions?: number;
  conclusionsList?: PeerConclusion[];
}

/** Border + text color for a conclusion `level` (deductive/explicit/...). */
function levelColors(level: string): { border: string; text: string } {
  switch (level.toLowerCase()) {
    case "deductive":
      return { border: "border-l-blue-400", text: "text-blue-400" };
    case "inductive":
      return { border: "border-l-pink-400", text: "text-pink-400" };
    case "abductive":
      return { border: "border-l-orange-400", text: "text-orange-400" };
    case "summary":
      return { border: "border-l-cyan-400", text: "text-cyan-400" };
    case "explicit":
      return { border: "border-l-accent", text: "text-accent" };
    default:
      return { border: "border-l-purple-400", text: "text-purple-400" };
  }
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
  const { push } = useToast();
  const [expanded, setExpanded] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editObserveMe, setEditObserveMe] = useState(true);
  const [editMetadata, setEditMetadata] = useState("");
  const [saving, setSaving] = useState(false);
  const [details, setDetails] = useState<{
    loading: boolean;
    sessions: number | null;
    messages: number | null;
    conclusions: number | null;
    conclusionsList: PeerConclusion[] | null;
    peerCard: string[] | null;
    error?: string;
  }>({
    loading: false,
    sessions: null,
    messages: null,
    conclusions: null,
    conclusionsList: null,
    peerCard: null,
  });

  // Dedupe by peer key and depend ONLY on stable primitives. `useActiveHonchoOptions`
  // returns a fresh object every render, so depending on apiOpts (directly or via a
  // callback) re-runs this effect each render, whose cleanup flips `cancelled` before
  // card()/sessions() resolve — leaving the card stuck on skeletons. Read it from a ref.
  const fetchedRef = useRef<string | null>(null);
  const apiOptsRef = useRef(apiOpts);
  apiOptsRef.current = apiOpts;

  useEffect(() => {
    if (!expanded) return;
    const opts = apiOptsRef.current;
    if (!opts) return;
    const detailKey = `${peer.workspace_id}::${peer.id}`;
    if (fetchedRef.current === detailKey) return;
    fetchedRef.current = detailKey;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setDetails((d) => ({ ...d, loading: true, error: undefined }));
      (async () => {
        try {
          const sdk = getSdk(opts, peer.workspace_id);
          const peerObj = await sdk.peer(peer.id);
          const detailUrl =
            `/api/operator/db?view=peer_detail&workspace_id=${encodeURIComponent(peer.workspace_id)}` +
            `&peer_id=${encodeURIComponent(peer.id)}`;
          const [sessionsPage, card, opDetail] = await Promise.all([
            peerObj.sessions({ size: 1 }).catch(() => null),
            peerObj.card().catch(() => null),
            fetch(detailUrl, { cache: "no-store" })
              .then((r) => r.json() as Promise<PeerDetailResp>)
              .catch(() => null),
          ]);
          if (cancelled) return;
          const od = opDetail?.available ? opDetail : null;
          setDetails({
            loading: false,
            sessions: sessionsPage?.total ?? null,
            messages: od?.messages ?? null,
            conclusions: od?.conclusions ?? null,
            conclusionsList: od?.conclusionsList ?? null,
            peerCard: card ?? [],
          });
        } catch (err) {
          if (cancelled) return;
          setDetails({
            loading: false,
            sessions: null,
            messages: null,
            conclusions: null,
            conclusionsList: null,
            peerCard: null,
            error: formatApiError(err),
          });
        }
      })();
    });
    return () => {
      cancelled = true;
    };
  }, [expanded, peer.id, peer.workspace_id]);

  const created = new Date(peer.created_at).toLocaleString();
  const typeChip =
    peer.derivedType === "user" ? (
      <Chip tone="accent">USER</Chip>
    ) : peer.derivedType === "agent" ? (
      <Chip tone="purple">AGENT</Chip>
    ) : (
      <Chip tone="muted">PEER</Chip>
    );

  const cfg = (peer.configuration ?? {}) as { observe_me?: boolean; observeMe?: boolean };
  const currentObserveMe = cfg.observe_me ?? cfg.observeMe ?? null;

  const openEdit = () => {
    // Honcho peers are observed by default unless observe_me is explicitly false.
    setEditObserveMe(currentObserveMe ?? true);
    setEditMetadata(JSON.stringify(peer.metadata ?? {}, null, 2));
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!apiOpts) return;
    let parsedMeta: Record<string, unknown>;
    try {
      parsedMeta = editMetadata.trim() ? JSON.parse(editMetadata) : {};
      if (typeof parsedMeta !== "object" || parsedMeta === null || Array.isArray(parsedMeta)) {
        throw new Error("not an object");
      }
    } catch {
      push({ type: "error", message: "Metadata must be a JSON object" });
      return;
    }
    setSaving(true);
    try {
      // Peer-level config only meaningfully supports observe_me; reasoning is
      // managed at the workspace level (see WORKSPACE_CONFIG).
      const peerObj = await getSdk(apiOpts, peer.workspace_id).peer(peer.id);
      await peerObj.setConfiguration({ observeMe: editObserveMe });
      await peerObj.setMetadata(parsedMeta);
      push({ type: "success", message: `Peer ${peer.id} updated` });
      setEditOpen(false);
      onAction();
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
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
                <Icon name="message-square" size={10} />
                {details.loading ? "…" : details.messages != null ? details.messages.toLocaleString() : "—"} msgs
              </span>
              <span className="flex items-center gap-1">
                <Icon name="brain" size={10} />
                {details.loading ? "…" : details.conclusions != null ? details.conclusions.toLocaleString() : "—"}{" "}
                conclusions
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
            title="Edit peer (type + metadata)"
            aria-label="Edit peer"
            onClick={openEdit}
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
              <ConclusionsSection
                loading={details.loading && details.conclusionsList === null}
                conclusions={details.conclusionsList}
                total={details.conclusions}
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

    <Modal
      title="EDIT_PEER"
      open={editOpen}
      onClose={() => setEditOpen(false)}
      footer={
        <>
          <Button variant="secondary" onClick={() => setEditOpen(false)} disabled={saving}>
            CANCEL
          </Button>
          <Button variant="primary" onClick={saveEdit} disabled={saving}>
            {saving ? "SAVING…" : "SAVE"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="PEER_ID" hint={`@${peer.workspace_id}`}>
          <div className="w-full bg-void border border-border px-3 py-2 text-sm font-mono text-text-muted">
            {peer.id}
          </div>
        </Field>

        <div>
          <Checkbox
            checked={editObserveMe}
            onChange={setEditObserveMe}
            label="Observe me (enable reasoning about this peer)"
            hint="When enabled, Honcho will reason over this peer's messages and build a representation (observe_me). Reasoning itself is configured at the workspace level."
          />
        </div>

        <div className="border-t border-border pt-4">
          <Field label="METADATA (JSON)" hint="Stored on the peer. Must be a JSON object.">
            <textarea
              value={editMetadata}
              onChange={(e) => setEditMetadata(e.target.value)}
              rows={6}
              spellCheck={false}
              className="w-full bg-void border border-border px-3 py-2 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:border-accent outline-none transition-colors duration-150 resize-y"
            />
          </Field>
        </div>
      </div>
    </Modal>
    </>
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

function ConclusionsSection({
  loading,
  conclusions,
  total,
}: {
  loading: boolean;
  conclusions: PeerConclusion[] | null;
  total: number | null;
}) {
  const count = total ?? conclusions?.length ?? 0;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon name="brain" size={11} className="text-purple-400" />
        <span className="text-[10px] text-purple-400 uppercase tracking-wider">conclusions</span>
        {conclusions ? (
          <span className="text-[10px] text-text-muted">
            ({conclusions.length}
            {count > conclusions.length ? ` of ${count.toLocaleString()}` : ""})
          </span>
        ) : null}
      </div>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-9 bg-border/40 animate-pulse" />
          ))}
        </div>
      ) : conclusions === null ? (
        <div className="text-[11px] text-text-muted italic py-1">
          Conclusions need the operator DB (HONCHO_DATABASE_URL).
        </div>
      ) : conclusions.length === 0 ? (
        <div className="text-[11px] text-text-muted italic py-1">
          No conclusions derived about this peer yet.
        </div>
      ) : (
        <div className="space-y-2">
          {conclusions.map((c, i) => {
            const { border, text } = levelColors(c.level);
            return (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.2), duration: 0.15 }}
                className={cn("border-l-2 pl-3 py-0.5", border)}
              >
                <div className="text-xs text-text-primary leading-snug">{c.content}</div>
                <div className="flex items-center gap-3 mt-1 text-[9px] text-text-muted tracking-wider">
                  {c.level ? <span className={cn("uppercase", text)}>{c.level}</span> : null}
                  <span>freq: {c.times_derived}</span>
                  <span>{new Date(c.created_at).toLocaleDateString()}</span>
                </div>
              </motion.div>
            );
          })}
        </div>
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
