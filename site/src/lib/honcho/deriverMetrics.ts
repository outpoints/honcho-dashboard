export interface DeriverMetrics {
  outstanding_work_seconds: number;
  eligible_work_units: number;
  claimed_work_units: number;
  pending_items: number;
  oldest_pending_age_seconds: number;
  embeddings_pending: number;
  embeddings_pending_due: number;
  dreams_due: number;
  measured_at: number;
  measurement_age_seconds: number;
}

export function parseDeriverMetrics(value: unknown): DeriverMetrics {
  const keys: (keyof DeriverMetrics)[] = ["outstanding_work_seconds", "eligible_work_units", "claimed_work_units",
    "pending_items", "oldest_pending_age_seconds", "embeddings_pending", "embeddings_pending_due", "dreams_due",
    "measured_at", "measurement_age_seconds"];
  if (!value || typeof value !== "object") throw new Error("Invalid deriver metrics response");
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] !== "number" || !Number.isFinite(record[key]) || record[key] < 0) {
      throw new Error(`Invalid deriver metric: ${key}`);
    }
  }
  return value as DeriverMetrics;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor(seconds % 86400 / 3600)}h`;
}
