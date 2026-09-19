"use client";

import { Panel } from "@/components/Panel";
import { HonchoFeatureNotice } from "@/components/HonchoFeatureNotice";
import { formatApiError } from "@/lib/honcho/useQuery";
import type { useDeriverMetrics } from "@/lib/honcho/useDeriverMetrics";
import { formatDuration } from "@/lib/honcho/deriverMetrics";

export function DeriverBacklog({ metrics }: { metrics: ReturnType<typeof useDeriverMetrics> }) {
  const state = metrics.capability;
  const data = metrics.data;
  const errorStatus = (metrics.error as { status?: number } | undefined)?.status;
  return <Panel title="INSTANCE_BACKLOG" status={metrics.isFetching ? "processing" : data ? "active" : "idle"}>
    <p className="text-[11px] text-text-primary mb-3">Service-wide snapshot across all workspaces. Updates every 10s; these values are not per-workspace totals.</p>
    <HonchoFeatureNotice state={state} minimum="3.1.2" feature="Backlog metrics" />
    {state === "available" ? metrics.isLoading ? <p className="text-xs text-text-primary" role="status">Loading backlog…</p>
      : metrics.error ? <p className="text-[11px] text-red-400 break-words" role="alert">
        {errorStatus === 503 ? "No deriver measurement is available yet. Retrying automatically."
          : errorStatus === 401 || errorStatus === 403 ? "Backlog access denied. Check the key in CONFIG."
          : errorStatus === 404 ? "This deployment does not expose deriver metrics."
          : `${formatApiError(metrics.error)} · Check the connection in CONFIG.`}
      </p>
      : data ? <>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3">
          {([
            ["ESTIMATED_WORK", formatDuration(data.outstanding_work_seconds)],
            ["OLDEST_PENDING", formatDuration(data.oldest_pending_age_seconds)],
            ["ELIGIBLE_UNITS", data.eligible_work_units.toLocaleString()],
            ["CLAIMED_UNITS", data.claimed_work_units.toLocaleString()],
            ["PENDING_ITEMS", data.pending_items.toLocaleString()],
            ["DREAMS_DUE", data.dreams_due.toLocaleString()],
            ["EMBEDDINGS_PENDING", data.embeddings_pending.toLocaleString()],
            ["EMBEDDINGS_DUE", data.embeddings_pending_due.toLocaleString()],
          ]).map(([label, value]) => <div key={label} className="min-w-0">
            <dt className="text-[10px] text-text-muted break-words">{label}</dt>
            <dd className="text-xs text-text-primary tabular-nums mt-1">{value}</dd>
          </div>)}
        </dl>
        <p className={`text-[10px] mt-3 pt-2 border-t border-border ${data.measurement_age_seconds > 60 ? "text-yellow-400" : "text-text-muted"}`}>
          {data.measurement_age_seconds > 60 ? "STALE · " : "MEASURED · "}{new Date(data.measured_at * 1000).toLocaleString()} · {formatDuration(data.measurement_age_seconds)} old at fetch · Work estimate is not a completion time.
        </p>
      </> : <p className="text-xs text-text-primary">No measurement returned.</p> : null}
  </Panel>;
}
