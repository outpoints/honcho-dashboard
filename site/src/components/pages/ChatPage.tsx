"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Field, TextInput } from "@/components/atoms";
import { Select } from "@/components/Select";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { formatApiError, useHonchoQuery } from "@/lib/honcho/useQuery";
import { getSdk } from "@/lib/honcho/sdk";
import { toApiPeer, toApiSession } from "@/lib/honcho/adapters";
import type { ApiPeer, ApiSession } from "@/lib/honcho/types";
import { cn } from "@/lib/utils";

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

type ReasoningLevel = "minimal" | "low" | "medium" | "high" | "max";
const REASONING_LEVELS: ReasoningLevel[] = ["minimal", "low", "medium", "high", "max"];

interface Turn {
  id: string;
  role: "user" | "assistant";
  content: string;
}

function readHashParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(new RegExp(`[?&]${key}=([^&]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Memory-augmented chat: queries a peer's representation through Honcho's
 * dialectic endpoint (`peer.chat`). This is a READ — it does not write messages
 * or memory — so it needs no write-gate or confirm.
 */
export function ChatPage() {
  const apiOpts = useActiveHonchoOptions();
  const { workspaceId } = useActiveWorkspace();
  const { push } = useToast();

  const [peerId, setPeerId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [level, setLevel] = useState<ReasoningLevel>("low");
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const p = readHashParam("peer");
    const s = readHashParam("session");
    if (p) setPeerId(p);
    if (s) setSessionId(s);
  }, []);

  // Auto-scroll the transcript to the latest turn.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  const peers = useHonchoQuery<{ items: ApiPeer[] }>(
    workspaceId ? `sdk/workspaces/${workspaceId}/peers/list?chat` : null,
    async (o) => ({ items: (await getSdk(o, workspaceId!).peers({ size: 100 })).items.map(toApiPeer) }),
  );
  const sessions = useHonchoQuery<{ items: ApiSession[] }>(
    workspaceId ? `sdk/workspaces/${workspaceId}/sessions/list?chat` : null,
    async (o) => ({ items: (await getSdk(o, workspaceId!).sessions({ size: 100 })).items.map(toApiSession) }),
  );

  const peerOptions = useMemo(
    () => (peers.data?.items ?? []).map((p) => ({ value: p.id, label: p.id })),
    [peers.data],
  );
  const sessionOptions = useMemo(
    () => [
      { value: "", label: "— whole peer —" },
      ...(sessions.data?.items ?? []).map((s) => ({ value: s.id, label: s.id })),
    ],
    [sessions.data],
  );

  const send = async () => {
    const query = input.trim();
    if (!apiOpts || !workspaceId) {
      push({ type: "error", message: "Select an active instance and workspace first" });
      return;
    }
    if (!peerId) {
      push({ type: "error", message: "Pick a peer to chat with" });
      return;
    }
    if (!query || busy) return;

    const userTurn: Turn = { id: `u-${Date.now()}`, role: "user", content: query };
    setTurns((cur) => [...cur, userTurn]);
    setInput("");
    setBusy(true);
    try {
      const peer = await getSdk(apiOpts, workspaceId).peer(peerId);
      const reply = await peer.chat(query, {
        ...(sessionId ? { session: sessionId } : {}),
        reasoningLevel: level,
      });
      setTurns((cur) => [
        ...cur,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: reply && reply.trim() ? reply : "(no answer — the peer has no relevant memory)",
        },
      ]);
    } catch (err) {
      setTurns((cur) => [
        ...cur,
        { id: `e-${Date.now()}`, role: "assistant", content: `⚠ ${formatApiError(err)}` },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const canSend = !!workspaceId && !!peerId && !!input.trim() && !busy;

  return (
    <div className="space-y-3">
      <PageHeader
        title="CHAT"
        subtitle="ask a peer about itself — memory-augmented dialectic chat over its representation"
        actions={
          turns.length > 0 ? (
            <Button variant="ghost" icon="x" onClick={() => setTurns([])}>
              CLEAR
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <Field label="PEER" hint="The peer whose memory you are querying.">
          <Select
            value={peerId}
            onChange={setPeerId}
            options={peerOptions}
            disabled={!workspaceId}
            placeholder="select a peer…"
          />
        </Field>
        <Field label="SESSION" hint="Optional — scope the query to one session.">
          <Select
            value={sessionId}
            onChange={setSessionId}
            options={sessionOptions}
            disabled={!workspaceId}
            placeholder="— whole peer —"
          />
        </Field>
        <Field label="REASONING_LEVEL" hint="Higher levels reason harder but cost more.">
          <Select
            value={level}
            onChange={(v) => setLevel(v as ReasoningLevel)}
            options={REASONING_LEVELS.map((l) => ({ value: l, label: l }))}
          />
        </Field>
      </div>

      <Panel title="TRANSCRIPT" status={busy ? "processing" : "active"}>
        <div ref={scrollRef} className="max-h-[460px] min-h-[200px] overflow-y-auto space-y-3 pr-1">
          {turns.length === 0 && !busy ? (
            <div className="flex flex-col items-center justify-center py-14 gap-2">
              <Icon name="bot" className="text-text-muted" size={28} />
              <p className="text-sm text-text-muted">No messages yet</p>
              <p className="text-[10px] text-text-muted">
                Pick a peer and ask something like &quot;what do you know about me?&quot;
              </p>
            </div>
          ) : (
            turns.map((t) => <Bubble key={t.id} turn={t} />)
          )}
          {busy ? (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="flex items-center gap-2 text-[11px] text-text-muted"
            >
              <Icon name="loader" size={12} className="animate-spin" />
              <span className="cursor-blink">THINKING</span>
            </motion.div>
          ) : null}
        </div>

        <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
          <TextInput
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSend) send();
            }}
            placeholder={peerId ? `ask ${peerId}…` : "select a peer first…"}
            disabled={!workspaceId || busy}
            className="flex-1"
          />
          <Button variant="primary" icon="message-square" onClick={send} disabled={!canSend}>
            SEND
          </Button>
        </div>
      </Panel>

      <StatusBar />
    </div>
  );
}

function Bubble({ turn }: { turn: Turn }) {
  const isUser = turn.role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: EASE }}
      className={cn("flex", isUser ? "justify-end" : "justify-start")}
    >
      <div className={cn("max-w-[85%] border p-2.5", isUser ? "border-accent/40 bg-accent/5" : "border-border bg-void/40")}>
        <div className={cn("text-[9px] uppercase tracking-wider mb-1", isUser ? "text-accent" : "text-text-muted")}>
          {isUser ? "YOU" : "PEER"}
        </div>
        <p className="text-[12px] text-text-primary whitespace-pre-wrap break-words leading-relaxed">
          {turn.content}
        </p>
      </div>
    </motion.div>
  );
}
