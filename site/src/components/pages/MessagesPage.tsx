"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Chip, Field, RefreshButton } from "@/components/atoms";
import { Select } from "@/components/Select";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { formatApiError, useHonchoQuery } from "@/lib/honcho/useQuery";
import { useOperatorQuery } from "@/lib/operator/client";
import { getSdk } from "@/lib/honcho/sdk";
import { toApiSession, toApiPeer, toApiMessage } from "@/lib/honcho/adapters";
import type { ApiSession, ApiPeer } from "@/lib/honcho/types";
import { cn } from "@/lib/utils";

type PeerType = "user" | "agent" | "unknown";

interface StreamMessage {
  id: string;
  peer_id: string;
  session_id: string;
  content: string;
  token_count: number;
  created_at: string;
}

interface MessagesResp {
  available: boolean;
  reason?: string;
  messages?: StreamMessage[];
}

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

function readHashParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(new RegExp(`[?&]${key}=([^&]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function subscribeHash(notify: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
}

export function MessagesPage() {
  const apiOpts = useActiveHonchoOptions();
  const { workspaceId } = useActiveWorkspace();
  const { push } = useToast();

  const hashSession = useSyncExternalStore(subscribeHash, () => readHashParam("session"), () => null);
  const hashPeer = useSyncExternalStore(subscribeHash, () => readHashParam("peer"), () => null);

  const [query, setQuery] = useState("");
  const [sessionOverride, setSessionOverride] = useState<string | null>(null);
  const [peerFilter, setPeerFilter] = useState<string | null>(null);

  // Effective session filter: explicit dropdown choice wins, else the hash link.
  const sessionFilter = sessionOverride ?? hashSession ?? "";
  const effectivePeer = peerFilter ?? hashPeer ?? null;

  // Sessions + peer-type map for the workspace.
  const metaKey = workspaceId ? `sdk/messages-meta/${workspaceId}` : null;
  const meta = useHonchoQuery<{ sessions: ApiSession[]; peerTypes: Record<string, PeerType> }>(
    metaKey,
    async (o) => {
      const [sessions, peers] = await Promise.all([
        getSdk(o, workspaceId!)
          .sessions({ size: 100 })
          .then((p) => p.items.map((s) => toApiSession(s)))
          .catch(() => [] as ApiSession[]),
        getSdk(o, workspaceId!)
          .peers({ size: 100 })
          .then((p) => p.items.map((peer) => toApiPeer(peer)))
          .catch(() => [] as ApiPeer[]),
      ]);
      const peerTypes: Record<string, PeerType> = {};
      for (const p of peers) peerTypes[p.id] = classifyPeerConfig(p.configuration);
      return { sessions, peerTypes };
    },
  );

  // Cross-session message stream from the operator/db layer.
  const opPath = workspaceId
    ? `/api/operator/db?view=messages&workspace_id=${encodeURIComponent(workspaceId)}${
        sessionFilter ? `&session_id=${encodeURIComponent(sessionFilter)}` : ""
      }`
    : null;
  const op = useOperatorQuery<MessagesResp>(opPath);

  // Fallback to SDK per-session messages when the DB layer is unavailable.
  const opUnavailable = !!op.data && !op.data.available;
  const sdkKey =
    workspaceId && sessionFilter && opUnavailable
      ? `sdk/workspaces/${workspaceId}/sessions/${sessionFilter}/messages/list`
      : null;
  const sdk = useHonchoQuery<StreamMessage[]>(sdkKey, async (o) => {
    const ses = await getSdk(o, workspaceId!).session(sessionFilter);
    const page = await ses.messages({ size: 100 });
    return page.items.map((m) => {
      const am = toApiMessage(m);
      return {
        id: am.id,
        peer_id: am.peer_id,
        session_id: am.session_id,
        content: am.content,
        token_count: am.token_count,
        created_at: am.created_at,
      };
    });
  });

  const streamLoading = op.isLoading || (opUnavailable && sdk.isLoading);
  const rawMessages: StreamMessage[] = op.data?.available
    ? op.data.messages ?? []
    : opUnavailable
      ? sdk.data ?? []
      : [];

  const resolveType = useMemo(() => {
    const map = meta.data?.peerTypes ?? {};
    return (peerId: string): PeerType => {
      const t = map[peerId];
      if (t && t !== "unknown") return t;
      return nameLooksAgent(peerId) ? "agent" : "user";
    };
  }, [meta.data?.peerTypes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rawMessages.filter((m) => {
      if (effectivePeer && m.peer_id !== effectivePeer) return false;
      if (q && !m.content.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rawMessages, query, effectivePeer]);

  const stats = useMemo(() => {
    let tokens = 0;
    let users = 0;
    let agents = 0;
    for (const m of filtered) {
      tokens += m.token_count;
      if (resolveType(m.peer_id) === "agent") agents += 1;
      else users += 1;
    }
    return { total: filtered.length, tokens, users, agents };
  }, [filtered, resolveType]);

  const sessionOptions = useMemo(
    () => [
      { value: "", label: "all sessions" },
      ...(meta.data?.sessions ?? []).map((s) => ({ value: s.id, label: s.id })),
    ],
    [meta.data?.sessions],
  );

  const streamError = op.data?.available === false && opUnavailable ? sdk.error : op.error;

  return (
    <div className="space-y-3">
      <PageHeader
        title="MESSAGES"
        subtitle="view and create messages within sessions"
        actions={
          <RefreshButton
            label="REFRESH"
            onClick={() => {
              op.refetch();
              sdk.refetch();
            }}
          />
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] flex items-center gap-2 bg-void border border-border px-3 py-2">
          <Icon name="search" className="text-text-muted" size={12} />
          <input
            placeholder="search message content..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="bg-transparent text-xs flex-1 outline-none placeholder:text-text-muted"
          />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-text-muted">session:</span>
          <Select
            value={sessionFilter}
            onChange={(id) => {
              setSessionOverride(id);
              window.location.hash = id ? `#/messages?session=${encodeURIComponent(id)}` : "#/messages";
            }}
            options={sessionOptions}
            className="min-w-[180px]"
            triggerClassName="py-1.5"
          />
        </div>
        {effectivePeer ? (
          <button
            onClick={() => {
              setPeerFilter(null);
              if (hashPeer) window.location.hash = "#/messages";
            }}
            className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-accent border border-accent/30 bg-accent/10 px-2 py-1"
            title="Clear peer filter"
          >
            peer: {effectivePeer}
            <Icon name="x" size={10} />
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 lg:col-span-8">
          <Panel title="MESSAGE_STREAM" bodyClassName="p-0">
            {!workspaceId ? (
              <div className="text-xs text-text-muted py-8 text-center">Select a workspace in the sidebar.</div>
            ) : streamError ? (
              <div className="text-xs text-red-400 p-3">{formatApiError(streamError)}</div>
            ) : opUnavailable && !sessionFilter ? (
              <div className="text-xs text-text-muted py-8 px-3 text-center">
                Cross-session stream needs the operator DB ({op.data?.reason}). Pick a session to
                view its messages via the API.
              </div>
            ) : streamLoading ? (
              <div className="p-3 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-14 bg-border/40 animate-pulse" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-xs text-text-muted py-8 text-center">
                {query || effectivePeer ? "No messages match the filter." : "No messages yet."}
              </div>
            ) : (
              <div className="max-h-[600px] overflow-y-auto">
                <AnimatePresence initial={false}>
                  {filtered.map((m, i) => {
                    const type = resolveType(m.peer_id);
                    const isUser = type !== "agent";
                    return (
                      <motion.div
                        key={m.id}
                        layout
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: Math.min(i * 0.03, 0.3), duration: 0.2 }}
                        className={cn(
                          "flex gap-3 px-3 py-3 border-b border-border hover:bg-border/20 transition-colors duration-150 border-l-2",
                          isUser ? "border-l-blue-400/60" : "border-l-purple-400/60",
                        )}
                      >
                        <div
                          className={cn(
                            "w-8 h-8 border flex items-center justify-center shrink-0",
                            isUser
                              ? "border-blue-400/40 text-blue-400 bg-blue-400/5"
                              : "border-purple-400/40 text-purple-400 bg-purple-400/5",
                          )}
                        >
                          <Icon name={isUser ? "user" : "bot"} size={12} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-[10px] mb-1 flex-wrap">
                            <span className="text-text-primary text-xs">{m.peer_id}</span>
                            <span className="text-text-muted">in {m.session_id}</span>
                            <span className="flex items-center gap-1 text-text-muted">
                              <Icon name="clock" size={10} /> {new Date(m.created_at).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-sm text-text-primary leading-relaxed break-words whitespace-pre-wrap">
                            {m.content}
                          </p>
                          <div className="flex items-center gap-2 mt-2 text-[10px]">
                            <Chip tone={isUser ? "blue" : "purple"}>{isUser ? "user" : "agent"}</Chip>
                            <span className="text-text-muted">{m.token_count} tokens</span>
                            <span className="text-text-muted">#{m.id}</span>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </Panel>
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-3">
          <ComposePanel
            workspaceId={workspaceId}
            sessionId={sessionFilter}
            peers={meta.data?.sessions ? meta.data : null}
            apiOpts={apiOpts}
            onSent={() => {
              op.refetch();
              sdk.refetch();
              push({ type: "success", message: "Message added" });
            }}
          />
          <Panel title="MESSAGE_STATS">
            <div className="space-y-2 text-xs">
              {[
                ["total_displayed", String(stats.total), false],
                ["total_tokens", stats.tokens.toLocaleString(), false],
                ["user_messages", String(stats.users), true],
                ["agent_messages", String(stats.agents), false],
              ].map(([k, v, accent]) => (
                <div
                  key={k as string}
                  className="flex justify-between py-1.5 border-b border-border last:border-0"
                >
                  <span className="text-text-muted">{k}</span>
                  <span className={cn("text-text-primary tabular-nums", accent && "text-accent")}>{v}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <StatusBar />
    </div>
  );
}

function ComposePanel({
  workspaceId,
  sessionId,
  peers,
  apiOpts,
  onSent,
}: {
  workspaceId: string | null;
  sessionId: string;
  peers: { peerTypes: Record<string, PeerType> } | null;
  apiOpts: ReturnType<typeof useActiveHonchoOptions>;
  onSent: () => void;
}) {
  const { push } = useToast();
  const [peerId, setPeerId] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);

  const peerOptions = useMemo(() => {
    const ids = Object.keys(peers?.peerTypes ?? {});
    return ids.map((id) => ({ value: id, label: id }));
  }, [peers]);

  if (!sessionId) {
    return (
      <Panel title="COMPOSE_MESSAGE">
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <Icon name="message-square" className="text-text-muted" size={24} />
          <p className="text-xs text-text-muted text-center">Select a session to compose messages</p>
        </div>
      </Panel>
    );
  }

  const send = async () => {
    if (!apiOpts || !workspaceId) return;
    const peer = peerId || peerOptions[0]?.value;
    if (!peer) {
      push({ type: "error", message: "Pick a peer to author the message" });
      return;
    }
    if (!content.trim()) {
      push({ type: "error", message: "Message content is required" });
      return;
    }
    setBusy(true);
    try {
      const ses = await getSdk(apiOpts, workspaceId).session(sessionId);
      await ses.addMessages([{ peerId: peer, content: content.trim() }]);
      setContent("");
      onSent();
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="COMPOSE_MESSAGE">
      <div className="space-y-3">
        <Field label="AUTHOR_PEER">
          <Select
            value={peerId || peerOptions[0]?.value || ""}
            onChange={setPeerId}
            options={peerOptions.length ? peerOptions : [{ value: "", label: "no peers" }]}
            className="w-full"
          />
        </Field>
        <Field label="CONTENT" hint={`session: ${sessionId}`}>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="type a message…"
            rows={4}
            className="w-full bg-void border border-border px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent outline-none transition-colors duration-150 resize-y"
          />
        </Field>
        <div className="flex justify-end">
          <Button variant="primary" icon="message-square" onClick={send} disabled={busy}>
            {busy ? "SENDING…" : "SEND"}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
