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
import { SkeletonRowList } from "@/components/Skeleton";
import { useToast } from "@/components/toast";
import { honcho } from "@/lib/honcho/client";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { formatApiError, invalidate, useHonchoQuery } from "@/lib/honcho/useQuery";

export function WebhooksPage() {
  const apiOpts = useActiveHonchoOptions();
  const { workspaceId } = useActiveWorkspace();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const key = workspaceId ? `workspaces/${workspaceId}/webhooks` : null;
  const { data, error, isLoading, refetch } = useHonchoQuery(key, (o) =>
    honcho.webhooks.list(o, workspaceId!),
  );

  const items = data?.items ?? [];

  const create = async () => {
    if (!apiOpts || !workspaceId) return;
    const trimmed = url.trim();
    if (!/^https?:\/\//.test(trimmed)) {
      push({ type: "error", message: "URL must start with http:// or https://" });
      return;
    }
    setBusy(true);
    try {
      await honcho.webhooks.create(apiOpts, workspaceId, { url: trimmed });
      push({ type: "success", message: "Webhook created" });
      setOpen(false);
      setUrl("");
      invalidate(`workspaces/${workspaceId}/webhooks`);
      refetch();
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!apiOpts || !workspaceId) return;
    setRemoveTarget(null);
    try {
      await honcho.webhooks.delete(apiOpts, workspaceId, id);
      push({ type: "success", message: "Webhook removed" });
      invalidate(`workspaces/${workspaceId}/webhooks`);
      refetch();
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    }
  };

  const testEmit = async () => {
    if (!apiOpts || !workspaceId) return;
    try {
      await honcho.webhooks.test(apiOpts, workspaceId);
      push({ type: "success", message: "Test event emitted to all endpoints" });
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    }
  };

  return (
    <div className="space-y-3">
      <PageHeader
        title="WEBHOOKS"
        subtitle={workspaceId ? `endpoints for ${workspaceId}` : "select a workspace"}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={testEmit} disabled={!workspaceId}>TEST_EMIT</Button>
            <RefreshButton label="REFRESH" onClick={() => refetch()} />
            <Button icon="plus" onClick={() => setOpen(true)} disabled={!workspaceId}>NEW_WEBHOOK</Button>
          </div>
        }
      />

      {error ? (
        <Panel title="ERROR" status="processing">
          <div className="text-xs text-red-400">{formatApiError(error)}</div>
        </Panel>
      ) : !workspaceId ? (
        <Panel title="NO_WORKSPACE"><div className="text-xs text-text-muted py-4">Select a workspace.</div></Panel>
      ) : isLoading ? (
        <Panel title="ENDPOINTS">
          <SkeletonRowList count={3} />
        </Panel>
      ) : items.length === 0 ? (
        <Panel title="NO_WEBHOOKS">
          <div className="text-xs text-text-muted py-4">No webhook endpoints registered yet.</div>
        </Panel>
      ) : (
        <Panel title="ENDPOINTS">
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {items.map((w) => (
                <motion.div
                  key={w.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
                  className="flex items-center justify-between gap-3 px-3 py-2 bg-void/40 border border-border"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-accent font-mono truncate">{w.url}</div>
                    <div className="text-[10px] text-text-muted">
                      id: <span className="font-mono">{w.id}</span> · created:{" "}
                      {new Date(w.created_at).toLocaleString()}
                    </div>
                  </div>
                  <button
                    onClick={() => setRemoveTarget(w.id)}
                    className="w-8 h-8 border border-border-light text-text-muted hover:text-red-400 flex items-center justify-center shrink-0"
                    aria-label="Remove webhook"
                  >
                    <Icon name="trash" size={12} />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </Panel>
      )}

      <Panel title="API_NOTE">
        <div className="text-[11px] text-text-muted leading-relaxed">
          Honcho exposes webhook endpoints by URL only — the event filter list shown in the original
          mock UI is not part of the public schema. Use{" "}
          <span className="text-accent">GET /v3/workspaces/{workspaceId ?? "&lt;ws&gt;"}/webhooks/test</span> via{" "}
          <span className="text-accent">TEST_EMIT</span> to fire a synthetic event at every endpoint.
        </div>
      </Panel>

      <StatusBar />

      <ConfirmModal
        open={!!removeTarget}
        title="CONFIRM_REMOVE"
        body={
          <>
            Remove webhook <span className="text-accent">{removeTarget}</span>? Events will no longer be
            delivered to this endpoint.
          </>
        }
        confirmLabel="REMOVE_WEBHOOK"
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => removeTarget && remove(removeTarget)}
      />

      <Modal
        title="CREATE_WEBHOOK"
        open={open}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>CANCEL</Button>
            <Button variant="primary" onClick={create} disabled={busy}>{busy ? "CREATING…" : "CREATE"}</Button>
          </>
        }
      >
        <Field label="URL" hint="HTTPS endpoint that will receive Honcho event POSTs.">
          <TextInput
            placeholder="https://example.com/honcho/events"
            value={url}
            autoFocus
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) create();
            }}
          />
        </Field>
      </Modal>
    </div>
  );
}
