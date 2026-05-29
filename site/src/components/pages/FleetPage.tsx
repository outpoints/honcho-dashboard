"use client";

import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { StatTile, Chip, Button, RefreshButton } from "@/components/atoms";
import { Icon } from "@/components/icons";
import { useNav } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { honcho } from "@/lib/honcho/client";
import { useActiveWorkspace } from "@/lib/honcho/config";
import { getSdk } from "@/lib/honcho/sdk";
import { toApiQueueStatus } from "@/lib/honcho/adapters";
import { formatApiError, useHonchoQuery } from "@/lib/honcho/useQuery";
import type { ApiQueueStatus, ApiWorkspace } from "@/lib/honcho/types";

const REFRESH_MS = 10_000;
const PAGE_SIZE = 100;

/** One workspace + its queue snapshot. `queue` is null when that workspace's
 * queue/status call failed (the workspaces list still succeeded). */
interface FleetRow {
  workspace: ApiWorkspace;
  queue: ApiQueueStatus | null;
}

interface FleetData {
  rows: FleetRow[];
  total: number; // total workspaces reported by the API (may exceed rows.length)
}

type WorkspaceStatus = "processing" | "queued" | "idle" | "unknown";

function deriveStatus(q: ApiQueueStatus | null): WorkspaceStatus {
  if (!q) return "unknown";
  if (q.in_progress_work_units > 0) return "processing";
  if (q.pending_work_units > 0) return "queued";
  return "idle";
}

const STATUS_RANK: Record<WorkspaceStatus, number> = {
  processing: 0,
  queued: 1,
  idle: 2,
  unknown: 3,
};

export function FleetPage() {
  const { navigate } = useNav();
  const { workspaceId: activeWorkspaceId, setWorkspaceId } = useActiveWorkspace();

  const fleet = useHonchoQuery<FleetData>(
    "fleet/queue-status",
    async (o) => {
      const page = await honcho.workspaces.list(o, { size: PAGE_SIZE });
      // Fan out one queue/status call per workspace. A single workspace failing
      // (deleted mid-poll, permissions, etc.) degrades that row, not the page.
      const rows = await Promise.all(
        page.items.map(async (workspace): Promise<FleetRow> => {
          try {
            const queue = toApiQueueStatus(await getSdk(o, workspace.id).queueStatus());
            return { workspace, queue };
          } catch {
            return { workspace, queue: null };
          }
        }),
      );
      return { rows, total: page.total };
    },
    { refreshInterval: REFRESH_MS },
  );

  const rows = useMemo(() => fleet.data?.rows ?? [], [fleet.data]);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const ra = STATUS_RANK[deriveStatus(a.queue)];
      const rb = STATUS_RANK[deriveStatus(b.queue)];
      if (ra !== rb) return ra - rb;
      const ta = a.queue?.total_work_units ?? 0;
      const tb = b.queue?.total_work_units ?? 0;
      if (ta !== tb) return tb - ta;
      return a.workspace.id.localeCompare(b.workspace.id);
    });
  }, [rows]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => {
          if (r.queue) {
            acc.total += r.queue.total_work_units;
            acc.done += r.queue.completed_work_units;
            acc.active += r.queue.in_progress_work_units;
            acc.pending += r.queue.pending_work_units;
          }
          return acc;
        },
        { total: 0, done: 0, active: 0, pending: 0 },
      ),
    [rows],
  );

  const unreachable = rows.filter((r) => r.queue === null).length;
  const anyActive = totals.active > 0 || totals.pending > 0;
  const wsTotal = fleet.data?.total ?? rows.length;

  const openWorkspace = (id: string) => {
    setWorkspaceId(id);
    navigate("reasoning");
  };

  return (
    <div className="space-y-3">
      <PageHeader
        title="FLEET"
        subtitle="every workspace on this instance at a glance — live queue status across the fleet"
        actions={
          <div className="flex items-center gap-2">
            {!fleet.isLoading && !fleet.error ? (
              <Chip tone="accent" icon="layers">
                {wsTotal.toLocaleString()} workspaces
              </Chip>
            ) : null}
            <RefreshButton label="REFRESH" onClick={() => fleet.refetch()} />
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          delay={0}
          label="workspaces"
          value={fleet.isLoading ? "…" : wsTotal.toLocaleString()}
          hint={<><Icon name="layers" size={10} /> on this instance</>}
          hintTone="muted"
        />
        <StatTile
          delay={0.05}
          label="total_done"
          value={
            fleet.isLoading ? (
              "…"
            ) : (
              <span className={totals.done ? "text-accent" : undefined}>
                {totals.done.toLocaleString()}
              </span>
            )
          }
          hint={<><Icon name="check" size={10} /> completed work units</>}
          hintTone="accent"
        />
        <StatTile
          delay={0.1}
          label="active"
          value={
            fleet.isLoading ? (
              "…"
            ) : (
              <span className={totals.active ? "text-yellow-400" : undefined}>
                {totals.active.toLocaleString()}
              </span>
            )
          }
          hint={<><Icon name="zap" size={10} /> in-flight now</>}
          hintTone={totals.active ? "warn" : "muted"}
          className={totals.active ? "!border-yellow-500/40" : undefined}
        />
        <StatTile
          delay={0.15}
          label="pending"
          value={
            fleet.isLoading ? (
              "…"
            ) : (
              <span className={totals.pending ? "text-blue-400" : undefined}>
                {totals.pending.toLocaleString()}
              </span>
            )
          }
          hint={<><Icon name="clock" size={10} /> awaiting workers</>}
          hintTone="muted"
        />
      </div>

      {fleet.error ? (
        <Panel title="ERROR" status="processing">
          <div className="text-xs text-red-400">{formatApiError(fleet.error)}</div>
          <div className="text-[10px] text-text-muted mt-2">
            Check your Honcho instance in <span className="text-accent">#/config</span>.
          </div>
        </Panel>
      ) : (
        <Panel
          title="QUEUE_STATUS"
          status={anyActive ? "processing" : "active"}
          bodyClassName="p-0"
          actions={
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-accent/10 border border-accent/30">
              <span className="w-1.5 h-1.5 bg-accent animate-pulse" />
              <span className="text-[9px] text-accent uppercase">live</span>
            </span>
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-2.5 pb-2 border-b border-border">
            <span className="text-text-muted text-[10px] uppercase tracking-wider">
              &gt; all workspaces · updates every {REFRESH_MS / 1000}s
            </span>
            {unreachable > 0 ? (
              <Chip tone="warn" icon="warning">
                {unreachable} unreachable
              </Chip>
            ) : null}
          </div>

          {fleet.isLoading ? (
            <FleetSkeleton />
          ) : sorted.length === 0 ? (
            <EmptyState onCreate={() => navigate("workspaces")} />
          ) : (
            <FleetTable
              rows={sorted}
              activeWorkspaceId={activeWorkspaceId}
              onOpen={openWorkspace}
            />
          )}
        </Panel>
      )}

      <StatusBar />
    </div>
  );
}

const COL_HEAD =
  "px-3 py-2 text-[10px] uppercase tracking-wider text-text-muted font-normal";
const NUM_CELL = "px-3 py-2.5 text-right text-xs tabular-nums";

function FleetTable({
  rows,
  activeWorkspaceId,
  onOpen,
}: {
  rows: FleetRow[];
  activeWorkspaceId: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className={cn(COL_HEAD, "text-left")}>workspace</th>
            <th className={cn(COL_HEAD, "text-left")}>status</th>
            <th className={cn(COL_HEAD, "text-right")}>total</th>
            <th className={cn(COL_HEAD, "text-right")}>done</th>
            <th className={cn(COL_HEAD, "text-right")}>active</th>
            <th className={cn(COL_HEAD, "text-right")}>pending</th>
          </tr>
        </thead>
        <tbody>
          <AnimatePresence initial={false}>
            {rows.map((r, i) => (
              <FleetTableRow
                key={r.workspace.id}
                row={r}
                index={i}
                isActive={r.workspace.id === activeWorkspaceId}
                onOpen={onOpen}
              />
            ))}
          </AnimatePresence>
        </tbody>
      </table>
    </div>
  );
}

function FleetTableRow({
  row,
  index,
  isActive,
  onOpen,
}: {
  row: FleetRow;
  index: number;
  isActive: boolean;
  onOpen: (id: string) => void;
}) {
  const { workspace: w, queue: q } = row;
  const status = deriveStatus(q);

  return (
    <motion.tr
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.25), duration: 0.2 }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${w.id} queue detail`}
      onClick={() => onOpen(w.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(w.id);
        }
      }}
      className={cn(
        "group cursor-pointer border-b border-border transition-colors duration-150 outline-none",
        "hover:bg-accent/5 focus-visible:bg-accent/10",
        isActive && "bg-accent/5",
      )}
    >
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              "w-0.5 h-4 shrink-0 transition-colors",
              isActive ? "bg-accent" : "bg-transparent group-hover:bg-accent/50",
            )}
            aria-hidden
          />
          <span className="text-xs font-mono text-text-primary truncate group-hover:text-accent transition-colors">
            {w.id}
          </span>
          <Icon
            name="chevron-right"
            size={11}
            className="text-text-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 group-hover:translate-x-0.5 transition-all shrink-0"
          />
        </div>
      </td>
      <td className="px-3 py-2.5">
        <StatusCell status={status} />
      </td>
      <td className={cn(NUM_CELL, q ? "text-text-primary" : "text-text-muted")}>
        {q ? q.total_work_units.toLocaleString() : "—"}
      </td>
      <td className={cn(NUM_CELL, q?.completed_work_units ? "text-accent" : "text-text-muted")}>
        {q ? q.completed_work_units.toLocaleString() : "—"}
      </td>
      <td className={cn(NUM_CELL, q?.in_progress_work_units ? "text-yellow-400" : "text-text-muted")}>
        {q ? q.in_progress_work_units.toLocaleString() : "—"}
      </td>
      <td className={cn(NUM_CELL, q?.pending_work_units ? "text-blue-400" : "text-text-muted")}>
        {q ? q.pending_work_units.toLocaleString() : "—"}
      </td>
    </motion.tr>
  );
}

function StatusCell({ status }: { status: WorkspaceStatus }) {
  if (status === "processing") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-yellow-400 uppercase tracking-wider">
        <span className="w-1.5 h-1.5 bg-yellow-400 animate-pulse" aria-hidden />
        Processing
      </span>
    );
  }
  if (status === "queued") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-yellow-400 uppercase tracking-wider">
        <Icon name="clock" size={12} />
        Queued
      </span>
    );
  }
  if (status === "unknown") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-text-muted uppercase tracking-wider">
        <Icon name="alert-circle" size={12} />
        Unreachable
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-accent uppercase tracking-wider">
      <Icon name="check" size={12} />
      Idle
    </span>
  );
}

function FleetSkeleton() {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-3 py-3">
          <div className="h-3 w-32 bg-border/60 animate-pulse" />
          <div className="h-3 w-16 bg-border/40 animate-pulse" />
          <div className="ml-auto flex items-center gap-6">
            <div className="h-3 w-8 bg-border/40 animate-pulse" />
            <div className="h-3 w-8 bg-border/40 animate-pulse" />
            <div className="h-3 w-8 bg-border/40 animate-pulse" />
            <div className="h-3 w-8 bg-border/40 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 gap-3">
      <Icon name="layers" size={32} className="text-text-muted" />
      <div className="text-xs text-text-muted">
        No workspaces on this Honcho instance yet.
      </div>
      <Button icon="plus" onClick={onCreate}>
        GO_TO_WORKSPACES
      </Button>
    </div>
  );
}
