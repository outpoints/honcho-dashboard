"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Field, TextInput, RefreshButton } from "@/components/atoms";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { ConfirmModal } from "@/components/ConfirmModal";
import { PanelGridSkeleton } from "@/components/Skeleton";
import { useToast } from "@/components/toast";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { formatApiError, invalidate, useHonchoQuery } from "@/lib/honcho/useQuery";
import { getSdk } from "@/lib/honcho/sdk";
import { toApiSession } from "@/lib/honcho/adapters";
import type { ApiSession } from "@/lib/honcho/types";
import { useNav } from "@/lib/nav";

export function SessionsPage() {
  const apiOpts = useActiveHonchoOptions();
  const { workspaceId } = useActiveWorkspace();
  const { push } = useToast();
  const { navigate } = useNav();
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const key = workspaceId ? `sdk/workspaces/${workspaceId}/sessions/list` : null;
  const { data, error, isLoading, refetch } = useHonchoQuery<{ items: ApiSession[]; total: number }>(
    key,
    async (o) => {
      const page = await getSdk(o, workspaceId!).sessions({ size: 100 });
      return { items: page.items.map((s) => toApiSession(s)), total: page.total };
    },
  );

  const sessions = (data?.items ?? []).filter((s) =>
    !filter.trim() ? true : s.id.toLowerCase().includes(filter.toLowerCase()),
  );

  const create = async () => {
    if (!apiOpts || !workspaceId) return;
    const trimmed = id.trim();
    if (!trimmed) {
      push({ type: "error", message: "Session id is required" });
      return;
    }
    setBusy(true);
    try {
      await getSdk(apiOpts, workspaceId).session(trimmed);
      push({ type: "success", message: `Session ${trimmed} created` });
      setOpen(false);
      setId("");
      invalidate(`sdk/workspaces/${workspaceId}/sessions`);
      refetch();
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (sid: string) => {
    if (!apiOpts || !workspaceId) return;
    setRemoveTarget(null);
    try {
      const session = await getSdk(apiOpts, workspaceId).session(sid);
      await session.delete();
      push({ type: "success", message: `Session ${sid} removed` });
      invalidate(`sdk/workspaces/${workspaceId}/sessions`);
      refetch();
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    }
  };

  return (
    <div className="space-y-3">
      <PageHeader
        title="SESSIONS"
        subtitle={workspaceId ? `sessions in ${workspaceId}` : "select a workspace"}
        actions={
          <div className="flex items-center gap-2">
            <RefreshButton label="REFRESH" onClick={() => refetch()} />
            <Button icon="plus" onClick={() => setOpen(true)} disabled={!workspaceId}>NEW_SESSION</Button>
          </div>
        }
      />

      <Panel title="FILTER">
        <TextInput placeholder="filter by id…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="mt-2 text-[10px] text-text-muted">
          {isLoading ? "loading…" : `${sessions.length} of ${data?.total ?? 0} sessions`}
        </div>
      </Panel>

      {error ? (
        <Panel title="ERROR" status="processing">
          <div className="text-xs text-red-400">{formatApiError(error)}</div>
        </Panel>
      ) : !workspaceId ? (
        <Panel title="NO_WORKSPACE">
          <div className="text-xs text-text-muted py-4">Select a workspace in the sidebar.</div>
        </Panel>
      ) : isLoading ? (
        <PanelGridSkeleton count={4} cols="grid-cols-1 md:grid-cols-2" />
      ) : sessions.length === 0 ? (
        <Panel title="NO_SESSIONS">
          <div className="text-xs text-text-muted py-4">
            {filter ? "No sessions match your filter." : "No sessions yet."}
          </div>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <AnimatePresence initial={false}>
            {sessions.map((s) => (
              <motion.div
                key={s.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
              >
                <SessionCard
                  session={s}
                  workspaceId={workspaceId}
                  onRemove={() => setRemoveTarget(s.id)}
                  onOpenMessages={() => {
                    window.location.hash = `#/messages?session=${encodeURIComponent(s.id)}`;
                    navigate("messages");
                  }}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <StatusBar />

      <ConfirmModal
        open={!!removeTarget}
        title="CONFIRM_REMOVE"
        body={
          <>
            Delete session <span className="text-accent">{removeTarget}</span>? All messages in this
            session will be lost. This cannot be undone.
          </>
        }
        confirmLabel="REMOVE_SESSION"
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => removeTarget && remove(removeTarget)}
      />

      <Modal
        title="CREATE_SESSION"
        open={open}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>CANCEL</Button>
            <Button variant="primary" onClick={create} disabled={busy}>{busy ? "CREATING…" : "CREATE"}</Button>
          </>
        }
      >
        <Field label="SESSION_ID" hint="Session ids are immutable.">
          <TextInput
            placeholder="e.g., sess_alice_2026"
            value={id}
            autoFocus
            onChange={(e) => setId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) create();
            }}
          />
        </Field>
      </Modal>
    </div>
  );
}

function SessionCard({
  session,
  workspaceId,
  onRemove,
  onOpenMessages,
}: {
  session: ApiSession;
  workspaceId: string;
  onRemove: () => void;
  onOpenMessages: () => void;
}) {
  const apiOpts = useActiveHonchoOptions();
  const [stats, setStats] = useState<{ messages: number | null; peers: number | null; loaded: boolean }>({
    messages: null,
    peers: null,
    loaded: false,
  });

  const loadStats = async () => {
    if (!apiOpts) return;
    try {
      const ses = await getSdk(apiOpts, workspaceId).session(session.id);
      const [msgs, peers] = await Promise.all([ses.messages({ size: 1 }), ses.peers()]);
      const peerCount = Array.isArray(peers) ? peers.length : Object.keys(peers).length;
      setStats({ messages: msgs.total, peers: peerCount, loaded: true });
    } catch {
      setStats({ messages: null, peers: null, loaded: true });
    }
  };

  return (
    <Panel
      title={session.id.toUpperCase()}
      status={session.is_active ? "active" : "idle"}
    >
      <div className="space-y-1 text-[11px] mb-3">
        <Row k="id" v={<span className="font-mono text-text-primary">{session.id}</span>} />
        <Row k="state" v={
          <span className={session.is_active ? "text-accent" : "text-text-muted"}>
            {session.is_active ? "active" : "inactive"}
          </span>
        } />
        <Row k="created" v={new Date(session.created_at).toLocaleString()} />
        <Row
          k="messages"
          v={
            stats.loaded ? (
              <span className="text-accent">{stats.messages ?? "—"}</span>
            ) : (
              <button onClick={loadStats} className="text-accent underline decoration-dotted">load</button>
            )
          }
        />
        <Row
          k="peers"
          v={
            stats.loaded ? <span className="text-accent">{stats.peers ?? "—"}</span> : <span className="text-text-muted">—</span>
          }
        />
      </div>
      <div className="flex items-center gap-1">
        <Button variant="outline" className="flex-1" onClick={onOpenMessages}>
          OPEN_MESSAGES
        </Button>
        <button
          onClick={onRemove}
          className="w-8 h-8 border border-border-light text-text-muted hover:text-red-400 flex items-center justify-center"
          aria-label="Remove session"
          title="Remove session"
        >
          <Icon name="trash" size={12} />
        </button>
      </div>
    </Panel>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-text-muted">{k}</span>
      <span className="truncate text-right">{v}</span>
    </div>
  );
}
