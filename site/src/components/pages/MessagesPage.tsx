"use client";

import { useSyncExternalStore, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, RefreshButton } from "@/components/atoms";
import { Icon } from "@/components/icons";
import { Select } from "@/components/Select";
import { SkeletonRowList } from "@/components/Skeleton";
import { useActiveWorkspace } from "@/lib/honcho/config";
import { formatApiError, useHonchoQuery } from "@/lib/honcho/useQuery";
import { getSdk } from "@/lib/honcho/sdk";
import { toApiMessage, toApiSession } from "@/lib/honcho/adapters";
import type { ApiMessage, ApiSession } from "@/lib/honcho/types";
import { cn } from "@/lib/utils";

function readSessionFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(/[?&]session=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function subscribeHash(notify: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
}

export function MessagesPage() {
  const { workspaceId } = useActiveWorkspace();
  const hashSessionId = useSyncExternalStore(subscribeHash, readSessionFromHash, () => null);
  const [override, setOverride] = useState<string | null>(null);

  const sessionsKey = workspaceId ? `sdk/workspaces/${workspaceId}/sessions/list/picker` : null;
  const sessions = useHonchoQuery<{ items: ApiSession[]; total: number }>(sessionsKey, async (o) => {
    const page = await getSdk(o, workspaceId!).sessions({ size: 100 });
    return { items: page.items.map((s) => toApiSession(s)), total: page.total };
  });

  const fallbackSessionId = sessions.data?.items?.[0]?.id ?? null;
  const sessionId = override ?? hashSessionId ?? fallbackSessionId;

  const messagesKey =
    workspaceId && sessionId ? `sdk/workspaces/${workspaceId}/sessions/${sessionId}/messages/list` : null;
  const messages = useHonchoQuery<{ items: ApiMessage[]; total: number }>(messagesKey, async (o) => {
    const ses = await getSdk(o, workspaceId!).session(sessionId!);
    const page = await ses.messages({ size: 100 });
    return { items: page.items.map((m) => toApiMessage(m)), total: page.total };
  });

  return (
    <div className="space-y-3">
      <PageHeader
        title="MESSAGES"
        subtitle={
          workspaceId && sessionId
            ? `${workspaceId} / ${sessionId}`
            : workspaceId
              ? "pick a session"
              : "select a workspace"
        }
        actions={
          sessionId ? (
            <RefreshButton label="REFRESH" onClick={() => messages.refetch()} />
          ) : (
            <Button variant="ghost" icon="refresh" disabled>REFRESH</Button>
          )
        }
      />

      <Panel title="SESSION">
        {!workspaceId ? (
          <div className="text-xs text-text-muted py-4">Select a workspace in the sidebar.</div>
        ) : sessions.isLoading ? (
          <div className="text-xs text-text-muted py-4">Loading sessions…</div>
        ) : sessions.error ? (
          <div className="text-xs text-red-400">{formatApiError(sessions.error)}</div>
        ) : (sessions.data?.items ?? []).length === 0 ? (
          <div className="text-xs text-text-muted py-4">No sessions in this workspace.</div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <Select
              className="min-w-[260px] flex-1"
              value={sessionId ?? ""}
              onChange={(id) => {
                setOverride(id || null);
                window.location.hash = id ? `#/messages?session=${encodeURIComponent(id)}` : "#/messages";
              }}
              options={(sessions.data?.items ?? []).map((s) => ({
                value: s.id,
                label: s.id,
              }))}
              placeholder="select a session…"
            />
            <span className="text-[10px] text-text-muted">
              {messages.isLoading
                ? "loading…"
                : messages.data
                  ? `${messages.data.total} messages`
                  : ""}
            </span>
          </div>
        )}
      </Panel>

      {!sessionId ? null : messages.error ? (
        <Panel title="ERROR" status="processing">
          <div className="text-xs text-red-400">{formatApiError(messages.error)}</div>
        </Panel>
      ) : messages.isLoading ? (
        <Panel title="MESSAGES">
          <SkeletonRowList count={6} />
        </Panel>
      ) : (messages.data?.items ?? []).length === 0 ? (
        <Panel title="NO_MESSAGES"><div className="text-xs text-text-muted py-4">This session has no messages.</div></Panel>
      ) : (
        <Panel title="MESSAGES">
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {(messages.data?.items ?? []).map((m) => (
                <motion.div
                  key={m.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <MessageRow message={m} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </Panel>
      )}

      <StatusBar />
    </div>
  );
}

function MessageRow({ message }: { message: ApiMessage }) {
  return (
    <div className="bg-void/40 border border-border p-3 text-xs">
      <div className="flex items-center justify-between gap-2 mb-2 text-[10px]">
        <div className="flex items-center gap-2 min-w-0">
          <Icon name="user" size={11} className="text-accent" />
          <span className="font-mono text-accent truncate">{message.peer_id}</span>
        </div>
        <div className="flex items-center gap-2 text-text-muted shrink-0">
          <span>{message.token_count} tok</span>
          <span>·</span>
          <span>{new Date(message.created_at).toLocaleString()}</span>
        </div>
      </div>
      <div className={cn("whitespace-pre-wrap break-words leading-relaxed text-text-primary")}>
        {message.content}
      </div>
      <div className="mt-2 text-[9px] text-text-muted font-mono">id: {message.id}</div>
    </div>
  );
}
