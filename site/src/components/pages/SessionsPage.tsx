"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Markdown } from "@/components/Markdown";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Chip, Tabs, RefreshButton, TextInput } from "@/components/atoms";
import { Select } from "@/components/Select";
import { Icon } from "@/components/icons";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Modal } from "@/components/Modal";
import { SessionFileUploadModal } from "@/components/SessionFileUploadModal";
import { ServerUid } from "@/components/ServerUid";
import type { PeerKind } from "@/components/MessageLine";
import { SessionTranscript } from "@/components/SessionTranscript";
import { SessionLearning } from "@/components/SessionLearning";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm";
import { useWriteActions } from "@/lib/writeActions";
import { honcho as raw } from "@/lib/honcho/client";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { formatApiError, invalidate, useHonchoQuery } from "@/lib/honcho/useQuery";
import { useOperatorQuery } from "@/lib/operator/client";
import { getSdk } from "@/lib/honcho/sdk";
import { useHonchoCapabilities } from "@/lib/honcho/useCapabilities";
import type { HonchoCapabilityState } from "@/lib/honcho/capabilities";
import { listAllSessions } from "@/lib/honcho/sessionListing";
import { toApiSession, toApiPeer } from "@/lib/honcho/adapters";
import type { ApiSession } from "@/lib/honcho/types";
import type { HonchoClientOptions } from "@/lib/honcho/client";
import { hasSessionOverrides, learningOff, resolveIntervals, resolveSwitches } from "@/lib/honcho/sessionSettings";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | "active" | "idle" | "archived";
type PeerType = "user" | "agent" | "unknown";
type SortKey = "recent" | "oldest" | "most_msgs" | "fewest_msgs" | "created_desc" | "created_asc";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "recent", label: "most recent message" },
  { value: "oldest", label: "oldest message" },
  { value: "most_msgs", label: "most messages" },
  { value: "fewest_msgs", label: "fewest messages" },
  { value: "created_desc", label: "newest created" },
  { value: "created_asc", label: "oldest created" },
];

interface SessionStatRow {
  session_id: string;
  workspace_id: string;
  message_count: number;
  token_sum: number;
  last_message_at: string | null;
  peers: string[];
}

interface SessionStatsResp {
  available: boolean;
  reason?: string;
  sessions?: Record<string, SessionStatRow>;
}

const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Classify a peer from its configuration (observe_me) — same heuristic the
 * PeersPage uses. Falls back to a name heuristic when config is unset. */
function classifyPeerConfig(cfg: Record<string, unknown> | undefined): PeerType {
  const c = cfg ?? {};
  const observeMe =
    (c as { observe_me?: boolean }).observe_me ?? (c as { observeMe?: boolean }).observeMe;
  if (observeMe === true) return "user";
  if (observeMe === false) return "agent";
  return "unknown";
}

function nameLooksAgent(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("bot") || n.includes("agent") || n === "assistant";
}

function deriveStatus(active: boolean, lastMessageAt: string | null): StatusFilter {
  if (!active) return "archived";
  const t = lastMessageAt ? Date.parse(lastMessageAt) : NaN;
  if (!Number.isNaN(t) && Date.now() - t < ACTIVE_WINDOW_MS) return "active";
  return "idle";
}

/** Scope filter value for sessions that belong to no scope. */
const NO_SCOPE = "__no_scope__";

type LearningFilter = "any" | "off" | "overrides";
const LEARNING_OPTIONS: { value: LearningFilter; label: string }[] = [
  { value: "any", label: "any" },
  { value: "off", label: "conclusions off" },
  { value: "overrides", label: "has session settings" },
];
type RowTab = "conversation" | "learning";

export function SessionsPage() {
  const apiOpts = useActiveHonchoOptions();
  const { workspaceId: activeWorkspaceId } = useActiveWorkspace();
  const { push } = useToast();
  const { scopedSessionClone, sessionScopes, dreamHistory } = useHonchoCapabilities();
  // Honcho 3.5+: the session list reports each session's scopes in the same query.
  const includeScopes = sessionScopes === "available";

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  /** "all", NO_SCOPE, or a scope name (3.5+). */
  const [scopeFilter, setScopeFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [learningFilter, setLearningFilter] = useState<LearningFilter>("any");
  const [workspaceFilter, setWorkspaceFilter] = useState<string>("__active__");
  const [open, setOpen] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  // Workspace dropdown ("all" / each).
  const wsList = useHonchoQuery("workspaces/list?size=100", (o) =>
    raw.workspaces.list(o, { size: 100 }),
  );

  // Stored workspace settings, for what a session inherits. Undefined: unread.
  const workspaceConfig = useMemo(() => {
    const items = wsList.data?.items;
    const map = new Map((items ?? []).map((w) => [w.id, w.configuration ?? {}] as const));
    return (workspaceId: string): unknown | undefined => (items ? map.get(workspaceId) : undefined);
  }, [wsList.data]);

  const targetWorkspaces = useMemo(() => {
    if (workspaceFilter === "all") return (wsList.data?.items ?? []).map((w) => w.id);
    if (workspaceFilter === "__active__") return activeWorkspaceId ? [activeWorkspaceId] : [];
    return [workspaceFilter];
  }, [workspaceFilter, activeWorkspaceId, wsList.data]);

  // Sessions + a peer-type map, fetched per targeted workspace and merged.
  const sessionsKey = targetWorkspaces.length
    ? `sdk/sessions/${targetWorkspaces.join(",")}${includeScopes ? "?include_scopes" : ""}`
    : null;
  const { data, error, isLoading, refetch } = useHonchoQuery<{
    items: ApiSession[];
    peerTypes: Record<string, PeerType>;
  }>(sessionsKey, async (o) => {
    const perWs = await Promise.all(
      targetWorkspaces.map(async (ws) => {
        const [sessions, peers] = await Promise.all([
          listAllSessions(getSdk(o, ws), { includeScopes }).then((items) => items.map((s) => toApiSession(s))),
          getSdk(o, ws)
            .peers({ size: 100 })
            .then((p) => p.items.map((peer) => toApiPeer(peer)))
            .catch(() => []),
        ]);
        return { sessions, peers };
      }),
    );
    const items: ApiSession[] = [];
    const peerTypes: Record<string, PeerType> = {};
    const seen = new Set<string>();
    for (const { sessions, peers } of perWs) {
      for (const p of peers) peerTypes[`${p.workspace_id}::${p.id}`] = classifyPeerConfig(p.configuration);
      for (const s of sessions) {
        const k = `${s.workspace_id}::${s.id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        items.push(s);
      }
    }
    return { items, peerTypes };
  });

  // Per-session activity stats from the operator/db layer (batched query).
  const statsPath = useMemo(() => {
    if (!targetWorkspaces.length) return null;
    return targetWorkspaces.length === 1
      ? `/api/operator/db?view=sessions&workspace_id=${encodeURIComponent(targetWorkspaces[0])}`
      : `/api/operator/db?view=sessions`;
  }, [targetWorkspaces]);
  const stats = useOperatorQuery<SessionStatsResp>(statsPath);
  const statsMap = stats.data?.available ? stats.data.sessions ?? {} : {};

  // Message lines show a peer's type only when its configuration sets it.
  const configuredPeerKind = useMemo(() => {
    const map = data?.peerTypes ?? {};
    return (workspaceId: string, peerId: string): PeerKind => {
      const t = map[`${workspaceId}::${peerId}`];
      return t === "user" || t === "agent" ? t : null;
    };
  }, [data?.peerTypes]);

  const resolvePeerType = useMemo(() => {
    const map = data?.peerTypes ?? {};
    return (workspaceId: string, peerId: string): PeerType => {
      const t = map[`${workspaceId}::${peerId}`];
      if (t && t !== "unknown") return t;
      return nameLooksAgent(peerId) ? "agent" : "user";
    };
  }, [data?.peerTypes]);

  const decorated = useMemo(() => {
    return (data?.items ?? []).map((s) => {
      const stat = statsMap[`${s.workspace_id}::${s.id}`];
      return {
        session: s,
        stat,
        status: deriveStatus(s.is_active, stat?.last_message_at ?? null),
        learningOff: learningOff(s.configuration, workspaceConfig(s.workspace_id)),
        overrides: hasSessionOverrides(s.configuration),
      };
    });
  }, [data?.items, statsMap, workspaceConfig]);

  // Scope names seen on the loaded sessions. Only sessions listed with
  // `include_scopes` carry `scopes`, so an empty list hides the filter.
  const scopeNames = useMemo(() => {
    const names = new Set<string>();
    for (const d of decorated) for (const name of d.session.scopes ?? []) names.add(name);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [decorated]);
  const scopeFilterShown = includeScopes && scopeNames.length > 0;
  const activeScopeFilter = scopeFilterShown && (scopeFilter === NO_SCOPE || scopeNames.includes(scopeFilter)) ? scopeFilter : "all";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = decorated.filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (learningFilter === "off" && !d.learningOff) return false;
      if (learningFilter === "overrides" && !d.overrides) return false;
      if (activeScopeFilter === NO_SCOPE && (d.session.scopes?.length ?? 0) > 0) return false;
      if (activeScopeFilter !== "all" && activeScopeFilter !== NO_SCOPE && !d.session.scopes?.includes(activeScopeFilter)) return false;
      if (q) {
        const hay = `${d.session.id} ${(d.stat?.peers ?? []).join(",")}`.toLowerCase();
        // Honcho 3.4+ uid: match an exact paste only, so short queries stay readable.
        if (!hay.includes(q) && d.session.uid?.toLowerCase() !== q) return false;
      }
      return true;
    });

    // Sort metrics. Sessions missing a last message sink to the bottom for both
    // recency orders (Infinity for "oldest", 0 for "recent"); missing counts → 0.
    const msgs = (d: (typeof list)[number]) => d.stat?.message_count ?? 0;
    const lastAt = (d: (typeof list)[number]) =>
      d.stat?.last_message_at ? Date.parse(d.stat.last_message_at) : 0;
    const createdAt = (d: (typeof list)[number]) => Date.parse(d.session.created_at) || 0;

    list.sort((a, b) => {
      switch (sort) {
        case "oldest":
          return (lastAt(a) || Infinity) - (lastAt(b) || Infinity);
        case "most_msgs":
          return msgs(b) - msgs(a);
        case "fewest_msgs":
          return msgs(a) - msgs(b);
        case "created_desc":
          return createdAt(b) - createdAt(a);
        case "created_asc":
          return createdAt(a) - createdAt(b);
        case "recent":
        default:
          return lastAt(b) - lastAt(a);
      }
    });
    return list;
  }, [decorated, statusFilter, learningFilter, activeScopeFilter, query, sort]);

  const remove = async (workspaceId: string, sid: string) => {
    if (!apiOpts) return;
    setRemoveTarget(null);
    setOpen(null);
    try {
      const session = await getSdk(apiOpts, workspaceId).session(sid);
      await session.delete();
      push({ type: "success", message: `Session ${sid} removed` });
      invalidate("sdk/sessions/");
      refetch();
      stats.refetch();
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    }
  };

  const workspaceOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [{ value: "all", label: "all" }];
    for (const w of wsList.data?.items ?? []) opts.push({ value: w.id, label: w.id });
    return opts;
  }, [wsList.data]);

  const effectiveWorkspaceValue =
    workspaceFilter === "__active__"
      ? activeWorkspaceId ?? ""
      : workspaceFilter;

  const removeTargetEntry = removeTarget
    ? decorated.find((d) => d.session.id === removeTarget)
    : null;

  return (
    <div className="space-y-3">
      <PageHeader
        title="SESSIONS"
        subtitle="interaction threads between peers within workspaces"
        actions={
          <div className="flex items-center gap-2">
            <RefreshButton
              label="REFRESH"
              onClick={() => {
                refetch();
                stats.refetch();
              }}
            />
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] flex items-center gap-2 bg-void border border-border px-3 py-2">
          <Icon name="search" className="text-text-muted" size={12} />
          <input
            placeholder="search by id, peer, or uid…"
            aria-label="Search sessions by id or peer name, or paste a uid"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="bg-transparent text-xs flex-1 outline-none placeholder:text-text-muted"
          />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-text-muted">workspace:</span>
          <Select
            value={effectiveWorkspaceValue}
            onChange={setWorkspaceFilter}
            options={workspaceOptions}
            className="min-w-[160px]"
            triggerClassName="py-1.5"
          />
        </div>
        {scopeFilterShown ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-text-muted">scope:</span>
            <Select
              value={activeScopeFilter}
              onChange={setScopeFilter}
              options={[
                { value: "all", label: "any scope or none" },
                { value: NO_SCOPE, label: "in no scope" },
                ...scopeNames.map((name) => ({ value: name, label: name })),
              ]}
              className="min-w-[160px]"
              triggerClassName="py-1.5"
            />
          </div>
        ) : null}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-text-muted">learning:</span>
          <Select
            value={learningFilter}
            onChange={(v) => setLearningFilter(v as LearningFilter)}
            options={LEARNING_OPTIONS}
            className="min-w-[180px]"
            triggerClassName="py-1.5"
          />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-text-muted">sort:</span>
          <Select
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
            options={SORT_OPTIONS}
            className="min-w-[180px]"
            triggerClassName="py-1.5"
          />
        </div>
        <Tabs<StatusFilter>
          items={[
            { key: "all", label: "ALL" },
            { key: "active", label: "ACTIVE" },
            { key: "idle", label: "IDLE" },
            { key: "archived", label: "ARCHIVED" },
          ]}
          current={statusFilter}
          onChange={setStatusFilter}
          className="border-0"
          layoutId="sessions-filter"
        />
      </div>

      {!stats.isLoading && stats.data && !stats.data.available ? (
        <div className="text-[10px] text-text-muted px-1">
          message/token/peer counts unavailable — {stats.data.reason}. Set
          <span className="font-mono text-text-primary"> HONCHO_DATABASE_URL</span> to enable.
        </div>
      ) : null}

      {error ? (
        <Panel title="ERROR" status="processing">
          <div className="text-xs text-red-400">{formatApiError(error)}</div>
        </Panel>
      ) : targetWorkspaces.length === 0 ? (
        <Panel title="NO_WORKSPACE">
          <div className="text-xs text-text-muted py-4">Select a workspace in the sidebar.</div>
        </Panel>
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-surface border border-border p-3 space-y-2">
              <div className="h-4 bg-border/60 animate-pulse w-1/3" />
              <div className="h-2 bg-border/40 animate-pulse w-1/2" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Panel title="NO_SESSIONS">
          <div className="text-xs text-text-muted py-4">
            {query || statusFilter !== "all" || activeScopeFilter !== "all" || learningFilter !== "any"
              ? "No sessions match the filter."
              : "No sessions in this workspace yet."}
          </div>
        </Panel>
      ) : (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {filtered.map((d, i) => (
              <motion.div
                key={`${d.session.workspace_id}::${d.session.id}`}
                layout
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 100, transition: { duration: 0.2 } }}
                transition={{ delay: Math.min(i * 0.03, 0.25), duration: 0.2 }}
                className="bg-surface border border-border transition-colors duration-150 hover:border-accent/50"
              >
                <SessionRow
                  session={d.session}
                  stat={d.stat}
                  status={d.status}
                  workspaceConfig={workspaceConfig(d.session.workspace_id)}
                  learningOffSource={d.learningOff ? d.learningOff.source : null}
                  overrides={d.overrides}
                  open={open === d.session.id}
                  onToggle={() => setOpen(open === d.session.id ? null : d.session.id)}
                  resolvePeerType={resolvePeerType}
                  configuredPeerKind={configuredPeerKind}
                  apiOpts={apiOpts}
                  cloneScoped={scopedSessionClone}
                  onRemove={() => setRemoveTarget(d.session.id)}
                  onOpenMessages={() => {
                    window.location.hash = `#/messages?session=${encodeURIComponent(d.session.id)}`;
                  }}
                  onDataChanged={() => {
                    refetch();
                    stats.refetch();
                  }}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <ConfirmModal
        open={!!removeTargetEntry}
        title="CONFIRM_REMOVE"
        body={
          <>
            This will remove <span className="text-accent">{removeTargetEntry?.session.id}</span> and
            all its associated messages. This cannot be undone.
            {dreamHistory === "available" ? (
              <span className="block mt-2">
                Dream history keeps no copy of this session&apos;s conclusions: dreams that created or removed them will
                list them as unavailable.
              </span>
            ) : null}
          </>
        }
        confirmLabel="REMOVE_SESSION"
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() =>
          removeTargetEntry &&
          remove(removeTargetEntry.session.workspace_id, removeTargetEntry.session.id)
        }
      />

      <StatusBar />
    </div>
  );
}

function PeerAvatar({ type, size = 10 }: { type: PeerType; size?: number }) {
  return <Icon name={type === "agent" ? "bot" : "user"} size={size} />;
}

function SessionRow({
  session,
  stat,
  status,
  workspaceConfig,
  learningOffSource,
  overrides,
  open,
  onToggle,
  resolvePeerType,
  configuredPeerKind,
  apiOpts,
  cloneScoped,
  onRemove,
  onOpenMessages,
  onDataChanged,
}: {
  session: ApiSession;
  stat?: SessionStatRow;
  status: StatusFilter;
  /** The workspace's stored settings, or undefined when unread. */
  workspaceConfig: unknown | undefined;
  /** Where "conclusions off" comes from, or null when they are on. */
  learningOffSource: string | null;
  /** The session stores settings of its own. */
  overrides: boolean;
  open: boolean;
  onToggle: () => void;
  resolvePeerType: (workspaceId: string, peerId: string) => PeerType;
  configuredPeerKind: (workspaceId: string, peerId: string) => PeerKind;
  apiOpts: HonchoClientOptions | null;
  cloneScoped: HonchoCapabilityState;
  onRemove: () => void;
  onOpenMessages: () => void;
  onDataChanged: () => void;
}) {
  const [detail, setDetail] = useState<{
    loading: boolean;
    loaded: boolean;
    peers: string[];
    hasSummary: boolean;
    summary: string | null;
    shortSummary: SummaryView | null;
    longSummary: SummaryView | null;
    error?: string;
  }>({
    loading: false,
    loaded: false,
    peers: [],
    hasSummary: false,
    summary: null,
    shortSummary: null,
    longSummary: null,
  });
  const [summariesOpen, setSummariesOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detailVersion, setDetailVersion] = useState(0);
  const { push } = useToast();
  const confirm = useConfirm();
  const { enabled: canWrite } = useWriteActions();
  const [newPeer, setNewPeer] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [tab, setTab] = useState<RowTab>("conversation");

  // Dedupe by session key and depend ONLY on stable primitives. `useActiveHonchoOptions`
  // returns a fresh object every render, so depending on apiOpts re-runs this effect each
  // render, whose cleanup flips `cancelled` before messages()/summaries() resolve — leaving
  // the panel stuck on skeletons. Read apiOpts from a ref instead.
  const fetchedRef = useRef<string | null>(null);
  const apiOptsRef = useRef(apiOpts);
  apiOptsRef.current = apiOpts;
  const fallbackPeersRef = useRef(stat?.peers ?? []);
  fallbackPeersRef.current = stat?.peers ?? [];

  useEffect(() => {
    if (!open) return;
    const opts = apiOptsRef.current;
    if (!opts) return;
    const detailKey = `${session.workspace_id}::${session.id}::${detailVersion}`;
    if (fetchedRef.current === detailKey) return;
    fetchedRef.current = detailKey;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setDetail((d) => ({ ...d, loading: true, error: undefined }));
      (async () => {
        try {
          // Plain reads: the SDK's session(id) get-or-creates, and opening a row must never do that.
          // The conversation itself loads in SessionTranscript.
          const [summaries, sessionPeers] = await Promise.all([
            raw.sessions.summaries(opts, session.workspace_id, session.id).catch(() => null),
            raw.sessions
              .peers(opts, session.workspace_id, session.id, { size: 100 })
              .then((page) => page.items.map((peer) => peer.id))
              .catch(() => fallbackPeersRef.current),
          ]);
          if (cancelled) return;
          const short = summaries?.short_summary ?? null;
          const long = summaries?.long_summary ?? null;
          setDetail({
            loading: false,
            loaded: true,
            peers: sessionPeers,
            hasSummary: !!(short || long),
            summary: short?.content ?? long?.content ?? null,
            shortSummary: short
              ? { content: short.content, tokenCount: short.token_count, createdAt: short.created_at }
              : null,
            longSummary: long
              ? { content: long.content, tokenCount: long.token_count, createdAt: long.created_at }
              : null,
            error: undefined,
          });
        } catch (err) {
          if (cancelled) return;
          setDetail((d) => ({ ...d, loading: false, loaded: true, error: formatApiError(err) }));
        }
      })();
    });
    return () => {
      cancelled = true;
    };
  }, [detailVersion, open, session.id, session.workspace_id]);

  const peers = detail.loaded ? detail.peers : stat?.peers ?? [];
  const summaryCadence = (() => {
    const summaries = resolveSwitches(session.configuration, workspaceConfig).find((row) => row.key === "summary")!;
    if (summaries.effective === false) {
      return `Summaries are off for this session (set on the ${summaries.source === "session" ? "session" : "workspace"}). Change it on the LEARNING tab.`;
    }
    const { short, long } = resolveIntervals(session.configuration, workspaceConfig);
    const every = (n: number | null, fallback: number) => (n === null ? `${fallback} (the shipped default)` : String(n));
    return `Honcho writes a short summary every ${every(short.effective, 20)} messages and a long one every ${every(long.effective, 60)}. The LEARNING tab shows where these come from.`;
  })();
  const created = new Date(session.created_at).toLocaleString();
  const lastMessage = stat?.last_message_at ? new Date(stat.last_message_at).toLocaleString() : "—";
  const statusTone = status === "active" ? "accent" : status === "idle" ? "yellow" : "muted";

  const refreshDetail = () => {
    fetchedRef.current = null;
    setDetailVersion((version) => version + 1);
  };

  const removePeer = async (peerId: string) => {
    if (!apiOpts) return;
    const ok = await confirm({
      title: "REMOVE_PEER",
      destructive: true,
      confirmLabel: "REMOVE",
      body: (
        <>
          Remove <span className="text-accent font-mono">{peerId}</span> from session{" "}
          <span className="text-accent font-mono">{session.id}</span> on the live instance?
        </>
      ),
    });
    if (!ok) return;
    setActionBusy(true);
    try {
      const ses = await getSdk(apiOpts, session.workspace_id).session(session.id);
      await ses.removePeers(peerId);
      push({ type: "success", message: `Removed ${peerId}` });
      refreshDetail();
      onDataChanged();
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    } finally {
      setActionBusy(false);
    }
  };

  const addPeer = async () => {
    const pid = newPeer.trim();
    if (!apiOpts || !pid) return;
    const ok = await confirm({
      title: "ADD_PEER",
      confirmLabel: "ADD",
      body: (
        <>
          Add <span className="text-accent font-mono">{pid}</span> to session{" "}
          <span className="text-accent font-mono">{session.id}</span>?
        </>
      ),
    });
    if (!ok) return;
    setActionBusy(true);
    try {
      const ses = await getSdk(apiOpts, session.workspace_id).session(session.id);
      await ses.addPeers(pid);
      push({ type: "success", message: `Added ${pid}` });
      setNewPeer("");
      refreshDetail();
      onDataChanged();
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    } finally {
      setActionBusy(false);
    }
  };

  const cloneSession = async () => {
    if (!apiOpts) return;
    const ok = await confirm({
      title: "CLONE_SESSION",
      confirmLabel: "CLONE",
      body: (
        <>
          Create a copy of session <span className="text-accent font-mono">{session.id}</span> (its
          peers and messages) on the live instance?
          {cloneScoped === "available" ? null : (
            <span className="block mt-2 text-text-muted">
              {cloneScoped === "unsupported"
                ? "This server is older than Honcho 3.3.0."
                : "This server's Honcho version is unverified."}{" "}
              Before 3.3.0, clone found its source by session name across all workspaces, so a
              same-named session elsewhere could be copied instead. Upgrade first or check the copy.
            </span>
          )}
        </>
      ),
    });
    if (!ok) return;
    setActionBusy(true);
    try {
      const ses = await getSdk(apiOpts, session.workspace_id).session(session.id);
      const cloned = await ses.clone();
      push({ type: "success", message: `Cloned to ${cloned.id}` });
      onDataChanged();
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <>
      <button className="w-full flex items-center gap-3 px-3 py-3 text-left" onClick={onToggle}>
        <div className="w-10 h-10 bg-blue-400/10 border border-blue-400/40 text-blue-400 flex items-center justify-center shrink-0">
          <Icon name="git-branch" size={14} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-text-primary font-mono truncate">{session.id}</span>
            <span className="text-[10px] text-text-muted">@{session.workspace_id}</span>
            <Chip tone={statusTone}>{status}</Chip>
            {detail.hasSummary ? (
              <Chip tone="purple" icon="book">
                SUMMARY
              </Chip>
            ) : null}
            {learningOffSource ? (
              <span title={`Honcho draws no conclusions from new messages here (set on the ${learningOffSource === "session" ? "session" : "workspace"}).`}>
                <Chip tone="warn" icon="brain">LEARNING_OFF</Chip>
              </span>
            ) : overrides ? (
              <span title="This session stores settings of its own. Open it and choose LEARNING.">
                <Chip tone="muted" icon="settings">SESSION_SETTINGS</Chip>
              </span>
            ) : null}
            {/* Honcho 3.5+: the scopes this session is an active member of. */}
            {(session.scopes ?? []).map((name) => (
              <Chip key={name} tone="muted" icon="focus">
                SCOPE · {name}
              </Chip>
            ))}
          </div>
          <div className="flex items-center gap-3 text-[10px] text-text-muted mt-1">
            <span className="flex items-center gap-1">
              <Icon name="users" size={10} /> {peers.length} peers
            </span>
            <span className="flex items-center gap-1">
              <Icon name="message-square" size={10} />{" "}
              {stat ? stat.message_count : "—"} msgs
            </span>
            <span>{stat ? `${(stat.token_sum / 1000).toFixed(1)}k tokens` : "— tokens"}</span>
          </div>
        </div>
        <div className="flex -space-x-1.5">
          {peers.slice(0, 3).map((p, idx) => (
            <div
              key={idx}
              className="w-6 h-6 border border-border bg-void flex items-center justify-center text-[9px] text-text-muted"
              title={p}
            >
              <PeerAvatar type={resolvePeerType(session.workspace_id, p)} />
            </div>
          ))}
        </div>
        <div className="text-right text-[10px] text-text-muted hidden sm:block">
          <div>last message</div>
          <div className="text-text-primary flex items-center gap-1 justify-end">
            <Icon name="clock" size={10} /> {lastMessage}
          </div>
        </div>
        <Icon
          name="chevron-right"
          className={cn("text-text-muted transition-transform", open && "rotate-90")}
          size={14}
        />
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="expanded"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="border-t border-border overflow-hidden bg-void/30"
          >
            <div className="p-3 space-y-3">
              <ServerUid uid={session.uid} className="justify-start gap-3" />
              <Tabs<RowTab>
                items={[
                  { key: "conversation", label: "CONVERSATION", icon: "message-square" },
                  { key: "learning", label: "LEARNING", icon: "brain" },
                ]}
                current={tab}
                onChange={setTab}
                layoutId={`session-tab-${session.workspace_id}-${session.id}`}
                ariaLabel={`Session ${session.id} view`}
              />
              {tab === "learning" ? (
                <SessionLearning
                  workspaceId={session.workspace_id}
                  sessionId={session.id}
                  workspaceConfig={workspaceConfig}
                  onSaved={onDataChanged}
                />
              ) : (
              <>
              <div>
                <div className="text-[10px] text-text-muted uppercase tracking-wider mb-2">
                  SESSION_PEERS ({peers.length})
                </div>
                {peers.length === 0 ? (
                  <div className="text-[11px] text-text-muted italic">No peers recorded for this session.</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {peers.map((p) => (
                      <span
                        key={p}
                        className="inline-flex items-center gap-2 px-2 py-1 bg-surface border border-border text-xs"
                      >
                        <PeerAvatar type={resolvePeerType(session.workspace_id, p)} size={12} />
                        {p}
                        {canWrite ? (
                          <button
                            onClick={() => removePeer(p)}
                            disabled={actionBusy}
                            className="text-text-muted hover:text-red-400 disabled:opacity-40"
                            aria-label={`Remove ${p}`}
                            title={`Remove ${p} from session`}
                          >
                            <Icon name="x" size={10} />
                          </button>
                        ) : null}
                      </span>
                    ))}
                  </div>
                )}
                {canWrite ? (
                  <div className="mt-2 flex items-center gap-2">
                    <TextInput
                      value={newPeer}
                      onChange={(e) => setNewPeer(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newPeer.trim() && !actionBusy) addPeer();
                      }}
                      placeholder="peer id to add…"
                      disabled={actionBusy}
                      className="max-w-[220px]"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      icon="plus"
                      onClick={addPeer}
                      disabled={!newPeer.trim() || actionBusy}
                    >
                      ADD_PEER
                    </Button>
                  </div>
                ) : null}
              </div>

              <SessionTranscript
                apiOpts={apiOpts}
                workspaceId={session.workspace_id}
                sessionId={session.id}
                peerKind={(peerId) => configuredPeerKind(session.workspace_id, peerId)}
                refreshKey={detailVersion}
              />

              {detail.summary ? (
                <div>
                  <div className="text-[10px] text-purple-400 uppercase tracking-wider mb-1">SUMMARY</div>
                  <div className="text-xs text-text-primary bg-surface border border-border px-3 py-2 line-clamp-4">
                    <Markdown inline text={detail.summary} />
                  </div>
                </div>
              ) : null}
              </>
              )}

              <div className="flex flex-wrap items-center gap-3 text-[10px] text-text-muted pt-2 border-t border-border">
                <span>
                  state:{" "}
                  <span className={session.is_active ? "text-accent" : "text-text-muted"}>
                    {session.is_active ? "active" : "inactive"}
                  </span>
                </span>
                <span>|</span>
                <span>
                  last message: <span className="text-text-primary">{lastMessage}</span>
                </span>
                <span>|</span>
                <span>
                  created: <span className="text-text-primary">{created}</span>
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" size="sm" onClick={onOpenMessages}>
                  VIEW_MESSAGES
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  icon="book"
                  onClick={() => setSummariesOpen(true)}
                  disabled={detail.loading && !detail.loaded}
                >
                  VIEW_SUMMARIES
                </Button>
                {canWrite ? (
                  <Button
                    variant="outline"
                    size="sm"
                    icon="upload"
                    onClick={() => setUploadOpen(true)}
                    disabled={actionBusy || peers.length === 0}
                    title={peers.length === 0 ? "Add a peer before uploading" : undefined}
                  >
                    UPLOAD_FILE
                  </Button>
                ) : null}
                {canWrite ? (
                  <Button
                    variant="outline"
                    size="sm"
                    icon="copy"
                    onClick={cloneSession}
                    disabled={actionBusy}
                  >
                    CLONE_SESSION
                  </Button>
                ) : null}
                {canWrite ? (
                  <Button
                    variant="warning"
                    size="sm"
                    icon="trash"
                    onClick={onRemove}
                    disabled={actionBusy}
                    className="ml-auto"
                  >
                    REMOVE_SESSION
                  </Button>
                ) : null}
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <Modal
        title="SESSION_SUMMARIES"
        open={summariesOpen}
        onClose={() => setSummariesOpen(false)}
        className="max-w-2xl"
        footer={
          <Button variant="secondary" onClick={() => setSummariesOpen(false)}>
            CLOSE
          </Button>
        }
      >
        <div className="text-[11px] text-text-muted leading-relaxed">
          Deriver-generated summaries for{" "}
          <span className="text-accent font-mono">{session.id}</span>. Short summaries compress recent
          turns; long summaries roll up the whole session.
        </div>
        {detail.error ? (
          <div className="mt-3 text-xs text-red-400">{detail.error}</div>
        ) : !detail.loaded ? (
          <div className="mt-3 space-y-2">
            <div className="h-4 w-32 bg-border/40 animate-pulse" />
            <div className="h-20 bg-border/40 animate-pulse" />
          </div>
        ) : detail.shortSummary || detail.longSummary ? (
          <div className="mt-3 space-y-4">
            {detail.shortSummary ? (
              <SummaryBlock label="SHORT_SUMMARY" summary={detail.shortSummary} />
            ) : null}
            {detail.longSummary ? (
              <SummaryBlock label="LONG_SUMMARY" summary={detail.longSummary} />
            ) : null}
          </div>
        ) : (
          <div className="mt-3 text-xs text-text-muted italic">
            No summaries for this session yet. {summaryCadence}
          </div>
        )}
      </Modal>

      <SessionFileUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        apiOpts={apiOpts}
        workspaceId={session.workspace_id}
        sessionId={session.id}
        peers={peers}
        onUploaded={() => {
          refreshDetail();
          onDataChanged();
        }}
      />
    </>
  );
}

interface SummaryView {
  content: string;
  tokenCount: number;
  createdAt: string;
}

function SummaryBlock({ label, summary }: { label: string; summary: SummaryView }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-purple-400 uppercase tracking-wider flex items-center gap-1">
          <Icon name="book" size={11} /> {label}
        </span>
        <span className="text-[10px] text-text-muted tabular-nums">
          {summary.tokenCount.toLocaleString()} tok · {new Date(summary.createdAt).toLocaleString()}
        </span>
      </div>
      <Markdown
        text={summary.content}
        className="text-xs text-text-primary bg-void border border-border px-3 py-2 max-h-72 overflow-y-auto"
      />
    </div>
  );
}
