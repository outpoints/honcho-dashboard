"use client";

import type { Scope } from "@honcho-ai/sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Honcho31Notice } from "@/components/Honcho31Notice";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Field, PillTabs, TextInput } from "@/components/atoms";
import { Select } from "@/components/Select";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import {
  isHonchoPermissionError,
  useHonchoCapabilities,
} from "@/lib/honcho/useCapabilities";
import { formatApiError, useHonchoQuery } from "@/lib/honcho/useQuery";
import { getSdk } from "@/lib/honcho/sdk";
import { listAllScopes } from "@/lib/honcho/scopeListing";
import { listAllSessions } from "@/lib/honcho/sessionListing";
import { toApiPeer, toApiSession } from "@/lib/honcho/adapters";
import type { ApiPeer, ApiSession } from "@/lib/honcho/types";
import { cn } from "@/lib/utils";

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

type ReasoningLevel = "minimal" | "low" | "medium" | "high" | "max";
type ChatMode = "peer" | "workspace";
const REASONING_LEVELS: ReasoningLevel[] = ["minimal", "low", "medium", "high", "max"];

interface Turn {
  id: string;
  role: "user" | "assistant";
  content: string;
  label?: string;
}

function recallBoundary(value: string): { sessionId?: string; scopeId?: string } {
  if (value.startsWith("session:")) return { sessionId: value.slice("session:".length) };
  if (value.startsWith("scope:")) return { scopeId: value.slice("scope:".length) };
  return {};
}

function readHashParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(new RegExp(`[?&]${key}=([^&]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Memory-augmented chat over one peer or the whole workspace. This is a READ —
 * it does not write messages or memory — so it needs no write-gate or confirm.
 */
export function ChatPage() {
  const apiOpts = useActiveHonchoOptions();
  const { workspaceId } = useActiveWorkspace();
  const { push } = useToast();
  const capabilities = useHonchoCapabilities();
  const scopesAvailable = capabilities.scopes === "available";
  const workspaceChatAvailable = capabilities.workspaceChat === "available";

  const [mode, setMode] = useState<ChatMode>("peer");
  const [peerId, setPeerId] = useState("");
  const [boundary, setBoundary] = useState("");
  const [level, setLevel] = useState<ReasoningLevel>("low");
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const p = readHashParam("peer");
    const s = readHashParam("session");
    if (p) setPeerId(p);
    if (s) setBoundary(`session:${s}`);
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
    async (o) => ({ items: (await listAllSessions(getSdk(o, workspaceId!))).map(toApiSession) }),
  );
  const scopes = useHonchoQuery<Scope[]>(
    workspaceId && scopesAvailable ? `workspaces/${workspaceId}/scopes/list?chat` : null,
    (o) => listAllScopes(getSdk(o, workspaceId!)),
  );

  useEffect(() => {
    if (mode === "workspace" && !workspaceChatAvailable) {
      setMode("peer");
      setTurns([]);
    }
    if (boundary.startsWith("scope:") && !scopesAvailable) setBoundary("");
  }, [boundary, mode, scopesAvailable, workspaceChatAvailable]);

  const peerOptions = useMemo(
    () => (peers.data?.items ?? []).map((p) => ({ value: p.id, label: p.id })),
    [peers.data],
  );
  const boundaryOptions = useMemo(
    () => [
      { value: "", label: "— all available memory —" },
      ...(scopes.data ?? []).map((scope) => ({
        value: `scope:${scope.id}`,
        label: `scope · ${scope.id}`,
      })),
      ...(sessions.data?.items ?? []).map((session) => ({
        value: `session:${session.id}`,
        label: `session · ${session.id}`,
      })),
    ],
    [scopes.data, sessions.data],
  );
  const effectivePeerId = peerOptions.some((option) => option.value === peerId) ? peerId : "";
  const effectiveBoundary = boundaryOptions.some((option) => option.value === boundary)
    ? boundary
    : "";

  const changeMode = (next: ChatMode) => {
    if (next === "workspace" && !workspaceChatAvailable) return;
    setMode(next);
    setTurns([]);
  };

  const send = async () => {
    const query = input.trim();
    if (!apiOpts || !workspaceId) {
      push({ type: "error", message: "Select an active instance and workspace first" });
      return;
    }
    if (mode === "peer" && !effectivePeerId) {
      push({ type: "error", message: "Pick a peer to chat with" });
      return;
    }
    if (mode === "workspace" && !workspaceChatAvailable) {
      push({ type: "error", message: "Workspace chat requires Honcho 3.1.0 or newer" });
      return;
    }
    if (!query || busy) return;

    const userTurn: Turn = { id: `u-${Date.now()}`, role: "user", content: query };
    setTurns((cur) => [...cur, userTurn]);
    setInput("");
    setBusy(true);
    try {
      const recall = recallBoundary(effectiveBoundary);
      const options = {
        ...(recall.sessionId ? { session: recall.sessionId } : {}),
        ...(recall.scopeId ? { scope: recall.scopeId } : {}),
        reasoningLevel: level,
      };
      const sdk = getSdk(apiOpts, workspaceId);
      const reply =
        mode === "workspace"
          ? await sdk.chat(query, options)
          : await (await sdk.peer(effectivePeerId)).chat(query, options);
      setTurns((cur) => [
        ...cur,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: reply && reply.trim() ? reply : "(no answer — the peer has no relevant memory)",
          label: mode === "workspace" ? "WORKSPACE" : effectivePeerId,
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

  const canSend =
    !!workspaceId &&
    (mode === "workspace" ? workspaceChatAvailable : !!effectivePeerId) &&
    !!input.trim() &&
    !busy;

  return (
    <div className="space-y-3">
      <PageHeader
        title="CHAT"
        subtitle="query one peer or synthesize an answer across the entire workspace"
        actions={
          turns.length > 0 ? (
            <Button variant="ghost" icon="x" onClick={() => setTurns([])}>
              CLEAR
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 items-end">
        <Field label="CHAT_MODE" hint="Ask one peer or reason across every peer.">
          <PillTabs<ChatMode>
            items={[
              { key: "peer", label: "PEER" },
              {
                key: "workspace",
                label: workspaceChatAvailable ? "WORKSPACE" : "WORKSPACE · 3.1+",
                disabled: !workspaceChatAvailable,
                title: workspaceChatAvailable ? undefined : "Requires Honcho 3.1.0 or newer",
              },
            ]}
            current={mode}
            onChange={changeMode}
            layoutId="chat-mode"
          />
        </Field>

        {mode === "peer" ? (
          <Field label="PEER" hint="The peer whose representation is queried.">
            <Select
              value={effectivePeerId}
              onChange={setPeerId}
              options={peerOptions}
              disabled={!workspaceId}
              placeholder="select a peer…"
            />
          </Field>
        ) : null}

        <Field label="RECALL_BOUNDARY" hint="Optional — one scope or one session.">
          <Select
            value={effectiveBoundary}
            onChange={setBoundary}
            options={boundaryOptions}
            disabled={!workspaceId}
            placeholder="— all available memory —"
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

      {!workspaceChatAvailable ? (
        <Honcho31Notice
          state={capabilities.workspaceChat}
          version={capabilities.version}
          feature="workspace-wide chat and named scopes"
          fallback="Peer chat and optional session boundaries remain available."
        />
      ) : !scopesAvailable ? (
        <Honcho31Notice
          state={capabilities.scopes}
          version={capabilities.version}
          feature="named scope recall"
          fallback="Workspace chat, peer chat, and session boundaries remain available."
        />
      ) : isHonchoPermissionError(scopes.error) ? (
        <Honcho31Notice
          state="restricted"
          version={capabilities.version}
          feature="named scope recall"
          fallback="Workspace chat, peer chat, and session boundaries remain available."
        />
      ) : scopes.error ? (
        <div className="text-[10px] text-text-muted">
          Named scopes are unavailable on this connection. Workspace, peer, and session chat still work; scope recall requires a workspace- or admin-level key.
        </div>
      ) : null}

      <Panel title="TRANSCRIPT" status={busy ? "processing" : "active"}>
        <div ref={scrollRef} className="max-h-[460px] min-h-[200px] overflow-y-auto space-y-3 pr-1">
          {turns.length === 0 && !busy ? (
            <div className="flex flex-col items-center justify-center py-14 gap-2">
              <Icon name="bot" className="text-text-muted" size={28} />
              <p className="text-sm text-text-muted">No messages yet</p>
              <p className="text-[10px] text-text-muted">
                {mode === "workspace"
                  ? "Ask for themes, differences, or activity across every peer."
                  : "Pick a peer and ask something like “what do you know about me?”"}
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
            placeholder={
              mode === "workspace"
                ? `ask across ${workspaceId ?? "the workspace"}…`
                : effectivePeerId
                  ? `ask ${effectivePeerId}…`
                  : "select a peer first…"
            }
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
          {isUser ? "YOU" : turn.label ?? "PEER"}
        </div>
        <p className="text-[12px] text-text-primary whitespace-pre-wrap break-words leading-relaxed">
          {turn.content}
        </p>
      </div>
    </motion.div>
  );
}
