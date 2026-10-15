/** Shape of GET /api/operator/runtime. Client-safe (no server-only imports). */
export interface RuntimeInfo {
  available: boolean;
  reason?: string;
  dashboard_uptime_s: number;
  node_version: string;
  dashboard_version?: string;
  honcho_runtime_start_ts?: string | null;
  honcho_uptime_s?: number | null;
  /** True when HONCHO_OPERATOR_WRITES allows the queue retry actions. */
  writes_enabled: boolean;
}
