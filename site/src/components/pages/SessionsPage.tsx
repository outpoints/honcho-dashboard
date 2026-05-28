"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Chip, Tabs, RefreshButton } from "@/components/atoms";
import { Select } from "@/components/Select";
import { Icon } from "@/components/icons";
import { ConfirmModal } from "@/components/ConfirmModal";
import { useToast } from "@/components/toast";
import { honcho as raw } from "@/lib/honcho/client";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { formatApiError, invalidate, useHonchoQuery } from "@/lib/honcho/useQuery";
import { useOperatorQuery } from "@/lib/operator/client";
import { getSdk } from "@/lib/honcho/sdk";
import { toApiSession, toApiMessage, toApiPeer } from "@/lib/honcho/adapters";
import type { ApiSession, ApiMessage } from "@/lib/honcho/types";
import type { HonchoClientOptions } from "@/lib/honcho/client";
import { useNav } from "@/lib/nav";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | "active" | "idle" | "archived";
type PeerType = "user" | "agent" | "unknown";

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

export function SessionsPage() {
  const apiOpts = useActiveHonchoOptions();
  const { workspaceId: activeWorkspaceId } = useActiveWorkspace();
  const { push } = useToast();
  const { navigate } = useNav();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [workspaceFilter, setWorkspaceFilter] = useState<string>("__active__");
  const [open, setOpen] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  // Workspace dropdown ("all" / each).
  const wsList = useHonchoQuery("workspaces/list?size=100", (o) =>
    raw.workspaces.list(o, { size: 100 }),
  );

  const targetWorkspaces = useMemo(() => {
    if (workspaceFilter === "all") return (wsList.data?.items ?? []).map((w) => w.id);
    if (workspaceFilter === "__active__") return activeWorkspaceId ? [activeWorkspaceId] : [];
    return [workspaceFilter];
  }, [workspaceFilter, activeWorkspaceId, wsList.data]);

  // Sessions + a peer-type map, fetched per targeted workspace and merged.
  const sessionsKey = targetWorkspaces.length ? `sdk/sessions/${targetWorkspaces.join(",")}` : null;
  const { data, error, isLoading, refetch } = useHonchoQuery<{
    items: ApiSession[];
    peerTypes: Record<string, PeerType>;
  }>(sessionsKey, async (o) => {
    const perWs = await Promise.all(
      targetWorkspaces.map(async (ws) => {
        const [sessions, peers] = await Promise.all([
          getSdk(o, ws)
            .sessions({ size: 100 })
            .then((p) => p.items.map((s) => toApiSession(s)))
            .catch(() => [] as ApiSession[]),
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
      };
    });
  }, [data?.items, statsMap]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return decorated.filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (q) {
        const hay = `${d.session.id} ${(d.stat?.peers ?? []).join(",")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [decorated, statusFilter, query]);

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
            placeholder="search sessions by id or peer name..."
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
            {query || statusFilter !== "all"
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
                whileHover={{ borderColor: "rgba(60, 130, 247, 0.5)" }}
                className="bg-surface border border-border transition-colors duration-150"
              >
                <SessionRow
                  session={d.session}
                  stat={d.stat}
                  status={d.status}
                  open={open === d.session.id}
                  onToggle={() => setOpen(open === d.session.id ? null : d.session.id)}
                  resolvePeerType={resolvePeerType}
                  apiOpts={apiOpts}
                  onRemove={() => setRemoveTarget(d.session.id)}
                  onOpenMessages={() => {
                    window.location.hash = `#/messages?session=${encodeURIComponent(d.session.id)}`;
                    navigate("messages");
                  }}
                  onPeerRemoved={() => {
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
  open,
  onToggle,
  resolvePeerType,
  apiOpts,
  onRemove,
  onOpenMessages,
  onPeerRemoved,
}: {
  session: ApiSession;
  stat?: SessionStatRow;
  status: StatusFilter;
  open: boolean;
  onToggle: () => void;
  resolvePeerType: (workspaceId: string, peerId: string) => PeerType;
  apiOpts: HonchoClientOptions | null;
  onRemove: () => void;
  onOpenMessages: () => void;
  onPeerRemoved: () => void;
}) {
  const [detail, setDetail] = useState<{
    loading: boolean;
    loaded: boolean;
    messages: ApiMessage[];
    hasSummary: boolean;
    summary: string | null;
    error?: string;
  }>({ loading: false, loaded: false, messages: [], hasSummary: false, summary: null });

  // Track which session we've already fetched detail for. Keeping detail.* out
  // of the effect deps avoids a self-cancellation race: setting loading=true
  // would otherwise re-run the effect, whose cleanup flips `cancelled` before
  // the in-flight request resolves.
  const fetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !apiOpts) return;
    const detailKey = `${session.workspace_id}::${session.id}`;
    if (fetchedRef.current === detailKey) return;
    fetchedRef.current = detailKey;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setDetail((d) => ({ ...d, loading: true, error: undefined }));
      (async () => {
        try {
          const ses = await getSdk(apiOpts, session.workspace_id).session(session.id);
          const [msgs, summaries] = await Promise.all([
            ses
              .messages({ size: 5, reverse: true })
              .then((p) => p.items.map((m) => toApiMessage(m)))
              .catch(() => []),
            ses.summaries().catch(() => null),
          ]);
          if (cancelled) return;
          const short = summaries?.shortSummary?.content ?? null;
          const long = summaries?.longSummary?.content ?? null;
          setDetail({
            loading: false,
            loaded: true,
            messages: msgs,
            hasSummary: !!(short || long),
            summary: short ?? long ?? null,
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
  }, [open, apiOpts, session.id, session.workspace_id]);

  const peers = stat?.peers ?? [];
  const configKeys = Object.keys(session.configuration ?? {}).length;
  const created = new Date(session.created_at).toLocaleString();
  const lastMessage = stat?.last_message_at ? new Date(stat.last_message_at).toLocaleString() : "—";
  const statusTone = status === "active" ? "accent" : status === "idle" ? "yellow" : "muted";

  const removePeer = async (peerId: string) => {
    if (!apiOpts) return;
    try {
      const ses = await getSdk(apiOpts, session.workspace_id).session(session.id);
      await ses.removePeers(peerId);
      onPeerRemoved();
    } catch {
      /* surfaced via the list refetch; row stays put on failure */
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
                        <button
                          onClick={() => removePeer(p)}
                          className="text-text-muted hover:text-red-400"
                          aria-label={`Remove ${p}`}
                          title={`Remove ${p} from session`}
                        >
                          <Icon name="x" size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="text-[10px] text-text-muted uppercase tracking-wider mb-2">
                  RECENT_MESSAGES{detail.loaded ? ` (${detail.messages.length})` : ""}
                </div>
                {detail.loading && !detail.loaded ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="h-9 bg-border/40 animate-pulse" />
                    ))}
                  </div>
                ) : detail.error ? (
                  <div className="text-[11px] text-red-400">{detail.error}</div>
                ) : detail.messages.length === 0 ? (
                  <div className="text-[11px] text-text-muted italic">No messages in this session yet.</div>
                ) : (
                  <div className="space-y-2">
                    {detail.messages.map((m) => (
                      <div
                        key={m.id}
                        className="px-3 py-2 bg-surface border-l-2 border-blue-400/50 border-y border-r border-border"
                      >
                        <div className="flex items-center gap-2 mb-1 text-[10px]">
                          <PeerAvatar type={resolvePeerType(session.workspace_id, m.peer_id)} />
                          <span className="text-text-primary">{m.peer_id}</span>
                          <span className="text-text-muted">{new Date(m.created_at).toLocaleString()}</span>
                          <Chip tone="muted">{m.token_count} tok</Chip>
                        </div>
                        <div className="text-xs text-text-primary line-clamp-3">{m.content}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {detail.summary ? (
                <div>
                  <div className="text-[10px] text-purple-400 uppercase tracking-wider mb-1">SUMMARY</div>
                  <div className="text-xs text-text-primary bg-surface border border-border px-3 py-2 line-clamp-4">
                    {detail.summary}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-3 text-[10px] text-text-muted pt-2 border-t border-border">
                <span>
                  state:{" "}
                  <span className={session.is_active ? "text-accent" : "text-text-muted"}>
                    {session.is_active ? "active" : "inactive"}
                  </span>
                </span>
                <span>|</span>
                <span>
                  config:{" "}
                  <span className="text-text-primary">
                    {configKeys ? `${configKeys} keys` : "default"}
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

              <div className="flex items-center gap-2">
                <Button variant="primary" size="sm" onClick={onOpenMessages}>
                  VIEW_MESSAGES
                </Button>
                <Button variant="warning" size="sm" icon="trash" onClick={onRemove}>
                  REMOVE_SESSION
                </Button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
