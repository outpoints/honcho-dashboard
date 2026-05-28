"use client";

import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, RefreshButton } from "@/components/atoms";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { formatApiError, useHonchoQuery } from "@/lib/honcho/useQuery";
import { getSdk } from "@/lib/honcho/sdk";
import { toApiQueueStatus } from "@/lib/honcho/adapters";
import type { ApiQueueStatus } from "@/lib/honcho/types";
import { useToast } from "@/components/toast";
import { SkeletonRowList } from "@/components/Skeleton";
import { cn } from "@/lib/utils";

export function ReasoningPage() {
  const apiOpts = useActiveHonchoOptions();
  const { workspaceId } = useActiveWorkspace();
  const { push } = useToast();

  const key = workspaceId ? `sdk/workspaces/${workspaceId}/queue/status` : null;
  const { data, error, isLoading, refetch } = useHonchoQuery<ApiQueueStatus>(
    key,
    async (o) => toApiQueueStatus(await getSdk(o, workspaceId!).queueStatus()),
    { refreshInterval: 5000 },
  );

  const scheduleDream = async () => {
    if (!apiOpts || !workspaceId) return;
    const observer = window.prompt("Observer peer id for scheduled dream:");
    if (!observer) return;
    try {
      await getSdk(apiOpts, workspaceId).scheduleDream({ observer });
      push({ type: "success", message: `Dream scheduled for ${observer}` });
      refetch();
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    }
  };

  const sessions = data?.sessions ? Object.entries(data.sessions) : [];

  return (
    <div className="space-y-3">
      <PageHeader
        title="REASONING"
        subtitle={workspaceId ? `deriver work queue for ${workspaceId}` : "select a workspace"}
        actions={
          <div className="flex items-center gap-2">
            <RefreshButton label="REFRESH" onClick={refetch} />
            <Button onClick={scheduleDream} disabled={!workspaceId}>SCHEDULE_DREAM</Button>
          </div>
        }
      />

      {error ? (
        <Panel title="ERROR" status="processing">
          <div className="text-xs text-red-400">{formatApiError(error)}</div>
        </Panel>
      ) : !workspaceId ? (
        <Panel title="NO_WORKSPACE">
          <div className="text-xs text-text-muted py-4">Select a workspace in the sidebar.</div>
        </Panel>
      ) : isLoading || !data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-surface border border-border p-3">
                <div className="h-2 bg-border/40 animate-pulse w-1/3" />
                <div className="h-7 bg-border/60 animate-pulse mt-2 w-2/3" />
              </div>
            ))}
          </div>
          <Panel title="PER_SESSION_QUEUE">
            <SkeletonRowList count={4} />
          </Panel>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="pending" value={data.pending_work_units} tone="accent" />
            <Stat label="in_progress" value={data.in_progress_work_units} tone="warn" />
            <Stat label="completed" value={data.completed_work_units} tone="text" />
            <Stat label="total" value={data.total_work_units} tone="text" />
          </div>

          <Panel
            title="PER_SESSION_QUEUE"
            status={data.in_progress_work_units > 0 ? "processing" : "active"}
          >
            {sessions.length === 0 ? (
              <div className="text-xs text-text-muted py-4">
                No per-session queue data returned for this workspace.
              </div>
            ) : (
              <div className="space-y-1">
                {sessions.map(([sid, q]) => (
                  <div
                    key={sid}
                    className="flex items-center justify-between gap-3 px-2 py-1.5 bg-void/40 border border-border text-xs"
                  >
                    <span className="text-accent font-mono truncate">{sid}</span>
                    <div className="flex items-center gap-3 text-[10px]">
                      <Counter label="pending" value={q.pending_work_units} tone="accent" />
                      <Counter label="active" value={q.in_progress_work_units} tone="warn" />
                      <Counter label="done" value={q.completed_work_units} tone="muted" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 text-[10px] text-text-muted">
              GET /v3/workspaces/{workspaceId ?? "—"}/queue/status · auto-refresh every 5s
            </div>
          </Panel>

          <Panel title="API_NOTE">
            <div className="text-[11px] text-text-muted leading-relaxed">
              The original UI listed per-task reasoning items (deductive, abductive, summary, …).
              Honcho v3 only exposes aggregated work-unit counters via{" "}
              <span className="text-accent">/queue/status</span>; individual task records are not
              part of the public API. What you see above is everything the server returns.
            </div>
          </Panel>
        </>
      )}

      <StatusBar />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "accent" | "warn" | "text" }) {
  const cls = tone === "accent" ? "text-accent" : tone === "warn" ? "text-yellow-400" : "text-text-primary";
  return (
    <div className="bg-surface border border-border p-3">
      <div className="text-[10px] text-text-muted uppercase tracking-wider">&gt; {label}</div>
      <div className={cn("font-pixel text-3xl tracking-wider mt-1", cls)}>{value.toLocaleString()}</div>
    </div>
  );
}

function Counter({ label, value, tone }: { label: string; value: number; tone: "accent" | "warn" | "muted" }) {
  const cls = tone === "accent" ? "text-accent" : tone === "warn" ? "text-yellow-400" : "text-text-muted";
  return (
    <span className={cls}>
      {label}: <span className="font-mono">{value}</span>
    </span>
  );
}
