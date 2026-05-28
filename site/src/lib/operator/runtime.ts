import "server-only";

const DASHBOARD_START_MS = Date.now();

export interface RuntimeInfo {
  available: boolean;
  reason?: string;
  dashboard_uptime_s: number;
  node_version: string;
  dashboard_version?: string;
  honcho_runtime_start_ts?: string | null;
  honcho_uptime_s?: number | null;
}

export function runtimeInfo(): RuntimeInfo {
  const startEnv = process.env.HONCHO_RUNTIME_START_TS;
  let honchoUptime: number | null = null;
  let honchoStart: string | null = null;
  if (startEnv) {
    const parsed = new Date(startEnv);
    if (!Number.isNaN(parsed.getTime())) {
      honchoStart = parsed.toISOString();
      honchoUptime = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 1000));
    }
  }
  return {
    available: true,
    dashboard_uptime_s: Math.floor((Date.now() - DASHBOARD_START_MS) / 1000),
    node_version: process.version,
    dashboard_version: process.env.npm_package_version,
    honcho_runtime_start_ts: honchoStart,
    honcho_uptime_s: honchoUptime,
  };
}
