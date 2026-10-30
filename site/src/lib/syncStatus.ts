import type { ApiQueueStatus } from "./honcho/types";
import type { QueueFailuresResult } from "./operator/db";

export type SyncState = "synced" | "syncing" | "empty";

export interface QueueProgress {
  state: SyncState;
  total: number;
  done: number;
  pending: number;
  running: number;
  /** Completed share of all work units, 0–100; null when there is no work yet. */
  percent: number | null;
}

/** Summarize Honcho's aggregate queue counters for the status bar. */
export function queueProgress(queue: ApiQueueStatus): QueueProgress {
  const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);
  const total = count(queue.total_work_units);
  const done = Math.min(count(queue.completed_work_units), total);
  const pending = count(queue.pending_work_units);
  const running = count(queue.in_progress_work_units);
  return {
    state: total === 0 ? "empty" : pending + running > 0 ? "syncing" : "synced",
    total,
    done,
    pending,
    running,
    percent: total === 0 ? null : Math.floor((done / total) * 100),
  };
}

/** Poll faster while work is queued so progress is visible; back off when idle. */
export function queuePollInterval(queue: ApiQueueStatus | undefined): number {
  if (!queue) return 10_000;
  return queueProgress(queue).state === "syncing" ? 3_000 : 10_000;
}

/** Compact "updated …" age for a timestamp in epoch ms. */
export function formatAge(updatedAt: number | undefined, now: number): string {
  if (updatedAt === undefined) return "not yet";
  const seconds = Math.max(0, Math.floor((now - updatedAt) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

/** `#/reasoning` opened with this flag starts on the failed tasks. */
export const FAILED_TASKS_HREF = "#/reasoning?status=failed";

/**
 * Failed deriver queue items to show beside the queue, or null when there is
 * nothing to show: no workspace, no operator database, or no failures. Honcho's
 * API has no failure count, so without the database the dashboard cannot know
 * and shows nothing rather than a misleading zero.
 */
export function failedCount(result: QueueFailuresResult | undefined, workspaceId: string | null | undefined): number | null {
  if (!result || !result.available || !workspaceId) return null;
  // The last response may belong to the workspace selected before this one.
  if (result.workspace_id !== workspaceId) return null;
  return Number.isFinite(result.failed) && result.failed > 0 ? result.failed : null;
}
