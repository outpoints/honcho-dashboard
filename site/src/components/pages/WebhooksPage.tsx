"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Chip, Field, StatTile, TextInput, RefreshButton } from "@/components/atoms";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { ConfirmModal } from "@/components/ConfirmModal";
import { useToast } from "@/components/toast";
import { honcho } from "@/lib/honcho/client";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { formatApiError, invalidate, useHonchoQuery } from "@/lib/honcho/useQuery";
import { useOperatorQuery } from "@/lib/operator/client";
import { cn } from "@/lib/utils";

interface WebhookStats {
  available: boolean;
  reason?: string;
  total?: number;
  delivered?: number;
  failed?: number;
  last_delivery?: string | null;
  byEvent?: { event_type: string; n: number }[];
  recent?: { id: string; event_type: string; status: "delivered" | "failed"; created_at: string }[];
}

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
  const stats = useOperatorQuery<WebhookStats>(
    workspaceId ? `/api/operator/db?view=webhooks&workspace_id=${encodeURIComponent(workspaceId)}` : null,
  );

  const items = data?.items ?? [];
  const s = stats.data?.available ? stats.data : null;

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
      setTimeout(() => stats.refetch(), 800);
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    }
  };

  return (
    <div className="space-y-3">
      <PageHeader
        title="WEBHOOKS"
        subtitle="webhook endpoint management for self-hosted Honcho instance"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={testEmit} disabled={!workspaceId}>
              TEST_EMIT
            </Button>
            <RefreshButton
              label="REFRESH"
              onClick={() => {
                refetch();
                stats.refetch();
              }}
            />
            <Button icon="plus" onClick={() => setOpen(true)} disabled={!workspaceId}>
              NEW_WEBHOOK
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-3 gap-3">
        <StatTile
          label="endpoints"
          value={items.length}
          hintTone="accent"
          hint={<span>registered endpoints</span>}
        />
        <StatTile
          label="delivered"
          value={(s?.delivered ?? 0).toLocaleString()}
          hintTone="muted"
          hint={<span>all-time deliveries</span>}
        />
        <StatTile
          label="failures"
          value={
            <span className={s?.failed ? "text-yellow-400" : "text-text-primary"}>
              {(s?.failed ?? 0).toLocaleString()}
            </span>
          }
          hintTone="warn"
          hint={<span>failed deliveries</span>}
        />
      </div>

      {error ? (
        <Panel title="ERROR" status="processing">
          <div className="text-xs text-red-400">{formatApiError(error)}</div>
        </Panel>
      ) : !workspaceId ? (
        <Panel title="NO_WORKSPACE">
          <div className="text-xs text-text-muted py-4">Select a workspace in the sidebar.</div>
        </Panel>
      ) : (
        <Panel title="WEBHOOK_ENDPOINTS">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-12 bg-border/40 animate-pulse" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="text-xs text-text-muted py-6 text-center">
              No webhook endpoints registered yet. Click NEW_WEBHOOK to add one.
            </div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {items.map((w, i) => (
                  <motion.div
                    key={w.id}
                    layout
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 100, transition: { duration: 0.2 } }}
                    transition={{ delay: Math.min(i * 0.04, 0.2), duration: 0.2 }}
                    className="flex items-center gap-3 px-3 py-3 bg-void/40 border border-border transition-colors duration-150 hover:border-accent/50"
                  >
                    <Icon name="check" size={14} className="text-accent shrink-0" />
                    <div className="min-w-0 flex-1">
                      <span className="text-xs text-text-primary font-mono break-all">{w.url}</span>
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-text-muted">
                        <span className="font-mono">id: {w.id}</span>
                        <span className="flex items-center gap-1">
                          <Icon name="clock" size={10} /> created:{" "}
                          {new Date(w.created_at).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => setRemoveTarget(w.id)}
                      className="w-8 h-8 border border-border-light text-text-muted hover:text-red-400 flex items-center justify-center transition-colors duration-150"
                      aria-label="Remove webhook"
                    >
                      <Icon name="trash" size={12} />
                    </motion.button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </Panel>
      )}

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 lg:col-span-7">
          <Panel title="DELIVERY_ACTIVITY">
            {!s ? (
              <div className="text-[11px] text-text-muted py-4">
                {stats.isLoading
                  ? "loading…"
                  : `Delivery history needs the operator DB${
                      stats.data?.reason ? ` (${stats.data.reason})` : ""
                    }.`}
              </div>
            ) : (
              <div className="space-y-3">
                {(s.byEvent ?? []).length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {(s.byEvent ?? []).map((e) => (
                      <Chip key={e.event_type} tone="accent">
                        {e.event_type} · {e.n.toLocaleString()}
                      </Chip>
                    ))}
                  </div>
                ) : null}
                {(s.recent ?? []).length === 0 ? (
                  <div className="text-[11px] text-text-muted py-2">No webhook deliveries recorded.</div>
                ) : (
                  <div className="space-y-1">
                    {(s.recent ?? []).map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center gap-2 px-2 py-1.5 bg-void/40 border border-border text-[11px]"
                      >
                        <Icon
                          name={r.status === "failed" ? "x-circle" : "check"}
                          size={12}
                          className={r.status === "failed" ? "text-red-400" : "text-accent"}
                        />
                        <span className="text-text-primary font-mono truncate">{r.event_type}</span>
                        <span className="ml-auto text-text-muted shrink-0">
                          {new Date(r.created_at).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Panel>
        </div>
        <div className="col-span-12 lg:col-span-5">
          <Panel title="SELF_HOSTED_INFO">
            <div className="space-y-2 text-xs">
              <Bullet icon="external-link" label="No API key required for self-hosted" />
              <Bullet icon="webhook" label="Endpoints registered by URL (no per-event filter)" />
              <Bullet icon="warning" label="Ensure endpoints are reachable from the server" tone="warn" />
              <div className="mt-3 pt-3 border-t border-border space-y-0.5 text-[11px] text-text-muted">
                <div>
                  &gt; endpoint:{" "}
                  <span className="text-text-primary font-mono break-all">
                    {apiOpts?.baseUrl ?? "—"}
                  </span>
                </div>
                <div>
                  &gt; last_delivery:{" "}
                  <span className="text-text-primary">
                    {s?.last_delivery ? new Date(s.last_delivery).toLocaleString() : "never"}
                  </span>
                </div>
                <div>
                  &gt; total_events:{" "}
                  <span className="text-text-primary">{(s?.total ?? 0).toLocaleString()}</span>
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>

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
        title="NEW_WEBHOOK"
        open={open}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              CANCEL
            </Button>
            <Button variant="primary" onClick={create} disabled={busy}>
              {busy ? "CREATING…" : "CREATE_WEBHOOK"}
            </Button>
          </>
        }
      >
        <Field
          label="ENDPOINT_URL"
          hint="HTTPS endpoint that will receive Honcho event POSTs. Honcho subscribes endpoints to all events (no per-event filter)."
        >
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
        {!/^https?:\/\//.test(url.trim()) ? (
          <div className="px-3 py-2 bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-xs flex items-center gap-2">
            <Icon name="warning" size={12} /> A valid http(s) URL is required
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Bullet({
  icon,
  label,
  tone = "muted",
}: {
  icon: "external-link" | "webhook" | "warning";
  label: string;
  tone?: "muted" | "warn";
}) {
  const color = tone === "warn" ? "text-yellow-400" : "text-text-muted";
  return (
    <div className="flex items-center gap-2">
      <Icon name={icon} className={cn(color, "shrink-0")} size={12} />
      <span className={color}>{label}</span>
    </div>
  );
}
