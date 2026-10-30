"use client";

import { failedCount } from "@/lib/syncStatus";
import { useOperatorQuery } from "./client";
import type { QueueFailuresResult } from "./db";

/** Failures change rarely and stay until retried, so a slow poll is enough. */
export const QUEUE_FAILURES_INTERVAL_MS = 30_000;

/** Failed deriver queue items for the workspace, from the operator database (see `failedCount`). */
export function useQueueFailures(workspaceId: string | null | undefined): number | null {
  const { data } = useOperatorQuery<QueueFailuresResult>(
    workspaceId ? `/api/operator/db?view=queue_failures&workspace_id=${encodeURIComponent(workspaceId)}` : null,
    { refreshInterval: QUEUE_FAILURES_INTERVAL_MS },
  );
  return failedCount(data, workspaceId);
}
