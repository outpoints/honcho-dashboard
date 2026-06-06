"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Chip, Field, StatTile, TextInput, RefreshButton } from "@/components/atoms";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm";
import { useWriteActions } from "@/lib/writeActions";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { formatApiError, useHonchoQuery } from "@/lib/honcho/useQuery";
import { useOperatorQuery } from "@/lib/operator/client";
import { getSdk } from "@/lib/honcho/sdk";
import { toApiQueueStatus } from "@/lib/honcho/adapters";
import type { ApiQueueStatus } from "@/lib/honcho/types";
import { cn } from "@/lib/utils";

type ChipTone = "blue" | "purple" | "yellow" | "orange" | "cyan" | "pink" | "muted";

const TYPE_TONES: Record<string, ChipTone> = {
  representation: "blue",
  summary: "cyan",
  dream: "purple",
  webhook: "orange",
  peer_card: "pink",
  consolidation: "yellow",
};

interface ReasoningTaskRow {
  id: string;
  task_type: string;
  peer: string | null;
  session_id: string;
  status: "queued" | "completed" | "failed";
  error: string | null;
  created_at: string;
  token_count: number;
  work_unit_key: string | null;
  message_id: string | null;
  payload: Record<string, unknown> | null;
}

interface ReasoningResp {
  available: boolean;
  reason?: string;
  tasks?: ReasoningTaskRow[];
  counts?: { queued: number; completed: number; failed: number; total: number; tokens_pending: number };
  byType?: { type: string; n: number }[];
  config?: Record<string, unknown> | null;
}

interface ConclusionsResp {
  available: boolean;
  total?: number;
  by_observer?: { observer_id: string; n: number }[];
}

export function ReasoningPage() {
  const apiOpts = useActiveHonchoOptions();
  const { workspaceId } = useActiveWorkspace();
  const { push } = useToast();
  const confirm = useConfirm();
  const { enabled: canWrite } = useWriteActions();

  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  // Schedule-dream modal.
  const [dreamOpen, setDreamOpen] = useState(false);
  const [dreamObserver, setDreamObserver] = useState("");
  const [dreamObserved, setDreamObserved] = useState("");
  const [dreamSession, setDreamSession] = useState("");
  const [dreamBusy, setDreamBusy] = useState(false);

  // Retry (re-queue) a failed task via the operator DB write path.
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryAllBusy, setRetryAllBusy] = useState(false);

  // Live aggregate work-unit counters (for the in-flight "processing" tile).
  const queueKey = workspaceId ? `sdk/workspaces/${workspaceId}/queue/status` : null;
  const queue = useHonchoQuery<ApiQueueStatus>(
    queueKey,
    async (o) => toApiQueueStatus(await getSdk(o, workspaceId!).queueStatus()),
    { refreshInterval: 5000 },
  );

  // Per-task records + aggregates from the operator/db queue table.
  const reasoningPath = workspaceId
    ? `/api/operator/db?view=reasoning&workspace_id=${encodeURIComponent(workspaceId)}` +
      `${statusFilter !== "all" ? `&status=${statusFilter}` : ""}` +
      `${typeFilter !== "all" ? `&task_type=${encodeURIComponent(typeFilter)}` : ""}`
    : null;
  const reasoning = useOperatorQuery<ReasoningResp>(reasoningPath);

  const conclusionsPath = workspaceId
    ? `/api/operator/db?view=conclusions&workspace_id=${encodeURIComponent(workspaceId)}`
    : null;
  const conclusions = useOperatorQuery<ConclusionsResp>(conclusionsPath);

  const counts = reasoning.data?.counts;
  const tasks = reasoning.data?.tasks ?? [];
  const byType = reasoning.data?.byType ?? [];
  const config = reasoning.data?.config ?? null;
  const processing = queue.data?.in_progress_work_units ?? 0;

  const typeOptions = useMemo(
    () => ["all", ...byType.map((t) => t.type)],
    [byType],
  );

  const openDream = () => {
    setDreamObserver("");
    setDreamObserved("");
    setDreamSession("");
    setDreamOpen(true);
  };

  const submitDream = async () => {
    if (!apiOpts || !workspaceId) return;
    const observer = dreamObserver.trim();
    if (!observer) {
      push({ type: "error", message: "Observer peer id is required" });
      return;
    }
    const ok = await confirm({
      title: "SCHEDULE_DREAM",
      confirmLabel: "SCHEDULE",
      body: (
        <>
          Queue a dream consolidation pass for{" "}
          <span className="text-accent font-mono">{observer}</span> in{" "}
          <span className="text-accent font-mono">{workspaceId}</span> on the live instance?
        </>
      ),
    });
    if (!ok) return;
    setDreamBusy(true);
    try {
      await getSdk(apiOpts, workspaceId).scheduleDream({
        observer,
        ...(dreamObserved.trim() ? { observed: dreamObserved.trim() } : {}),
        ...(dreamSession.trim() ? { session: dreamSession.trim() } : {}),
      });
      push({ type: "success", message: `Dream scheduled for ${observer}` });
      setDreamOpen(false);
      reasoning.refetch();
      queue.refetch();
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    } finally {
      setDreamBusy(false);
    }
  };

  const doRetry = async (target: ReasoningTaskRow) => {
    if (!workspaceId || retryBusy) return;
    const ok = await confirm({
      title: "RETRY_TASK",
      confirmLabel: "RETRY",
      body: (
        <>
          Re-queue the failed <span className="text-accent">{target.task_type}</span> task{" "}
          <span className="text-accent font-mono">#{target.id}</span> on the live instance? This
          clears its error and marks it unprocessed so the deriver re-runs the same work on its next
          poll.
        </>
      ),
    });
    if (!ok) return;
    setRetryBusy(true);
    try {
      const res = await fetch(
        `/api/operator/db?action=retry_reasoning&workspace_id=${encodeURIComponent(workspaceId)}` +
          `&id=${encodeURIComponent(target.id)}`,
        { method: "POST" },
      );
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
      if (!res.ok || !body.ok) throw new Error(body.reason || `HTTP ${res.status}`);
      push({ type: "success", message: `Re-queued ${target.task_type} task #${target.id}` });
      reasoning.refetch();
      queue.refetch();
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    } finally {
      setRetryBusy(false);
    }
  };

  const doRetryAll = async () => {
    if (!workspaceId || retryAllBusy) return;
    const ok = await confirm({
      title: "RETRY_FAILED",
      confirmLabel: `RETRY ${(counts?.failed ?? 0).toLocaleString()} TASKS`,
      body: (
        <>
          Re-queue all{" "}
          <span className="text-accent">{(counts?.failed ?? 0).toLocaleString()} failed</span> tasks
          in <span className="text-accent font-mono">{workspaceId}</span> on the live instance? Each
          clears its error and is marked unprocessed so the deriver re-runs the same work. dream and
          reconciler tasks are skipped here — retry those individually.
        </>
      ),
    });
    if (!ok) return;
    setRetryAllBusy(true);
    try {
      const res = await fetch(
        `/api/operator/db?action=retry_all_failed_reasoning&workspace_id=${encodeURIComponent(workspaceId)}`,
        { method: "POST" },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
        retried?: number;
        skipped?: number;
      };
      if (!res.ok || !body.ok) throw new Error(body.reason || `HTTP ${res.status}`);
      const n = body.retried ?? 0;
      const skip = body.skipped
        ? ` · ${body.skipped} dream/reconciler skipped (retry individually)`
        : "";
      push({ type: "success", message: `Re-queued ${n} failed task${n === 1 ? "" : "s"}${skip}` });
      reasoning.refetch();
      queue.refetch();
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    } finally {
      setRetryAllBusy(false);
    }
  };

  // Click a status stat-tile to filter; click the active one again to clear back to "all".
  const toggleStatus = (s: string) => setStatusFilter((prev) => (prev === s ? "all" : s));

  const opUnavailable = !!reasoning.data && !reasoning.data.available;

  return (
    <div className="space-y-3">
      <PageHeader
        title="REASONING"
        subtitle="background inference tasks that build peer representations"
        actions={
          <div className="flex items-center gap-2">
            <RefreshButton
              label="REFRESH"
              onClick={() => {
                reasoning.refetch();
                queue.refetch();
                conclusions.refetch();
              }}
            />
            {canWrite ? (
              <Button
                variant="warning"
                icon="refresh"
                onClick={doRetryAll}
                disabled={!workspaceId || !counts?.failed || retryAllBusy}
                title={counts?.failed ? `Retry all ${counts.failed} failed tasks` : "No failed tasks"}
              >
                RETRY_FAILED
              </Button>
            ) : null}
            {canWrite ? (
              <Button icon="sparkles" onClick={openDream} disabled={!workspaceId}>
                SCHEDULE_DREAM
              </Button>
            ) : null}
          </div>
        }
      />

      {!workspaceId ? (
        <Panel title="NO_WORKSPACE">
          <div className="text-xs text-text-muted py-4">Select a workspace in the sidebar.</div>
        </Panel>
      ) : opUnavailable ? (
        <Panel title="OPERATOR_DB_UNAVAILABLE" status="processing">
          <div className="text-xs text-text-muted leading-relaxed">
            Per-task reasoning records come from the queue table via the operator DB layer, which
            isn&apos;t available: <span className="text-red-400">{reasoning.data?.reason}</span>.
            Honcho&apos;s REST API only exposes aggregate counters:
          </div>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile label="pending" value={queue.data?.pending_work_units ?? 0} hint="awaiting" hintTone="muted" />
            <StatTile label="in_progress" value={processing} hint="in-flight" hintTone="accent" />
            <StatTile label="completed" value={queue.data?.completed_work_units ?? 0} hint="" hintTone="muted" />
            <StatTile label="total" value={queue.data?.total_work_units ?? 0} hint="" hintTone="muted" />
          </div>
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatTile
              label="queued"
              value={(counts?.queued ?? 0).toLocaleString()}
              hint="awaiting"
              hintTone="muted"
              onClick={() => toggleStatus("queued")}
              active={statusFilter === "queued"}
            />
            <StatTile
              label="processing"
              value={processing.toLocaleString()}
              hint="in-flight"
              hintTone="accent"
              className="!border-accent/40"
            />
            <StatTile
              label="completed"
              value={(counts?.completed ?? 0).toLocaleString()}
              hint="all-time"
              hintTone="muted"
              onClick={() => toggleStatus("completed")}
              active={statusFilter === "completed"}
            />
            <StatTile
              label="failed"
              value={
                <span className={counts?.failed ? "text-red-400" : "text-text-primary"}>
                  {(counts?.failed ?? 0).toLocaleString()}
                </span>
              }
              hint="needs review"
              hintTone="danger"
              className={counts?.failed ? "!border-red-500/40" : ""}
              onClick={() => toggleStatus("failed")}
              active={statusFilter === "failed"}
            />
            <StatTile
              label="tokens_pending"
              value={(counts?.tokens_pending ?? 0).toLocaleString()}
              hint="estimated"
              hintTone="muted"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <Filter
              label="status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={["all", "queued", "completed", "failed"]}
            />
            <Filter label="type" value={typeFilter} onChange={setTypeFilter} options={typeOptions} />
          </div>

          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-12 lg:col-span-8">
              <Panel
                title="REASONING_QUEUE"
                status={processing > 0 ? "processing" : "active"}
              >
                {reasoning.isLoading && tasks.length === 0 ? (
                  <div className="space-y-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="h-10 bg-border/40 animate-pulse" />
                    ))}
                  </div>
                ) : tasks.length === 0 ? (
                  <div className="text-center py-8 text-text-muted text-xs">
                    No reasoning tasks match filters.
                  </div>
                ) : (
                  <div className="space-y-2">
                    <AnimatePresence initial={false}>
                      {tasks.map((t, i) => (
                        <ReasoningTaskItem
                          key={t.id}
                          t={t}
                          index={i}
                          canRetry={canWrite}
                          onRetry={() => doRetry(t)}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                )}
                <div className="mt-3 text-[10px] text-text-muted">
                  operator/db · queue table · showing latest {tasks.length} of{" "}
                  {(counts?.total ?? 0).toLocaleString()} tasks
                </div>
              </Panel>
            </div>

            <div className="col-span-12 lg:col-span-4 space-y-3">
              <Panel title="TASK_TYPES">
                {byType.length === 0 ? (
                  <div className="text-[11px] text-text-muted">No tasks recorded.</div>
                ) : (
                  <div className="space-y-2">
                    {byType.map((t) => (
                      <div key={t.type} className="flex items-center justify-between gap-2 text-[11px]">
                        <Chip tone={TYPE_TONES[t.type] || "muted"}>{t.type}</Chip>
                        <span className="text-text-primary tabular-nums">{t.n.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel title="CONCLUSIONS_STATS">
                {conclusions.data?.available ? (
                  <div className="space-y-1.5 text-xs">
                    <Row k="total_conclusions" v={(conclusions.data.total ?? 0).toLocaleString()} />
                    {(conclusions.data.by_observer ?? []).slice(0, 4).map((o) => (
                      <Row key={o.observer_id} k={o.observer_id} v={o.n.toLocaleString()} />
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-text-muted">
                    {conclusions.isLoading ? "loading…" : "Conclusion stats need the operator DB."}
                  </div>
                )}
              </Panel>

              <Panel title="REASONING_CONFIG">
                {config ? (
                  <div className="space-y-1.5 text-xs">
                    <Row k="reasoning" v={<Bool v={nested(config, "reasoning", "enabled")} />} />
                    <Row k="summary" v={<Bool v={nested(config, "summary", "enabled")} />} />
                    <Row k="short_summary_every" v={String(nested(config, "summary", "messages_per_short_summary") ?? "—")} />
                    <Row k="long_summary_every" v={String(nested(config, "summary", "messages_per_long_summary") ?? "—")} />
                    <Row k="peer_card.use" v={<Bool v={nested(config, "peer_card", "use")} />} />
                    <Row k="peer_card.create" v={<Bool v={nested(config, "peer_card", "create")} />} />
                    <Row k="dream" v={<Bool v={nested(config, "dream", "enabled")} />} />
                  </div>
                ) : (
                  <div className="text-[11px] text-text-muted">No configuration captured on recent tasks.</div>
                )}
              </Panel>
            </div>
          </div>
        </>
      )}

      <StatusBar />

      <Modal
        title="SCHEDULE_DREAM"
        open={dreamOpen}
        onClose={() => setDreamOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDreamOpen(false)} disabled={dreamBusy}>
              CANCEL
            </Button>
            <Button variant="primary" onClick={submitDream} disabled={dreamBusy}>
              {dreamBusy ? "SCHEDULING…" : "SCHEDULE"}
            </Button>
          </>
        }
      >
        <div className="text-[11px] text-text-muted">
          Queues a consolidation pass over a peer&apos;s representation in{" "}
          <span className="text-accent font-mono">{workspaceId}</span>.
        </div>
        <Field label="OBSERVER" hint="Peer whose representation gets dreamed on. Required.">
          <TextInput
            autoFocus
            placeholder="e.g., peer_alice_001"
            value={dreamObserver}
            onChange={(e) => setDreamObserver(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !dreamBusy) submitDream();
            }}
          />
        </Field>
        <Field label="OBSERVED" hint="Optional — dream on this peer's representation from the observer's perspective.">
          <TextInput
            placeholder="(optional)"
            value={dreamObserved}
            onChange={(e) => setDreamObserved(e.target.value)}
          />
        </Field>
        <Field label="SESSION" hint="Optional — scope the dream to a single session.">
          <TextInput
            placeholder="(optional)"
            value={dreamSession}
            onChange={(e) => setDreamSession(e.target.value)}
          />
        </Field>
      </Modal>
    </div>
  );
}

function nested(obj: Record<string, unknown> | null, key: string, sub: string): unknown {
  const v = obj?.[key];
  if (v && typeof v === "object") return (v as Record<string, unknown>)[sub];
  return undefined;
}

function Bool({ v }: { v: unknown }) {
  if (v === true) return <span className="text-accent">enabled</span>;
  if (v === false) return <span className="text-text-muted">disabled</span>;
  return <span className="text-text-muted">—</span>;
}

function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon name="filter" size={12} className="text-text-muted" />
      <span className="text-text-muted">{label}:</span>
      <Select
        value={value}
        onChange={onChange}
        options={options.map((o) => ({ value: o, label: o }))}
        className="min-w-[120px]"
        triggerClassName="py-1.5"
      />
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-text-muted truncate">{k}</span>
      <span className="text-accent tabular-nums shrink-0">{v}</span>
    </div>
  );
}

/**
 * One queue row. Collapsed: status / type / peer / session / tokens / time.
 * Expanded (click): full error, task metadata, and the raw `queue.payload`
 * JSONB the deriver acts on — the actual "content of the box".
 */
function ReasoningTaskItem({
  t,
  index,
  canRetry,
  onRetry,
}: {
  t: ReasoningTaskRow;
  index: number;
  canRetry: boolean;
  onRetry: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { push } = useToast();
  const failed = t.status === "failed";
  const payloadText = useMemo(
    () => (t.payload ? JSON.stringify(t.payload, null, 2) : ""),
    [t.payload],
  );

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      push({ type: "success", message: `${label} copied` });
    } catch {
      push({ type: "error", message: "Clipboard unavailable" });
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 100, transition: { duration: 0.2 } }}
      transition={{ delay: Math.min(index * 0.03, 0.3), duration: 0.2 }}
      className={cn(
        "border bg-void/40 transition-colors duration-150",
        failed
          ? cn("bg-red-500/5", expanded ? "border-red-400/60" : "border-red-500/40 hover:border-red-400/60")
          : expanded
            ? "border-accent/50"
            : "border-border hover:border-accent/50",
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-3 px-3 py-2 text-left"
      >
        <span className="shrink-0">
          {failed ? (
            <Icon name="x-circle" className="text-red-400" size={14} />
          ) : t.status === "completed" ? (
            <Icon name="check" className="text-accent" size={14} />
          ) : (
            <Icon name="clock" className="text-text-muted" size={14} />
          )}
        </span>
        <Chip tone={TYPE_TONES[t.task_type] || "muted"}>{t.task_type}</Chip>
        <span className="text-xs text-text-primary font-mono truncate max-w-[120px]">
          {t.peer ?? "—"}
        </span>
        <span className="text-[10px] text-text-muted truncate max-w-[200px] hidden md:inline">
          {t.session_id}
        </span>
        {t.error && !expanded ? (
          <span className="text-[10px] text-red-400 truncate max-w-[200px]">{t.error}</span>
        ) : null}
        <div className="ml-auto flex items-center gap-3 text-[10px] text-text-muted shrink-0">
          {t.token_count ? (
            <span className="text-text-primary tabular-nums">
              {t.token_count.toLocaleString()} tokens
            </span>
          ) : null}
          <span>{new Date(t.created_at).toLocaleString()}</span>
          <Icon
            name="chevron-right"
            size={12}
            className={cn("transition-transform", expanded && "rotate-90")}
          />
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            key="expanded"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-3 space-y-3 border-t border-border">
              {t.error ? (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-red-400 uppercase tracking-wider">ERROR</span>
                    <CopyChip onClick={() => copy("Error", t.error!)} />
                  </div>
                  <pre className="bg-void border border-red-500/30 text-[11px] text-red-300 px-3 py-2 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                    {t.error}
                  </pre>
                </div>
              ) : null}

              {t.payload ? <PayloadSummary payload={t.payload} /> : null}

              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                <Meta k="status" v={t.status} />
                <Meta k="task_type" v={t.task_type} />
                <Meta k="queue_id" v={t.id} />
                <Meta k="message_id" v={t.message_id ?? "—"} />
                <Meta k="peer" v={t.peer ?? "—"} />
                <Meta k="session" v={t.session_id} />
                {t.work_unit_key ? <Meta k="work_unit_key" v={t.work_unit_key} span /> : null}
                <Meta k="tokens" v={t.token_count ? t.token_count.toLocaleString() : "—"} />
                <Meta k="created" v={new Date(t.created_at).toLocaleString()} />
              </div>

              {payloadText ? (
                <RawPayload text={payloadText} onCopy={() => copy("Payload", payloadText)} />
              ) : (
                <div className="text-[11px] text-text-muted italic">No payload recorded.</div>
              )}

              {failed && canRetry ? (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button variant="primary" size="sm" icon="refresh" onClick={onRetry}>
                    RETRY_TASK
                  </Button>
                  <span className="text-[10px] text-text-muted">
                    clears the error and re-queues this task for the deriver
                  </span>
                </div>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

function Meta({ k, v, span }: { k: string; v: React.ReactNode; span?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-2 min-w-0", span && "col-span-2")}>
      <span className="text-text-muted shrink-0">{k}</span>
      <span
        className="text-text-primary font-mono truncate text-right"
        title={typeof v === "string" ? v : undefined}
      >
        {v}
      </span>
    </div>
  );
}

function CopyChip({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider text-text-muted hover:text-accent transition-colors"
      title="Copy to clipboard"
    >
      <Icon name="copy" size={11} /> copy
    </button>
  );
}

/**
 * Human-readable view of a queue task's payload. Surfaces the fields that
 * actually matter (the message content, observers, webhook event/data) instead
 * of raw JSON; the full payload stays available under RAW_PAYLOAD.
 */
function PayloadSummary({ payload }: { payload: Record<string, unknown> }) {
  const str = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string) : null);
  const content = str("content");
  const eventType = str("event_type");
  const observers = Array.isArray(payload.observers)
    ? (payload.observers as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const data =
    payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
      ? (payload.data as Record<string, unknown>)
      : null;

  if (!content && !eventType && !observers.length && !data) return null;

  return (
    <div className="space-y-2">
      {content ? (
        <div>
          <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">MESSAGE</div>
          <div className="text-xs text-text-primary bg-void border border-border px-3 py-2 whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto">
            {content}
          </div>
        </div>
      ) : null}

      {eventType ? (
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-text-muted">event</span>
          <Chip tone="orange">{eventType}</Chip>
        </div>
      ) : null}

      {observers.length ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-text-muted">observers</span>
          {observers.map((o) => (
            <Chip key={o} tone="blue">
              {o}
            </Chip>
          ))}
        </div>
      ) : null}

      {data ? (
        <div>
          <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">DATA</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            {Object.entries(data).map(([k, v]) => (
              <Meta
                key={k}
                k={k}
                v={
                  v !== null && typeof v === "object"
                    ? Array.isArray(v)
                      ? `[${v.length}]`
                      : "{…}"
                    : String(v)
                }
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Collapsible raw-JSON payload, default closed (the parsed view is primary). */
function RawPayload({ text, onCopy }: { text: string; onCopy: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-1 text-[10px] text-text-muted uppercase tracking-wider hover:text-text-primary transition-colors"
        >
          <Icon
            name="chevron-right"
            size={11}
            className={cn("transition-transform", open && "rotate-90")}
          />
          RAW_PAYLOAD
        </button>
        {open ? <CopyChip onClick={onCopy} /> : null}
      </div>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="raw"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <pre className="bg-void border border-border text-[11px] text-text-primary px-3 py-2 overflow-auto max-h-80 leading-relaxed">
              {text}
            </pre>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
