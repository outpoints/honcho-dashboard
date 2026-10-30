"use client";

import { Fragment } from "react";
import Image from "next/image";
import { Icon, type IconName } from "@/components/icons";
import { NAV_ITEMS } from "@/lib/data";
import type { RouteKey } from "@/types/honcho";
import { cn } from "@/lib/utils";
import { WorkspaceSelector } from "@/components/WorkspaceSelector";
import { honcho } from "@/lib/honcho/client";
import { useActiveWorkspace } from "@/lib/honcho/config";
import { useHonchoQuery } from "@/lib/honcho/useQuery";
import type { ApiQueueStatus } from "@/lib/honcho/types";
import { FAILED_TASKS_HREF, queuePollInterval, queueProgress } from "@/lib/syncStatus";
import { useQueueFailures } from "@/lib/operator/queueFailures";
import { RelativeAge } from "@/components/RelativeAge";

export interface SidebarProps {
  current: RouteKey;
  onNavigate: (key: RouteKey) => void;
}

export function Sidebar({ current, onNavigate }: SidebarProps) {
  const { workspaceId } = useActiveWorkspace();
  const health = useHonchoQuery("health", (o) => honcho.health(o), { refreshInterval: 15000 });
  const wsList = useHonchoQuery("workspaces/list?size=1", (o) =>
    honcho.workspaces.list(o, { size: 1 }),
  );
  const queue = useHonchoQuery<ApiQueueStatus>(
    workspaceId ? `sdk/workspaces/${workspaceId}/queue/status` : null,
    (o) => honcho.queue.status(o, workspaceId!),
    { refreshInterval: queuePollInterval },
  );

  const healthy = !health.error && health.data?.status === "ok";
  const progress = queue.data ? queueProgress(queue.data) : null;
  const syncing = progress?.state === "syncing";
  const failed = useQueueFailures(workspaceId);

  return (
    <aside className="hidden md:sticky md:top-0 md:h-screen md:self-start md:flex shrink-0 bg-surface border-r border-border flex-col w-48 relative z-10">
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between gap-3">
          <button className="flex items-center gap-2 text-left" onClick={() => onNavigate("fleet")}>
            <div className="w-6 h-6 flex items-center justify-center overflow-hidden">
              <Image src="/images/honcho-logo.svg" alt="Honcho logo" width={24} height={24} className="w-full h-full object-contain" />
            </div>
            <div className="leading-tight">
              <div className="text-[11px] font-semibold tracking-wider">HONCHO</div>
              <div className="text-[8px] text-text-muted tracking-wider">SELF-HOSTED</div>
            </div>
          </button>
        </div>
      </div>

      <div className="px-3 py-2 border-b border-border">
        <div className="text-[9px] text-text-muted uppercase tracking-wider mb-1">workspace</div>
        <WorkspaceSelector />
      </div>

      <nav className="flex-1 py-1.5 overflow-y-auto">
        {NAV_ITEMS.map((item, i) => {
          const isActive = item.key === current;
          const newSection = item.section && item.section !== NAV_ITEMS[i - 1]?.section;
          return (
            <Fragment key={item.key}>
              {newSection ? (
                <div
                  className={cn(
                    "px-3 pb-1 text-[8px] text-text-muted/70 uppercase tracking-[0.18em]",
                    i === 0 ? "pt-1" : "pt-3",
                  )}
                >
                  {item.section}
                </div>
              ) : null}
              <button
                onClick={() => onNavigate(item.key)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors relative",
                  isActive
                    ? "text-accent bg-accent/10"
                    : "text-text-muted hover:text-text-primary hover:bg-border/30",
                )}
              >
                <Icon name={item.icon as IconName} size={14} />
                <span className={cn("flex-1 text-left", isActive && "cursor-blink")}>
                  {isActive ? `> ${item.label}` : item.label}
                </span>
                {isActive ? <span className="absolute right-0 top-0 bottom-0 w-0.5 bg-accent" /> : null}
              </button>
            </Fragment>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border">
        <div className="text-[10px] text-text-muted mb-2">&gt; instance_status</div>
        <div className="space-y-1">
          <Row label="status" value={
            health.isLoading ? (
              <span className="text-text-muted">…</span>
            ) : healthy ? (
              <span className="text-accent flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-accent" />
                healthy
              </span>
            ) : (
              <span className="text-red-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-red-400" />
                unreachable
              </span>
            )
          } />
          <Row label="workspaces" value={
            wsList.isLoading ? "…" : wsList.error ? "—" : String(wsList.data?.total ?? 0)
          } />
          <Row
            label="queue"
            value={
              !workspaceId ? (
                <span className="text-text-muted">—</span>
              ) : queue.error ? (
                <span className="text-text-muted">unavailable</span>
              ) : !progress ? (
                <span className="text-text-muted">…</span>
              ) : progress.state === "empty" ? (
                <span className="text-text-primary">no work yet</span>
              ) : (
                // Icon and words carry the state as well as color.
                <span className={cn("flex items-center gap-1 tabular-nums", syncing ? "text-yellow-400" : "text-accent")}>
                  <Icon
                    name={syncing ? "refresh" : "check"}
                    size={10}
                    className={cn(syncing && progress.running > 0 && "motion-safe:animate-spin")}
                  />
                  {syncing ? `${progress.pending.toLocaleString()} pending` : "caught up"}
                </span>
              )
            }
          />
          {workspaceId && progress && progress.state !== "empty" && !queue.error ? (
            <div className="pt-1 space-y-1" title="Deriver work units for this workspace">
              <div
                className="h-1 bg-void border border-border overflow-hidden"
                role="progressbar"
                aria-label="Queue work units completed"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress.percent ?? 0}
              >
                <div
                  className={cn("h-full transition-[width] duration-300 ease-out", syncing ? "bg-yellow-400" : "bg-accent")}
                  style={{ width: `${progress.percent ?? 0}%` }}
                />
              </div>
              <div className="flex justify-between text-[9px] text-text-muted tabular-nums">
                <span>
                  {progress.done.toLocaleString()}/{progress.total.toLocaleString()} done
                  {progress.running ? ` · ${progress.running} running` : ""}
                </span>
              </div>
            </div>
          ) : null}
          {failed ? (
            <Row
              label="failed"
              value={
                // Failed items stay until retried; link straight to them.
                <a
                  href={FAILED_TASKS_HREF}
                  className="flex items-center gap-1 tabular-nums text-red-400 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                  title="Deriver queue items that failed and need a retry. Opens Reasoning filtered to failed tasks."
                >
                  <Icon name="warning" size={10} />
                  {failed.toLocaleString()} · review
                </a>
              }
            />
          ) : null}
          {workspaceId && queue.updatedAt !== undefined ? (
            <div className="text-[9px] text-text-muted tabular-nums"><RelativeAge at={queue.updatedAt} /></div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between text-[10px]">
      <span className="text-text-muted">{label}</span>
      <span className="truncate text-right max-w-[60%]">{value}</span>
    </div>
  );
}
