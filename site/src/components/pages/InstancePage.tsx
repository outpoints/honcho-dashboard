"use client";

import { motion } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, RefreshButton } from "@/components/atoms";
import { Icon } from "@/components/icons";
import { honcho } from "@/lib/honcho/client";
import { useActiveHonchoOptions } from "@/lib/honcho/config";
import { getSdk } from "@/lib/honcho/sdk";
import { toApiQueueStatus } from "@/lib/honcho/adapters";
import { formatApiError, useHonchoQuery } from "@/lib/honcho/useQuery";
import { useOperatorQuery } from "@/lib/operator/client";
import type { ApiQueueStatus, ApiWorkspace } from "@/lib/honcho/types";

interface OperatorRuntime {
  available: boolean;
  reason?: string;
  dashboard_uptime_s: number;
  node_version: string;
  honcho_uptime_s?: number | null;
}

interface OperatorDbStats {
  available: boolean;
  reason?: string;
  uptime_s?: number;
  db_size_bytes?: number;
  db_size_pretty?: string;
  connections?: number;
  vector_extension?: boolean;
  vector_count?: number;
  tables?: { name: string; rows: number; size_bytes: number }[];
}

export function InstancePage() {
  const apiOpts = useActiveHonchoOptions();
  const health = useHonchoQuery("health", (o) => honcho.health(o), { refreshInterval: 15000 });
  const workspaces = useHonchoQuery("workspaces/list?size=100", (o) =>
    honcho.workspaces.list(o, { size: 100 }),
  );

  const workspaceIds = (workspaces.data?.items ?? []).map((w) => w.id);
  const queueBatchKey =
    workspaceIds.length > 0 ? `instance/queue-batch:${workspaceIds.join(",")}` : null;
  const queueBatch = useHonchoQuery<Record<string, ApiQueueStatus | string>>(
    queueBatchKey,
    async (o) => {
      const entries = await Promise.all(
        workspaceIds.map((id) =>
          getSdk(o, id)
            .queueStatus()
            .then((q) => [id, toApiQueueStatus(q)] as [string, ApiQueueStatus])
            .catch((err) => [id, formatApiError(err)] as [string, string]),
        ),
      );
      return Object.fromEntries(entries);
    },
    { refreshInterval: 30000 },
  );
  const queues = queueBatch.data ?? {};
  const queuesLoading = queueBatch.isLoading;

  const runtime = useOperatorQuery<OperatorRuntime>("/api/operator/runtime", {
    refreshInterval: 30000,
  });
  const dbStats = useOperatorQuery<OperatorDbStats>("/api/operator/db", {
    refreshInterval: 30000,
  });

  const healthy = !health.error && health.data?.status === "ok";

  return (
    <div className="space-y-3">
      <PageHeader
        title="INSTANCE"
        subtitle="live state of this Honcho server"
        actions={<RefreshButton label="REFRESH" onClick={() => { health.refetch(); workspaces.refetch(); queueBatch.refetch(); runtime.refetch(); dbStats.refetch(); }} />}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Panel title="HEALTH" status={healthy ? "active" : "processing"}>
          <div className="flex items-center gap-2 text-xs">
            <Icon
              name={healthy ? "check" : "x-circle"}
              size={14}
              className={healthy ? "text-accent" : "text-red-400"}
            />
            <span className={healthy ? "text-accent" : "text-red-400"}>
              {health.isLoading ? "checking…" : healthy ? "OK" : "UNREACHABLE"}
            </span>
          </div>
          <div className="mt-2 text-[10px] text-text-muted">
            GET <span className="text-accent">{apiOpts?.baseUrl}/health</span>
          </div>
          {health.error ? (
            <div className="mt-2 text-[11px] text-red-400">{formatApiError(health.error)}</div>
          ) : null}
        </Panel>

        <Panel title="ENDPOINT">
          <div className="space-y-1 text-xs">
            <Row k="base_url" v={<span className="font-mono">{apiOpts?.baseUrl ?? "—"}</span>} />
            <Row k="auth" v={apiOpts?.token ? "Bearer token" : "none"} />
          </div>
        </Panel>

        <Panel title="WORKSPACES">
          <div className="space-y-1 text-xs">
            <Row k="total" v={workspaces.isLoading ? "…" : String(workspaces.data?.total ?? 0)} />
            <Row k="oldest" v={oldest(workspaces.data?.items)} />
            <Row k="newest" v={newest(workspaces.data?.items)} />
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Panel title="RUNTIME">
          {runtime.isLoading ? (
            <div className="text-xs text-text-muted py-4">Loading…</div>
          ) : runtime.data ? (
            <div className="space-y-1 text-xs">
              <Row
                k="dashboard_uptime"
                v={formatUptime(runtime.data.dashboard_uptime_s)}
              />
              <Row k="node" v={runtime.data.node_version} />
              <Row
                k="honcho_uptime"
                v={
                  runtime.data.honcho_uptime_s != null
                    ? formatUptime(runtime.data.honcho_uptime_s)
                    : "(set HONCHO_RUNTIME_START_TS)"
                }
              />
            </div>
          ) : (
            <div className="text-xs text-text-muted py-4">Unavailable.</div>
          )}
        </Panel>

        <Panel title="DATABASE">
          {dbStats.isLoading ? (
            <div className="text-xs text-text-muted py-4">Loading…</div>
          ) : dbStats.data?.available ? (
            <div className="space-y-1 text-xs">
              <Row k="size" v={dbStats.data.db_size_pretty ?? "—"} />
              <Row k="connections" v={String(dbStats.data.connections ?? 0)} />
              <Row
                k="pgvector"
                v={
                  dbStats.data.vector_extension ? (
                    <span className="text-accent">installed</span>
                  ) : (
                    <span className="text-yellow-400">missing</span>
                  )
                }
              />
              <Row
                k="postgres_uptime"
                v={
                  dbStats.data.uptime_s !== undefined ? formatUptime(dbStats.data.uptime_s) : "—"
                }
              />
            </div>
          ) : (
            <div className="text-xs text-text-muted py-4">
              {dbStats.data?.reason ?? "Operator DB not configured."}
            </div>
          )}
        </Panel>

        <Panel title="VECTORS">
          {dbStats.data?.available ? (
            <div className="space-y-1 text-xs">
              <Row
                k="vector_columns"
                v={
                  dbStats.data.vector_count !== undefined
                    ? String(dbStats.data.vector_count)
                    : "—"
                }
              />
              <Row
                k="extension"
                v={dbStats.data.vector_extension ? "vector" : "not installed"}
              />
            </div>
          ) : (
            <div className="text-xs text-text-muted py-4">Operator DB not configured.</div>
          )}
        </Panel>
      </div>

      {dbStats.data?.available && dbStats.data.tables ? (
        <Panel title="TOP_TABLES">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-text-muted uppercase tracking-wider border-b border-border">
                  <th className="text-left py-2 pr-2">table</th>
                  <th className="text-right py-2 px-2">rows</th>
                  <th className="text-right py-2 pl-2">size</th>
                </tr>
              </thead>
              <tbody>
                {dbStats.data.tables.slice(0, 10).map((t) => (
                  <tr key={t.name} className="border-b border-border last:border-0">
                    <td className="py-2 pr-2 font-mono text-accent truncate">{t.name}</td>
                    <td className="text-right py-2 px-2 tabular-nums">{t.rows.toLocaleString()}</td>
                    <td className="text-right py-2 pl-2 tabular-nums">{prettyBytes(t.size_bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      <Panel title="QUEUE_STATUS_BY_WORKSPACE">
        {workspaces.error ? (
          <div className="text-xs text-red-400">{formatApiError(workspaces.error)}</div>
        ) : workspaces.isLoading ? (
          <div className="text-xs text-text-muted py-4">Loading workspaces…</div>
        ) : (workspaces.data?.items ?? []).length === 0 ? (
          <div className="text-xs text-text-muted py-4">No workspaces.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-text-muted uppercase tracking-wider border-b border-border">
                  <th className="text-left py-2 pr-2">workspace</th>
                  <th className="text-right py-2 px-2">pending</th>
                  <th className="text-right py-2 px-2">in_progress</th>
                  <th className="text-right py-2 px-2">completed</th>
                  <th className="text-right py-2 pl-2">total</th>
                </tr>
              </thead>
              <tbody>
                {(workspaces.data?.items ?? []).map((w, idx) => {
                  const q = queues[w.id];
                  const isErr = typeof q === "string";
                  return (
                    <motion.tr
                      key={w.id}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.03, duration: 0.2 }}
                      whileHover={{ backgroundColor: "rgba(60, 130, 247, 0.05)" }}
                      className="border-b border-border last:border-0"
                    >
                      <td className="py-2 pr-2 font-mono text-accent truncate">{w.id}</td>
                      {queuesLoading && !q ? (
                        <td colSpan={4} className="text-right text-text-muted py-2 pl-2">…</td>
                      ) : isErr ? (
                        <td colSpan={4} className="text-right text-red-400 py-2 pl-2 truncate">{q}</td>
                      ) : (
                        <>
                          <td className="text-right py-2 px-2 text-accent tabular-nums">{(q as ApiQueueStatus).pending_work_units}</td>
                          <td className="text-right py-2 px-2 text-yellow-400 tabular-nums">{(q as ApiQueueStatus).in_progress_work_units}</td>
                          <td className="text-right py-2 px-2 text-text-muted tabular-nums">{(q as ApiQueueStatus).completed_work_units}</td>
                          <td className="text-right py-2 pl-2 text-text-primary tabular-nums">{(q as ApiQueueStatus).total_work_units}</td>
                        </>
                      )}
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="OPERATOR_NOTE">
        <div className="text-[11px] text-text-muted leading-relaxed">
          Uptime, database size, and vector counts above come from the operator DB module —
          a read-only Postgres connection from the dashboard to the same database Honcho uses.
          Set <span className="text-accent">HONCHO_DATABASE_URL</span> on the dashboard to enable.
          Honcho itself is not modified.
        </div>
      </Panel>

      <StatusBar />
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 py-1.5 border-b border-border last:border-0">
      <span className="text-text-muted">{k}</span>
      <span className="truncate text-right">{v}</span>
    </div>
  );
}

function oldest(items?: ApiWorkspace[]): string {
  if (!items || items.length === 0) return "—";
  const o = items.reduce((a, b) => (a.created_at < b.created_at ? a : b));
  return new Date(o.created_at).toLocaleDateString();
}

function newest(items?: ApiWorkspace[]): string {
  if (!items || items.length === 0) return "—";
  const o = items.reduce((a, b) => (a.created_at > b.created_at ? a : b));
  return new Date(o.created_at).toLocaleDateString();
}

function formatUptime(s: number): string {
  const days = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
