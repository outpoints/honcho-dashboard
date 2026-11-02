import "server-only";
import { dbHealth, dbSchemaFacts, dbStats } from "./db";
import { schemaProbes } from "./schemaHealth";
import { runtimeInfo } from "./runtime";
import { tailLogs } from "./logs";
import { isLocationAllowed } from "../honcho/allowlist";
import { safeFetch as followAllowedRedirect } from "./safeFetch";

export type ProbeStatus = "ok" | "warn" | "err" | "skip";

export interface Probe {
  id: string;
  category: "honcho" | "database" | "operator" | "logs";
  label: string;
  detail?: string;
  status: ProbeStatus;
  timing_ms?: number;
  message?: string;
}

export interface DiagnosticsResult {
  generated_at: string;
  honcho_base_url?: string;
  probes: Probe[];
}

function safeFetch(url: string, init: RequestInit): Promise<Response> {
  return followAllowedRedirect(url, init, isLocationAllowed);
}

async function probeHonchoHealth(baseUrl: string, token?: string): Promise<Probe> {
  const start = Date.now();
  try {
    const res = await safeFetch(`${baseUrl.replace(/\/+$/, "")}/health`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        id: "honcho.health",
        category: "honcho",
        label: "GET /health",
        status: "err",
        timing_ms: Date.now() - start,
        message: `HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    return {
      id: "honcho.health",
      category: "honcho",
      label: "GET /health",
      status: "ok",
      timing_ms: Date.now() - start,
      message: text.slice(0, 80),
    };
  } catch (err) {
    return {
      id: "honcho.health",
      category: "honcho",
      label: "GET /health",
      status: "err",
      timing_ms: Date.now() - start,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeHonchoWorkspaces(baseUrl: string, token?: string): Promise<Probe> {
  const start = Date.now();
  try {
    const res = await safeFetch(
      `${baseUrl.replace(/\/+$/, "")}/v3/workspaces/list?page=1&size=1`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: "{}",
      },
    );
    const json = (await res.json().catch(() => ({}))) as { total?: number; detail?: unknown };
    if (!res.ok) {
      return {
        id: "honcho.workspaces",
        category: "honcho",
        label: "POST /v3/workspaces/list",
        status: "err",
        timing_ms: Date.now() - start,
        message: typeof json.detail === "string" ? json.detail : `HTTP ${res.status}`,
      };
    }
    return {
      id: "honcho.workspaces",
      category: "honcho",
      label: "POST /v3/workspaces/list",
      status: "ok",
      timing_ms: Date.now() - start,
      message: `${json.total ?? 0} workspaces`,
    };
  } catch (err) {
    return {
      id: "honcho.workspaces",
      category: "honcho",
      label: "POST /v3/workspaces/list",
      status: "err",
      timing_ms: Date.now() - start,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeOpenapi(baseUrl: string): Promise<{ probe: Probe; version: string | null }> {
  const start = Date.now();
  try {
    const res = await safeFetch(`${baseUrl.replace(/\/+$/, "")}/openapi.json`, {});
    if (!res.ok) {
      return {
        version: null,
        probe: {
          id: "honcho.openapi",
          category: "honcho",
          label: "GET /openapi.json",
          status: "warn",
          timing_ms: Date.now() - start,
          message: `HTTP ${res.status}`,
        },
      };
    }
    const j = (await res.json()) as { info?: { title?: string; version?: string } };
    const version = typeof j.info?.version === "string" ? j.info.version : null;
    return {
      version,
      probe: {
        id: "honcho.openapi",
        category: "honcho",
        label: "GET /openapi.json",
        status: "ok",
        timing_ms: Date.now() - start,
        message: `${j.info?.title ?? "OpenAPI"} ${version ?? ""}`,
      },
    };
  } catch (err) {
    return {
      version: null,
      probe: {
        id: "honcho.openapi",
        category: "honcho",
        label: "GET /openapi.json",
        status: "warn",
        timing_ms: Date.now() - start,
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/** Migration state: revision vs. server version, INVALID indexes, 3.4 queue indexes. */
async function probeSchema(serverVersion: Promise<string | null>): Promise<Probe[]> {
  const facts = await dbSchemaFacts();
  if (!facts.available) {
    return [{ id: "db.schema_revision", category: "database", label: "schema revision", status: "skip", message: facts.reason }];
  }
  return schemaProbes(facts, await serverVersion);
}

async function probeDb(serverVersion: Promise<string | null>): Promise<Probe[]> {
  const health = await dbHealth();
  if (!health.available) {
    return [
      {
        id: "db.connection",
        category: "database",
        label: "PostgreSQL connection",
        status: "skip",
        message: health.reason ?? "operator db not configured",
      },
    ];
  }
  const stats = await dbStats();
  const probes: Probe[] = [
    {
      id: "db.connection",
      category: "database",
      label: "PostgreSQL connection",
      status: "ok",
      timing_ms: health.timing,
      message: health.detail?.split(" on ")[0]?.slice(0, 80),
    },
  ];
  probes.push({
    id: "db.pgvector",
    category: "database",
    label: "pgvector extension",
    status: stats.vector_extension ? "ok" : "warn",
    message: stats.vector_extension
      ? `installed${stats.vector_count !== undefined ? ` · ${stats.vector_count} vector columns` : ""}`
      : "extension not installed",
  });
  probes.push(...(await probeSchema(serverVersion)));
  if (stats.available) {
    probes.push({
      id: "db.size",
      category: "database",
      label: "database size",
      status: "ok",
      message: stats.db_size_pretty,
    });
    probes.push({
      id: "db.uptime",
      category: "database",
      label: "PostgreSQL uptime",
      status: "ok",
      message: stats.uptime_s !== undefined ? formatDuration(stats.uptime_s) : undefined,
    });
  }
  return probes;
}

async function probeLogs(): Promise<Probe> {
  const r = await tailLogs(5);
  if (!r.available) {
    return {
      id: "logs.tail",
      category: "logs",
      label: "tail HONCHO_LOG_FILE",
      status: "skip",
      message: r.reason,
    };
  }
  return {
    id: "logs.tail",
    category: "logs",
    label: "tail HONCHO_LOG_FILE",
    status: "ok",
    message: `${r.entries?.length ?? 0} recent lines · ${r.source}`,
  };
}

function formatDuration(s: number): string {
  const days = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export async function diagnose(
  baseUrl: string,
  token?: string,
): Promise<DiagnosticsResult> {
  const openapi = probeOpenapi(baseUrl);
  const [honchoHealth, honchoWorkspaces, { probe: honchoOpenapi }, dbProbes, logsProbe] = await Promise.all([
    probeHonchoHealth(baseUrl, token),
    probeHonchoWorkspaces(baseUrl, token),
    openapi,
    probeDb(openapi.then((result) => result.version)),
    probeLogs(),
  ]);
  const runtime = runtimeInfo();
  const operatorProbe: Probe = {
    id: "operator.runtime",
    category: "operator",
    label: "dashboard runtime",
    status: "ok",
    message: `node ${runtime.node_version} · up ${formatDuration(runtime.dashboard_uptime_s)}`,
  };
  return {
    generated_at: new Date().toISOString(),
    honcho_base_url: baseUrl,
    probes: [honchoHealth, honchoWorkspaces, honchoOpenapi, ...dbProbes, logsProbe, operatorProbe],
  };
}
