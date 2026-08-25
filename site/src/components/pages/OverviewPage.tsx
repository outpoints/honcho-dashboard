"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { StatTile, Button } from "@/components/atoms";
import { Icon } from "@/components/icons";
import { useNav } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { honcho } from "@/lib/honcho/client";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { getSdk } from "@/lib/honcho/sdk";
import { toApiQueueStatus, toApiSession } from "@/lib/honcho/adapters";
import { formatApiError, useHonchoQuery } from "@/lib/honcho/useQuery";
import { useOperatorQuery } from "@/lib/operator/client";
import { buildHeatmapDays, HEATMAP_WEEKS } from "@/lib/heatmap";
import type { ApiQueueStatus, ApiSession } from "@/lib/honcho/types";
import {
  ThroughputChart,
  SERIES_COLORS,
  type Timeframe,
  type ThroughputPoint,
} from "@/components/ThroughputChart";

const TIMEFRAMES: Timeframe[] = ["1H", "6H", "24H", "7D"];

interface ThroughputResp {
  available: boolean;
  reason?: string;
  buckets?: { ts: string; reads: number; writes: number }[];
}

interface HeatmapResp {
  available: boolean;
  reason?: string;
  cells?: { day: string; n: number }[];
}

interface SessionStatsResp {
  available: boolean;
  sessions?: Record<
    string,
    { session_id: string; workspace_id: string; message_count: number; last_message_at: string | null; peers: string[] }
  >;
}

const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

function deriveSessionStatus(active: boolean, lastMessageAt: string | null): "active" | "idle" | "archived" {
  if (!active) return "archived";
  const t = lastMessageAt ? Date.parse(lastMessageAt) : NaN;
  if (!Number.isNaN(t) && Date.now() - t < ACTIVE_WINDOW_MS) return "active";
  return "idle";
}

interface DbStatsResp {
  available: boolean;
  reason?: string;
  db_size_pretty?: string;
  uptime_s?: number;
  vector_count?: number;
}

export function OverviewPage() {
  const { navigate } = useNav();
  const { workspaceId } = useActiveWorkspace();
  const apiOpts = useActiveHonchoOptions();
  const [timeframe, setTimeframe] = useState<Timeframe>("24H");
  const [visible, setVisible] = useState({ reads: true, writes: true, deletes: false });
  const [updated, setUpdated] = useState<string>("");

  useEffect(() => {
    const fmt = () => {
      const d = new Date();
      setUpdated(
        `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`,
      );
    };
    fmt();
    const id = setInterval(fmt, 5000);
    return () => clearInterval(id);
  }, []);

  const wsList = useHonchoQuery("workspaces/list?size=100", (o) =>
    honcho.workspaces.list(o, { size: 100 }),
  );
  const queue = useHonchoQuery<ApiQueueStatus>(
    workspaceId ? `sdk/workspaces/${workspaceId}/queue/status` : null,
    async (o) => toApiQueueStatus(await getSdk(o, workspaceId!).queueStatus()),
    { refreshInterval: 10000 },
  );
  const sessions = useHonchoQuery<{ items: ApiSession[]; total: number }>(
    workspaceId ? `sdk/workspaces/${workspaceId}/sessions/list?recent` : null,
    async (o) => {
      const page = await getSdk(o, workspaceId!).sessions({ size: 5 });
      return { items: page.items.map((s) => toApiSession(s)), total: page.total };
    },
  );
  const peersAgg = useHonchoQuery(
    workspaceId ? `sdk/workspaces/${workspaceId}/peers/list?count` : null,
    (o) => getSdk(o, workspaceId!).peers({ size: 1 }).then((p) => ({ total: p.total })),
  );
  const sessionsAgg = useHonchoQuery(
    workspaceId ? `sdk/workspaces/${workspaceId}/sessions/list?count` : null,
    (o) => getSdk(o, workspaceId!).sessions({ size: 1 }).then((p) => ({ total: p.total })),
  );
  const conclusionsAgg = useHonchoQuery(
    workspaceId ? `raw/workspaces/${workspaceId}/conclusions/list?count` : null,
    (o) => honcho.conclusions.list(o, workspaceId!, { size: 1 }),
  );

  const throughput = useOperatorQuery<ThroughputResp>(
    `/api/operator/db?view=throughput&timeframe=${timeframe}`,
    { refreshInterval: 30000 },
  );
  const heatmap = useOperatorQuery<HeatmapResp>("/api/operator/db?view=heatmap", {
    refreshInterval: 60000,
  });
  const sessionStats = useOperatorQuery<SessionStatsResp>(
    workspaceId ? `/api/operator/db?view=sessions&workspace_id=${encodeURIComponent(workspaceId)}` : null,
  );
  const dbStats = useOperatorQuery<DbStatsResp>("/api/operator/db", { refreshInterval: 30000 });

  const aggLoading = !workspaceId
    ? false
    : peersAgg.isLoading || sessionsAgg.isLoading || conclusionsAgg.isLoading;
  const aggError =
    peersAgg.error ?? sessionsAgg.error ?? conclusionsAgg.error ?? undefined;

  const throughputPoints: ThroughputPoint[] | undefined = useMemo(() => {
    if (!throughput.data?.available || !throughput.data.buckets) return undefined;
    const buckets = throughput.data.buckets;
    return buckets.map((b) => ({
      timestamp: new Date(b.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      reads: b.reads,
      writes: b.writes,
      deletes: 0,
      latency: 0,
    }));
  }, [throughput.data]);

  const totalOps = throughputPoints?.reduce((s, p) => s + p.reads + p.writes, 0) ?? 0;
  const reads = throughputPoints?.reduce((s, p) => s + p.reads, 0) ?? 0;
  const writes = throughputPoints?.reduce((s, p) => s + p.writes, 0) ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="INSTANCE_OVERVIEW"
        subtitle={
          workspaceId
            ? `aggregates for workspace ${workspaceId}`
            : "select a workspace in the sidebar"
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          delay={0}
          label="peers"
          value={aggLoading ? "…" : peersAgg.data?.total?.toLocaleString() ?? "—"}
          hint={<><Icon name="users" size={10} /> in {workspaceId ?? "—"}</>}
        />
        <StatTile
          delay={0.05}
          label="sessions"
          value={aggLoading ? "…" : sessionsAgg.data?.total?.toLocaleString() ?? "—"}
          hint={<><Icon name="git-branch" size={10} /> in workspace</>}
        />
        <StatTile
          delay={0.1}
          label="workspaces"
          value={wsList.isLoading ? "…" : wsList.data?.total?.toLocaleString() ?? "—"}
          hint={<><Icon name="layers" size={10} /> on this instance</>}
        />
        <StatTile
          delay={0.15}
          label="conclusions"
          value={aggLoading ? "…" : conclusionsAgg.data?.total?.toLocaleString() ?? "—"}
          hint={<><Icon name="file-search" size={10} /> in workspace</>}
        />
      </div>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 lg:col-span-8 space-y-3">
          <Panel title="MESSAGE_THROUGHPUT" delay={0.2}>
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-text-muted text-[10px] uppercase tracking-wider">
                      &gt; messages + conclusions over time (operator db)
                    </span>
                    {throughput.data?.available ? (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 bg-accent/10 border border-accent/30">
                        <span className="w-1.5 h-1.5 bg-accent animate-pulse" />
                        <span className="text-[9px] text-accent uppercase">live</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 bg-yellow-500/10 border border-yellow-500/30">
                        <span className="text-[9px] text-yellow-300 uppercase">operator db off</span>
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-3">
                    <span className="font-pixel text-3xl text-text-primary tracking-wider">
                      {totalOps.toLocaleString()}
                    </span>
                    <span className="text-text-muted text-[10px]">total events in window</span>
                  </div>
                </div>
                <TimeRangePills value={timeframe} onChange={setTimeframe} />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <ThroughputTile icon="zap" label="writes" value={writes.toLocaleString()} className="text-blue-400" />
                <ThroughputTile icon="database" label="reads" value={reads.toLocaleString()} className="text-accent" />
                <ThroughputTile
                  icon="clock"
                  label="db_uptime"
                  value={dbStats.data?.uptime_s ? formatUptime(dbStats.data.uptime_s) : "—"}
                  className="text-text-primary"
                />
                <ThroughputTile
                  icon="activity"
                  label="db_size"
                  value={dbStats.data?.db_size_pretty ?? "—"}
                  className="text-purple-400"
                />
              </div>

              {throughputPoints ? (
                <ThroughputChart timeframe={timeframe} visible={visible} data={throughputPoints} />
              ) : (
                <div className="border border-border bg-void/40 p-8 text-center text-xs text-text-muted">
                  {throughput.isLoading
                    ? "loading throughput…"
                    : throughput.data?.reason ?? "Set HONCHO_DATABASE_URL on the dashboard to enable the throughput chart."}
                </div>
              )}

              <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-border">
                <div className="flex items-center gap-3">
                  <LegendButton color={SERIES_COLORS.reads.line} active={visible.reads} onClick={() => setVisible((s) => ({ ...s, reads: !s.reads }))}>READS</LegendButton>
                  <LegendButton color={SERIES_COLORS.writes.line} active={visible.writes} onClick={() => setVisible((s) => ({ ...s, writes: !s.writes }))}>WRITES</LegendButton>
                </div>
                <span className="text-[10px] text-text-muted">
                  last_updated: <span className="text-text-primary">{updated || "--:--:--"}</span>
                </span>
              </div>
            </div>
          </Panel>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <SmallStat
              value={wsList.data?.total?.toLocaleString() ?? "—"}
              label="WORKSPACES"
              delay={0.25}
              onClick={() => navigate("workspaces")}
            />
            <SmallStat
              value={peersAgg.data?.total?.toLocaleString() ?? "—"}
              label="PEERS"
              delay={0.28}
              onClick={() => navigate("peers")}
            />
            <SmallStat
              value={(queue.data?.pending_work_units ?? 0).toLocaleString()}
              label="REASONING QUEUE"
              delay={0.31}
              onClick={() => navigate("reasoning")}
            />
          </div>

          <Panel title="REASONING_ACTIVITY" status={queue.data?.in_progress_work_units ? "processing" : "idle"} delay={0.3}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="text-text-muted text-[10px]">
                &gt; 52 week conclusion creation heatmap (operator db)
              </div>
              {heatmap.data?.available && heatmap.data.cells ? (
                <div className="flex items-center gap-3 text-[9px] text-text-muted">
                  <span>
                    total:{" "}
                    <span className="text-text-primary">
                      {heatmap.data.cells.reduce((s, c) => s + c.n, 0).toLocaleString()}
                    </span>
                  </span>
                  <span>
                    avg:{" "}
                    <span className="text-text-primary">
                      {(heatmap.data.cells.reduce((s, c) => s + c.n, 0) / (52 * 7)).toFixed(1)}
                    </span>
                  </span>
                  <span>
                    peak:{" "}
                    <span className="text-text-primary">
                      {heatmap.data.cells.reduce((m, c) => Math.max(m, c.n), 0)}
                    </span>
                  </span>
                </div>
              ) : null}
            </div>
            {heatmap.data?.available && heatmap.data.cells ? (
              <>
                <Heatmap cells={heatmap.data.cells} />
                <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
                  <div className="flex items-center gap-1 text-[9px] text-text-muted">
                    less
                    {[0.15, 0.35, 0.55, 0.75, 1].map((a, i) => (
                      <span
                        key={i}
                        className="w-2.5 h-2.5"
                        style={{
                          backgroundColor: `color-mix(in oklab, var(--color-accent) ${Math.round(a * 100)}%, transparent)`,
                        }}
                      />
                    ))}
                    more
                  </div>
                  <span className="text-[9px] text-text-muted">52 weeks · 7 days</span>
                </div>
              </>
            ) : (
              <div className="border border-border bg-void/40 p-6 text-center text-xs text-text-muted">
                {heatmap.isLoading
                  ? "loading heatmap…"
                  : heatmap.data?.reason ?? "Set HONCHO_DATABASE_URL on the dashboard to enable the heatmap."}
              </div>
            )}
          </Panel>
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-3">
          <Panel title="RECENT_SESSIONS" delay={0.25}>
            {!workspaceId ? (
              <div className="text-xs text-text-muted py-4">No workspace selected.</div>
            ) : sessions.isLoading ? (
              <div className="text-xs text-text-muted py-4">Loading…</div>
            ) : sessions.error ? (
              <div className="text-xs text-red-400">{formatApiError(sessions.error)}</div>
            ) : (sessions.data?.items ?? []).length === 0 ? (
              <div className="text-xs text-text-muted py-4">No sessions.</div>
            ) : (
              <div className="space-y-2">
                {(sessions.data?.items ?? []).map((s, i) => {
                  const stat = sessionStats.data?.available
                    ? sessionStats.data.sessions?.[`${s.workspace_id}::${s.id}`]
                    : undefined;
                  const status = deriveSessionStatus(s.is_active, stat?.last_message_at ?? null);
                  return (
                    <motion.button
                      key={s.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3 + i * 0.03, duration: 0.2 }}
                      whileHover={{ x: 2 }}
                      onClick={() => navigate("sessions")}
                      className="w-full flex items-center justify-between px-2 py-1.5 bg-void/50 border border-border text-left transition-colors duration-150 hover:border-accent/50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-accent truncate font-mono">{s.id}</div>
                        <div className="text-[10px] text-text-muted truncate">
                          {stat?.peers?.length
                            ? stat.peers.join(", ")
                            : new Date(s.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="text-right ml-2 shrink-0">
                        <div className="text-[10px] text-text-muted">{stat ? `${stat.message_count} msgs` : "—"}</div>
                        <div
                          className={cn(
                            "text-[10px]",
                            status === "active"
                              ? "text-accent"
                              : status === "idle"
                                ? "text-yellow-400"
                                : "text-text-muted",
                          )}
                        >
                          {status}
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
                <Button variant="ghost" className="w-full" onClick={() => navigate("sessions")}>
                  VIEW_ALL_SESSIONS
                </Button>
              </div>
            )}
          </Panel>

          <Panel title="INSTANCE_STATUS" delay={0.3}>
            <div className="space-y-2 text-xs">
              <Row
                k="db_uptime"
                v={dbStats.data?.uptime_s ? formatUptime(dbStats.data.uptime_s) : "—"}
              />
              <Row k="db_size" v={dbStats.data?.db_size_pretty ?? "—"} />
              <Row
                k="vector_columns"
                v={dbStats.data?.vector_count !== undefined ? String(dbStats.data.vector_count) : "—"}
              />
              <Row
                k="queue"
                v={
                  queue.data ? (
                    <span className="text-accent">{queue.data.pending_work_units} pending</span>
                  ) : (
                    "—"
                  )
                }
              />
              <Button variant="ghost" className="w-full mt-1" onClick={() => navigate("instance")}>
                VIEW_INSTANCE_DETAILS
              </Button>
            </div>
          </Panel>
        </div>
      </div>

      {aggError ? (
        <Panel title="ERROR" status="processing">
          <div className="text-xs text-red-400">{formatApiError(aggError)}</div>
        </Panel>
      ) : null}

      <StatusBar />
    </div>
  );
}

function TimeRangePills({ value, onChange }: { value: Timeframe; onChange: (v: Timeframe) => void }) {
  return (
    <div className="flex items-center gap-1 bg-void border border-border p-0.5">
      {TIMEFRAMES.map((tf) => (
        <motion.button
          key={tf}
          onClick={() => onChange(tf)}
          className="relative px-3 py-1.5 text-[10px] uppercase tracking-wider"
          whileTap={{ scale: 0.96 }}
        >
          {value === tf ? (
            <motion.div
              layoutId="timeRangeActive"
              className="absolute inset-0 bg-accent"
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
            />
          ) : null}
          <span
            className={cn(
              "relative z-10 transition-colors duration-150",
              value === tf ? "text-void" : "text-text-muted hover:text-text-primary",
            )}
          >
            {tf}
          </span>
        </motion.button>
      ))}
    </div>
  );
}

function ThroughputTile({
  icon,
  label,
  value,
  className,
}: {
  icon: "database" | "zap" | "clock" | "activity";
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="bg-void/50 border border-border px-3 py-2 flex items-center gap-2">
      <Icon name={icon} className="text-text-muted shrink-0" size={12} />
      <div className="flex flex-col min-w-0">
        <span className="text-[9px] text-text-muted uppercase">{label}</span>
        <span className={cn("text-sm truncate", className)}>{value}</span>
      </div>
    </div>
  );
}

function LegendButton({
  color,
  active,
  onClick,
  children,
}: {
  color: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 border transition-colors duration-150 text-[10px] uppercase tracking-wider",
        active ? "border-border-light text-text-primary" : "border-border text-text-muted",
      )}
    >
      <span className="w-3 h-0.5" style={{ backgroundColor: color }} />
      {children}
    </motion.button>
  );
}

function SmallStat({
  value,
  label,
  onClick,
  delay = 0,
}: {
  value: string;
  label: string;
  onClick?: () => void;
  delay?: number;
}) {
  return (
    <motion.button
      onClick={onClick}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
      whileTap={{ scale: 0.98 }}
      className="bg-surface border border-border p-4 text-left transition-colors duration-150 group hover:border-accent/50"
    >
      <div className="font-pixel text-3xl text-text-primary tracking-wider">{value}</div>
      <div className="text-[10px] text-text-muted uppercase tracking-wider mt-1">{label}</div>
      <div className="text-[10px] text-text-muted mt-2 flex items-center gap-1">
        click to manage <Icon name="chevron-right" size={10} className="group-hover:translate-x-0.5 transition-transform" />
      </div>
    </motion.button>
  );
}

function Heatmap({ cells }: { cells: { day: string; n: number }[] }) {
  if (cells.length === 0)
    return (
      <div className="text-xs text-text-muted py-4">No data in last 52 weeks.</div>
    );
  const peak = cells.reduce((m, c) => Math.max(m, c.n), 1);
  const days = buildHeatmapDays(cells);

  return (
    <div className="flex gap-0.5 overflow-x-auto pb-1">
      {Array.from({ length: HEATMAP_WEEKS }).map((_, w) => (
        <div key={w} className="flex flex-col gap-0.5">
          {Array.from({ length: 7 }).map((_, d) => {
            const idx = w * 7 + d;
            const cell = days[idx];
            const v = cell ? cell.n / peak : 0;
            const alpha = v < 0.01 ? 0 : 0.15 + v * 0.85;
            const bg =
              alpha === 0
                ? "var(--heat-empty)"
                : `color-mix(in oklab, var(--color-accent) ${Math.round(alpha * 100)}%, transparent)`;
            return (
              <motion.span
                key={d}
                className="w-2.5 h-2.5"
                style={{ backgroundColor: bg }}
                whileHover={{ scale: 1.3, zIndex: 5 }}
                transition={{ duration: 0.1 }}
                title={cell ? `${cell.day}: ${cell.n}` : ""}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-border last:border-0">
      <span className="text-text-muted">{k}</span>
      <span className="text-text-primary">{v}</span>
    </div>
  );
}

function formatUptime(s: number): string {
  const days = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
