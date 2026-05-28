"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Field, TextInput, RefreshButton } from "@/components/atoms";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { ConfirmModal } from "@/components/ConfirmModal";
import { useToast } from "@/components/toast";
import { honcho } from "@/lib/honcho/client";
import { useActiveHonchoOptions } from "@/lib/honcho/config";
import { formatApiError, invalidate, useHonchoQuery } from "@/lib/honcho/useQuery";
import type { ApiWorkspace } from "@/lib/honcho/types";

const LIST_KEY = "workspaces/list";

export function WorkspacesPage() {
  const apiOpts = useActiveHonchoOptions();
  const { push } = useToast();
  const { data, error, isLoading, refetch } = useHonchoQuery(LIST_KEY, (o) =>
    honcho.workspaces.list(o, { size: 100 }),
  );

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const workspaces = data?.items ?? [];

  const openCreate = () => {
    setName("");
    setOpen(true);
  };

  const save = async () => {
    if (!apiOpts) {
      push({ type: "error", message: "No Honcho instance configured" });
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      push({ type: "error", message: "Workspace id is required" });
      return;
    }
    setBusy(true);
    try {
      await honcho.workspaces.create(apiOpts, { id: trimmed });
      push({ type: "success", message: `Workspace ${trimmed} created` });
      setOpen(false);
      invalidate("workspaces");
      refetch();
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!apiOpts) return;
    setRemoveTarget(null);
    try {
      await honcho.workspaces.delete(apiOpts, id);
      push({ type: "success", message: `Workspace ${id} removed` });
      invalidate("workspaces");
      refetch();
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    }
  };

  return (
    <div className="space-y-3">
      <PageHeader
        title="WORKSPACES"
        subtitle="top-level containers for organizing peers, sessions, and data"
        actions={
          <div className="flex items-center gap-2">
            <RefreshButton label="REFRESH" onClick={() => refetch()} />
            <Button icon="plus" onClick={openCreate}>NEW_WORKSPACE</Button>
          </div>
        }
      />

      {error ? (
        <Panel title="ERROR" status="processing">
          <div className="text-xs text-red-400">{formatApiError(error)}</div>
          <div className="text-[10px] text-text-muted mt-2">
            Check your Honcho instance in <span className="text-accent">#/config</span>.
          </div>
        </Panel>
      ) : null}

      {isLoading ? (
        <SkeletonGrid />
      ) : workspaces.length === 0 && !error ? (
        <EmptyState onCreate={openCreate} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <AnimatePresence initial={false}>
            {workspaces.map((w) => (
              <motion.div
                key={w.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
              >
                <WorkspaceCard workspace={w} onRemove={() => setRemoveTarget(w.id)} />
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
            This will permanently delete the workspace{" "}
            <span className="text-accent">{removeTarget}</span> and all its peers, sessions, and
            messages on the Honcho server. This cannot be undone.
          </>
        }
        confirmLabel="REMOVE_WORKSPACE"
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => removeTarget && remove(removeTarget)}
      />

      <Modal
        title="CREATE_WORKSPACE"
        open={open}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>CANCEL</Button>
            <Button variant="primary" onClick={save} disabled={busy}>{busy ? "CREATING…" : "CREATE"}</Button>
          </>
        }
      >
        <Field label="WORKSPACE_ID" hint="The id is immutable. Use lowercase identifiers, e.g. production, staging.">
          <TextInput
            placeholder="e.g., production"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) save();
            }}
          />
        </Field>
      </Modal>
    </div>
  );
}

function WorkspaceCard({ workspace, onRemove }: { workspace: ApiWorkspace; onRemove: () => void }) {
  const created = workspace.created_at
    ? new Date(workspace.created_at).toLocaleString()
    : "—";
  const cfgEntries = Object.entries(workspace.configuration ?? {});
  const metaEntries = Object.entries(workspace.metadata ?? {});

  return (
    <Panel title={workspace.id.toUpperCase()}>
      <div className="space-y-1 text-[11px] mb-3">
        <Row k="id" v={<span className="text-text-primary font-mono">{workspace.id}</span>} />
        <Row k="created" v={<span className="text-text-primary">{created}</span>} />
        <Row
          k="configuration"
          v={
            <span className={cfgEntries.length ? "text-accent" : "text-text-muted"}>
              {cfgEntries.length ? `${cfgEntries.length} keys` : "defaults"}
            </span>
          }
        />
        <Row
          k="metadata"
          v={
            <span className={metaEntries.length ? "text-accent" : "text-text-muted"}>
              {metaEntries.length ? `${metaEntries.length} keys` : "empty"}
            </span>
          }
        />
      </div>
      <div className="flex items-center gap-1">
        <Button variant="outline" className="flex-1" onClick={() => (window.location.hash = `#/peers?ws=${workspace.id}`)}>VIEW_PEERS</Button>
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={onRemove}
          className="w-8 h-8 border border-border-light text-text-muted hover:text-red-400 flex items-center justify-center"
          aria-label="Remove workspace"
          title="Remove workspace"
        >
          <Icon name="trash" size={12} />
        </motion.button>
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

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Panel key={i} title="LOADING…">
          <div className="space-y-2">
            <div className="h-3 bg-border/60 animate-pulse" />
            <div className="h-3 bg-border/60 animate-pulse w-2/3" />
            <div className="h-3 bg-border/60 animate-pulse w-1/2" />
            <div className="h-8 bg-border/30 animate-pulse mt-4" />
          </div>
        </Panel>
      ))}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Panel title="NO_WORKSPACES">
      <div className="flex flex-col items-center justify-center text-center py-8 gap-3">
        <Icon name="layers" size={32} className="text-text-muted" />
        <div className="text-xs text-text-muted">
          No workspaces on this Honcho instance yet.
        </div>
        <Button icon="plus" onClick={onCreate}>CREATE_FIRST_WORKSPACE</Button>
      </div>
    </Panel>
  );
}
