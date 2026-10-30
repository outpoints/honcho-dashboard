"use client";

import { Icon } from "@/components/icons";
import { honcho } from "@/lib/honcho/client";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { useHonchoQuery } from "@/lib/honcho/useQuery";
import type { ApiQueueStatus } from "@/lib/honcho/types";
import { FAILED_TASKS_HREF, queuePollInterval, queueProgress } from "@/lib/syncStatus";
import { useQueueFailures } from "@/lib/operator/queueFailures";
import { RelativeAge } from "@/components/RelativeAge";
import { useWriteActions } from "@/lib/writeActions";
import { cn } from "@/lib/utils";

export function StatusBar() {
  const apiOpts = useActiveHonchoOptions();
  const { workspaceId } = useActiveWorkspace();
  const { enabled: canWrite } = useWriteActions();
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
  const failed = useQueueFailures(workspaceId);
  // Icons and words carry state as well as color, so it reads without hue.
  const syncing = progress?.state === "syncing";
  const syncTone = syncing ? "text-yellow-400" : "text-accent";

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-surface border border-border text-[10px]">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1">
          <Icon
            name={health.isLoading ? "loader" : healthy ? "check" : "x-circle"}
            size={11}
            className={cn(health.isLoading ? "text-text-muted motion-safe:animate-spin" : healthy ? "text-accent" : "text-red-400")}
          />
          <span className="text-text-muted">instance:</span>
          <span className={healthy ? "text-accent" : "text-red-400"}>
            {health.isLoading ? "…" : healthy ? "healthy" : "unreachable"}
          </span>
        </span>
        <span className="text-text-muted">|</span>
        <span>
          <span className="text-text-muted">workspaces:</span>{" "}
          <span className="text-text-primary">{wsList.isLoading ? "…" : wsList.data?.total ?? "—"}</span>
        </span>
        <span className="text-text-muted">|</span>
        <span>
          <span className="text-text-muted">workspace:</span>{" "}
          <span className="text-text-primary">{workspaceId ?? "(none selected)"}</span>
        </span>
        <span className="text-text-muted">|</span>
        <span className="flex flex-wrap items-center gap-1.5" title="Honcho's deriver queue for this workspace">
          <span className="text-text-muted">queue:</span>
          {!workspaceId ? (
            <span className="text-text-muted">—</span>
          ) : queue.error ? (
            <span className="text-red-400">unavailable</span>
          ) : !progress ? (
            <span className="text-text-muted">…</span>
          ) : progress.state === "empty" ? (
            <span className="text-text-primary">0 pending · no work yet</span>
          ) : (
            <>
              <Icon
                name={syncing ? "refresh" : "check"}
                size={11}
                className={cn(syncTone, syncing && progress.running > 0 && "motion-safe:animate-spin")}
              />
              <span className={cn("tabular-nums", syncTone)}>
                {syncing ? `${progress.pending.toLocaleString()} pending` : "caught up"}
              </span>
              <span
                className="w-14 h-1 bg-void border border-border overflow-hidden"
                role="progressbar"
                aria-label="Work units completed"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress.percent ?? 0}
              >
                <span
                  className={cn("block h-full transition-[width] duration-200", syncing ? "bg-yellow-400" : "bg-accent")}
                  style={{ width: `${progress.percent ?? 0}%` }}
                />
              </span>
              <span className="text-text-muted tabular-nums">
                {progress.done.toLocaleString()}/{progress.total.toLocaleString()} done
                {progress.running ? ` · ${progress.running.toLocaleString()} running` : ""}
              </span>
            </>
          )}
          {failed ? (
            <a
              href={FAILED_TASKS_HREF}
              className="inline-flex items-center gap-1 tabular-nums text-red-400 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
              title="Deriver queue items that failed and need a retry. Opens Reasoning filtered to failed tasks."
            >
              · <Icon name="warning" size={10} /> {failed.toLocaleString()} failed
            </a>
          ) : null}
          {workspaceId && queue.updatedAt !== undefined ? (
            <span className="text-text-muted tabular-nums">· <RelativeAge at={queue.updatedAt} /></span>
          ) : null}
        </span>
        {workspaceId && canWrite ? (
          <a
            href="#/reasoning?dream=1"
            className="inline-flex items-center gap-1 border border-border-light px-1.5 py-0.5 uppercase tracking-wider text-text-muted hover:text-accent hover:border-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent transition-colors duration-150"
            title="Schedule a dream for a peer in this workspace"
          >
            <Icon name="sparkles" size={10} /> SCHEDULE_DREAM
          </a>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <span>
          <span className="text-text-muted">endpoint:</span>{" "}
          <span className="text-text-primary font-mono">{apiOpts?.baseUrl ?? "—"}</span>
        </span>
      </div>
    </div>
  );
}
