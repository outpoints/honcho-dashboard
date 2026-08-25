"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Field } from "@/components/atoms";
import { Select } from "@/components/Select";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { formatApiError, useHonchoQuery } from "@/lib/honcho/useQuery";
import { getSdk } from "@/lib/honcho/sdk";
import { toApiPeer, toApiPeerContext, toApiSession, toApiSessionContext } from "@/lib/honcho/adapters";
import type { ApiPeer, ApiSession, ApiMessage } from "@/lib/honcho/types";
import { cn } from "@/lib/utils";

type LayerId = "peer_card" | "conclusions" | "summaries" | "messages";

// Match the easing/timing used by Panel + the rest of the app (see DESIGN_GUIDE §8).
const EASE = [0.25, 0.46, 0.45, 0.94] as const;

const LAYER_TONE: Record<LayerId, string> = {
  peer_card: "bg-blue-400 text-blue-400 border-blue-400/40",
  conclusions: "bg-purple-400 text-purple-400 border-purple-400/40",
  summaries: "bg-cyan-400 text-cyan-400 border-cyan-400/40",
  messages: "bg-text-muted text-text-muted border-border-light",
};

const ICONS: Record<LayerId, "user" | "brain" | "book" | "message-square"> = {
  peer_card: "user",
  conclusions: "brain",
  summaries: "book",
  messages: "message-square",
};

const LAYER_META: { id: LayerId; label: string; description: string }[] = [
  { id: "peer_card", label: "PEER_CARD", description: "Cached biographical facts and traits about the peer." },
  { id: "conclusions", label: "CONCLUSIONS", description: "Derived representation — what Honcho has concluded about the peer." },
  { id: "summaries", label: "SUMMARIES", description: "Compressed summary of earlier conversation in the session." },
  { id: "messages", label: "MESSAGES", description: "Recent raw messages providing conversational continuity." },
];

interface Layer {
  id: LayerId;
  label: string;
  description: string;
  tokens: number;
  items: number;
  enabled: boolean;
  estimated: boolean;
  text: string;
}

const estTokens = (s?: string | null) => (s ? Math.ceil(s.length / 4) : 0);

function readHashParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(new RegExp(`[?&]${key}=([^&]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function ContextPage() {
  const apiOpts = useActiveHonchoOptions();
  const { workspaceId } = useActiveWorkspace();
  const { push } = useToast();

  const [sessionId, setSessionId] = useState<string>("");
  const [peerId, setPeerId] = useState<string>("");
  const [tokenLimit, setTokenLimit] = useState(4000);
  const [layers, setLayers] = useState<Layer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped on every successful generate so the layer cards + bars re-run their
  // entrance animation (used as part of their motion keys).
  const [runId, setRunId] = useState(0);

  // Preselect from cross-links (#/context?peer=… / ?session=…).
  useEffect(() => {
    const p = readHashParam("peer");
    const s = readHashParam("session");
    if (p) setPeerId(p);
    if (s) setSessionId(s);
  }, []);

  const peers = useHonchoQuery<{ items: ApiPeer[] }>(
    workspaceId ? `sdk/workspaces/${workspaceId}/peers/list?ctx` : null,
    async (o) => ({ items: (await getSdk(o, workspaceId!).peers({ size: 100 })).items.map(toApiPeer) }),
  );
  const sessions = useHonchoQuery<{ items: ApiSession[] }>(
    workspaceId ? `sdk/workspaces/${workspaceId}/sessions/list?ctx` : null,
    async (o) => ({ items: (await getSdk(o, workspaceId!).sessions({ size: 100, reverse: true })).items.map(toApiSession) }),
  );

  const total = useMemo(
    () => (layers ?? []).filter((l) => l.enabled).reduce((s, l) => s + l.tokens, 0),
    [layers],
  );
  const overLimit = total > tokenLimit;

  const generate = async () => {
    if (!apiOpts || !workspaceId) return;
    if (!sessionId && !peerId) {
      push({ type: "error", message: "Pick a session and/or a peer first" });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sdk = getSdk(apiOpts, workspaceId);
      let peerCard: string[] = [];
      let representation = "";
      let summaryText = "";
      let summaryTokens = 0;
      let messages: ApiMessage[] = [];

      if (sessionId) {
        const ses = await sdk.session(sessionId);
        const ctx = toApiSessionContext(
          await ses.context({
            summary: true,
            tokens: tokenLimit,
            ...(peerId ? { peerTarget: peerId, peerPerspective: peerId } : {}),
          }),
        );
        peerCard = ctx.peer_card ?? [];
        representation = ctx.peer_representation ?? "";
        summaryText = ctx.summary?.content ?? "";
        summaryTokens = ctx.summary?.token_count ?? 0;
        messages = ctx.messages;
      } else if (peerId) {
        const peer = await sdk.peer(peerId);
        const ctx = toApiPeerContext(await peer.context());
        peerCard = ctx.peer_card ?? [];
        representation = ctx.representation ?? "";
      }

      const messagesText = messages
        .map((m) => `${m.peer_id}: ${m.content}`)
        .join("\n");
      const built: Layer[] = LAYER_META.map((meta) => {
        switch (meta.id) {
          case "peer_card":
            return {
              ...meta,
              tokens: estTokens(peerCard.join("\n")),
              items: peerCard.length,
              enabled: true,
              estimated: true,
              text: peerCard.map((l) => `• ${l}`).join("\n"),
            };
          case "conclusions":
            return {
              ...meta,
              tokens: estTokens(representation),
              items: representation ? representation.split(/\n+/).filter(Boolean).length : 0,
              enabled: true,
              estimated: true,
              text: representation,
            };
          case "summaries":
            return {
              ...meta,
              tokens: summaryTokens,
              items: summaryText ? 1 : 0,
              enabled: true,
              estimated: false,
              text: summaryText,
            };
          case "messages":
          default:
            return {
              ...meta,
              tokens: messages.reduce((s, m) => s + m.token_count, 0),
              items: messages.length,
              enabled: true,
              estimated: false,
              text: messagesText,
            };
        }
      });
      setLayers(built);
      setRunId((r) => r + 1);
    } catch (err) {
      setError(formatApiError(err));
      setLayers(null);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: LayerId) =>
    setLayers((cur) => cur?.map((l) => (l.id === id ? { ...l, enabled: !l.enabled } : l)) ?? null);

  const sessionOptions = [
    { value: "", label: "— none —" },
    ...(sessions.data?.items ?? []).map((s) => ({ value: s.id, label: s.id })),
  ];
  const peerOptions = [
    { value: "", label: "— none —" },
    ...(peers.data?.items ?? []).map((p) => ({ value: p.id, label: p.id })),
  ];

  const previewLayers = (layers ?? []).filter((l) => l.enabled && l.text.trim());

  return (
    <div className="space-y-3">
      <PageHeader
        title="CONTEXT"
        subtitle="assemble LLM-ready context from peer representations, conclusions, summaries, and messages"
        actions={
          <div className="flex items-center gap-2 text-xs">
            <Icon name="layers" size={12} className="text-text-muted" />
            <span className={cn("font-pixel text-lg", overLimit ? "text-red-400" : "text-accent")}>
              {total.toLocaleString()}
            </span>
            <span className="text-text-muted">/ {tokenLimit.toLocaleString()} tokens</span>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <Field label="SESSION">
          <Select
            value={sessionId}
            onChange={setSessionId}
            options={sessionOptions}
            disabled={!workspaceId}
            placeholder="select a session…"
          />
        </Field>
        <Field label="PEER">
          <Select
            value={peerId}
            onChange={setPeerId}
            options={peerOptions}
            disabled={!workspaceId}
            placeholder="select a peer…"
          />
        </Field>
        <Field label="TOKEN_LIMIT" hint={<span className="tabular-nums">{tokenLimit}</span>}>
          <input
            type="range"
            min={500}
            max={10000}
            step={250}
            value={tokenLimit}
            onChange={(e) => setTokenLimit(parseInt(e.target.value))}
            className="w-full accent-accent"
          />
        </Field>
        <Button
          variant="primary"
          icon="sparkles"
          className="self-end"
          onClick={generate}
          disabled={busy || !workspaceId || (!sessionId && !peerId)}
        >
          {busy ? "GENERATING…" : "GENERATE_CONTEXT"}
        </Button>
      </div>

      {error ? (
        <Panel title="ERROR" status="processing">
          <div className="text-xs text-red-400">{error}</div>
        </Panel>
      ) : null}

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 lg:col-span-7 space-y-3">
          <Panel title="CONTEXT_LAYERS">
            {busy ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="p-3 border border-border bg-void/30">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="h-3 w-3 bg-border/60 animate-pulse" />
                      <div className="h-3 w-24 bg-border/60 animate-pulse" />
                      <div className="ml-auto h-3 w-28 bg-border/40 animate-pulse" />
                    </div>
                    <div className="h-2 bg-border/40 animate-pulse mb-2" />
                    <div className="h-2 w-2/3 bg-border/30 animate-pulse" />
                  </div>
                ))}
              </div>
            ) : !layers ? (
              <div className="text-[11px] text-text-muted py-6 text-center">
                Select a session and/or peer, then GENERATE_CONTEXT to assemble the layers.
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  {layers.map((layer, i) => {
                    const [bg, text, border] = LAYER_TONE[layer.id].split(" ");
                    const pct = Math.min(100, (layer.tokens / 3000) * 100);
                    return (
                      <motion.div
                        key={`${runId}-${layer.id}`}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.06, duration: 0.25, ease: EASE }}
                        className={cn(
                          "p-3 border bg-void/30 hover:bg-void/50 transition-colors duration-150",
                          border,
                        )}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Icon name={ICONS[layer.id]} className={text} size={14} />
                          <span className={cn("text-sm uppercase tracking-wider", text)}>{layer.label}</span>
                          <span className="text-[10px] text-text-muted">({layer.id})</span>
                          <span className="ml-auto text-[10px] text-text-muted">
                            {layer.estimated ? "~" : ""}
                            {layer.tokens.toLocaleString()} tokens · {layer.items} items
                          </span>
                          <button
                            onClick={() => toggle(layer.id)}
                            className={cn(
                              "ml-2 w-7 h-5 border flex items-center justify-center transition-colors duration-150",
                              layer.enabled ? "border-accent text-accent" : "border-border text-text-muted",
                            )}
                            aria-label={`Toggle ${layer.id}`}
                          >
                            <Icon name="eye" size={10} />
                          </button>
                        </div>
                        <div className="relative h-2 bg-border mb-2 overflow-hidden">
                          <motion.div
                            className={cn("absolute inset-y-0 left-0", bg)}
                            initial={{ width: 0, opacity: layer.enabled ? 0.7 : 0.2 }}
                            animate={{ width: `${pct}%`, opacity: layer.enabled ? 0.7 : 0.2 }}
                            transition={{
                              width: { delay: i * 0.06 + 0.12, duration: 0.45, ease: EASE },
                              opacity: { duration: 0.2, ease: EASE },
                            }}
                          />
                        </div>
                        <p className="text-[11px] text-text-muted">{layer.description}</p>
                      </motion.div>
                    );
                  })}
                </div>
                <div className="mt-4 pt-3 border-t border-border">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-text-muted uppercase tracking-wider">total_enabled</span>
                    <span className={overLimit ? "text-red-400" : "text-accent"}>
                      {total.toLocaleString()} / {tokenLimit.toLocaleString()} tokens
                    </span>
                  </div>
                  <div className="relative h-1 bg-border mt-1.5 overflow-hidden">
                    <motion.div
                      className={cn("absolute inset-y-0 left-0", overLimit ? "bg-red-500" : "bg-accent")}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, (total / tokenLimit) * 100)}%` }}
                      transition={{ duration: 0.4, ease: EASE }}
                    />
                  </div>
                  {overLimit ? (
                    // Render conditionally (no AnimatePresence) so a stale "exceeds limit"
                    // warning can never linger once the total drops back under the limit.
                    <motion.p
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, ease: EASE }}
                      className="mt-2 text-[10px] text-yellow-400 flex items-center gap-1"
                    >
                      <Icon name="warning" size={10} /> exceeds token limit — lower-priority layers will be
                      truncated
                    </motion.p>
                  ) : null}
                </div>
              </>
            )}
          </Panel>
        </div>

        <div className="col-span-12 lg:col-span-5 space-y-3">
          <Panel
            title="CONTEXT_PREVIEW"
            delay={0.05}
            bodyClassName={previewLayers.length || busy ? undefined : "p-0"}
          >
            {busy ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-3 bg-border/40 animate-pulse"
                    style={{ width: `${90 - (i % 3) * 18}%` }}
                  />
                ))}
              </div>
            ) : previewLayers.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25, ease: EASE }}
                className="flex flex-col items-center justify-center py-12 gap-2"
              >
                <Icon name="eye" className="text-text-muted" size={28} />
                <p className="text-sm text-text-muted">No context generated yet</p>
                <p className="text-[10px] text-text-muted">
                  Select session &amp; peer, then click GENERATE_CONTEXT
                </p>
              </motion.div>
            ) : (
              <div className="max-h-[420px] overflow-y-auto space-y-3">
                {previewLayers.map((l, i) => {
                  const [, text] = LAYER_TONE[l.id].split(" ");
                  return (
                    <motion.div
                      key={`${runId}-${l.id}`}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.06, duration: 0.25, ease: EASE }}
                    >
                      <div className={cn("text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1", text)}>
                        <Icon name={ICONS[l.id]} size={10} /> {l.label}
                      </div>
                      <pre className="text-[11px] text-text-primary whitespace-pre-wrap break-words leading-relaxed">
                        {l.text}
                      </pre>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel title="HOW_CONTEXT_WORKS" delay={0.1}>
            <div className="space-y-2 text-[11px]">
              <Line code="PCD" label="Peer cards cache basic biographical info about a peer — name, traits, preferences" />
              <Line code="CON" label="Conclusions are derived from the peer's representation as Honcho observes them" />
              <Line code="SUM" label="Summaries compress conversation history into digestible overviews" />
              <Line code="MSG" label="Messages provide recent conversational context for continuity" />
              <p className="text-text-muted leading-snug pt-2 border-t border-border">
                Layers are assembled in priority order: peer_card → conclusions → summaries → messages. If
                total tokens exceed the limit, lower-priority layers are truncated first.
              </p>
            </div>
          </Panel>

          {layers ? (
            <Panel title="LAYER_STATS" delay={0.15}>
              <div className="space-y-1.5 text-[11px]">
                {layers.map((l, i) => (
                  <motion.div
                    key={`${runId}-${l.id}`}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05, duration: 0.2, ease: EASE }}
                    className="flex items-center justify-between"
                  >
                    <span className="flex items-center gap-2">
                      <span className={cn("w-2 h-2", LAYER_TONE[l.id].split(" ")[0])} />
                      <span className="text-text-muted">{l.id}</span>
                    </span>
                    <span className="text-text-primary tabular-nums">
                      {l.estimated ? "~" : ""}
                      {l.tokens.toLocaleString()} tok / {l.items} items
                    </span>
                  </motion.div>
                ))}
              </div>
            </Panel>
          ) : null}
        </div>
      </div>

      <StatusBar />
    </div>
  );
}

function Line({ code, label }: { code: string; label: string }) {
  const tone = code === "PCD" ? "blue" : code === "CON" ? "purple" : code === "SUM" ? "cyan" : "muted";
  const cls: Record<string, string> = {
    blue: "bg-blue-400/10 text-blue-400 border-blue-400/40",
    purple: "bg-purple-400/10 text-purple-400 border-purple-400/40",
    cyan: "bg-cyan-400/10 text-cyan-400 border-cyan-400/40",
    muted: "bg-border text-text-muted border-border-light",
  };
  return (
    <div className="flex items-start gap-2">
      <span className={cn("px-1.5 py-0.5 text-[9px] uppercase tracking-wider border", cls[tone])}>{code}</span>
      <p className="text-text-muted leading-snug flex-1">{label}</p>
    </div>
  );
}
