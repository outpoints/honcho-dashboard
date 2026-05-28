"use client";

import { honcho } from "@/lib/honcho/client";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { getSdk } from "@/lib/honcho/sdk";
import { toApiQueueStatus } from "@/lib/honcho/adapters";
import { useHonchoQuery } from "@/lib/honcho/useQuery";
import type { ApiQueueStatus } from "@/lib/honcho/types";

export function StatusBar() {
  const apiOpts = useActiveHonchoOptions();
  const { workspaceId } = useActiveWorkspace();
  const health = useHonchoQuery("health", (o) => honcho.health(o), { refreshInterval: 15000 });
  const wsList = useHonchoQuery("workspaces/list?size=1", (o) =>
    honcho.workspaces.list(o, { size: 1 }),
  );
  const queue = useHonchoQuery<ApiQueueStatus>(
    workspaceId ? `sdk/workspaces/${workspaceId}/queue/status` : null,
    async (o) => toApiQueueStatus(await getSdk(o, workspaceId!).queueStatus()),
    { refreshInterval: 10000 },
  );

  const healthy = !health.error && health.data?.status === "ok";

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-surface border border-border text-[10px]">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1">
          <span className={"w-2 h-2 " + (healthy ? "bg-accent" : "bg-red-400")} />
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
        <span>
          <span className="text-text-muted">queue:</span>{" "}
          <span className="text-accent">
            {!workspaceId ? "—" : queue.isLoading ? "…" : `${queue.data?.pending_work_units ?? 0} pending`}
          </span>
        </span>
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
