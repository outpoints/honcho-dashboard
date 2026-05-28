"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { StatTile, ToggleButton, Chip, Button, PillTabs } from "@/components/atoms";
import { Icon } from "@/components/icons";
import { SESSIONS, genHeatmapCells } from "@/lib/data";
import { ThroughputChart, SERIES_COLORS, type Timeframe, genSeries } from "@/components/ThroughputChart";
import { useNav } from "@/lib/nav";
import { cn } from "@/lib/utils";

const TIMEFRAMES: Timeframe[] = ["1H", "6H", "24H", "7D"];

export function OverviewPage() {
  const { navigate } = useNav();
  const [timeframe, setTimeframe] = useState<Timeframe>("24H");
  const [visible, setVisible] = useState({ reads: true, writes: true, deletes: false });
  const [updated, setUpdated] = useState<string>("");

  useEffect(() => {
    const fmt = () => {
      const d = new Date();
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      setUpdated(`${hh}:${mm}:${ss}`);
    };
    fmt();
    const id = setInterval(fmt, 5000);
    return () => clearInterval(id);
  }, []);

  const cells = useMemo(() => genHeatmapCells(), []);
  const stats = useMemo(() => {
    const series = genSeries(timeframe);
    return {
      total: series.reduce((s, x) => s + x.reads + x.writes, 0),
      reads: series.reduce((s, x) => s + x.reads, 0),
      writes: series.reduce((s, x) => s + x.writes, 0),
      avgLatency: (series.reduce((s, x) => s + x.latency, 0) / series.length).toFixed(1),
      peak: Math.max(...series.map((x) => x.reads + x.writes)),
    };
  }, [timeframe]);

  return (
    <div className="space-y-4">
      <PageHeader title="INSTANCE_OVERVIEW" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile delay={0} label="total_peers" value="1,304" hint={<><Icon name="trending-up" size={10} /> across all workspaces</>} />
        <StatTile delay={0.05} label="active_sessions" value="3" hint={<><Icon name="trending-up" size={10} /> 5 total</>} />
        <StatTile delay={0.1} label="total_messages" value="252.6k" hint={<><Icon name="trending-up" size={10} /> +2.4k today</>} />
        <StatTile delay={0.15} label="conclusions" value="90.5k" hint={<><Icon name="trending-up" size={10} /> 4 reasoning pending</>} />
      </div>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 lg:col-span-8 space-y-3">
          <Panel title="MESSAGE_THROUGHPUT" delay={0.2}>
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-text-muted text-[10px] uppercase tracking-wider">&gt; real-time memory operations</span>
                    <span className="flex items-center gap-1 px-1.5 py-0.5 bg-accent/10 border border-accent/30">
                      <span className="w-1.5 h-1.5 bg-accent animate-pulse" />
                      <span className="text-[9px] text-accent uppercase">live</span>
                    </span>
                  </div>
                  <div className="flex items-baseline gap-3">
                    <span className="font-pixel text-3xl text-text-primary tracking-wider">{stats.total.toLocaleString()}</span>
                    <span className="flex items-center gap-1 text-xs text-accent">
                      <Icon name="trending-up" size={12} /> +13.6%
                    </span>
                    <span className="text-text-muted text-[10px]">vs prev period</span>
                  </div>
                </div>
                <TimeRangePills value={timeframe} onChange={setTimeframe} />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <ThroughputTile icon="database" label="reads" value={stats.reads.toLocaleString()} className="text-accent" />
                <ThroughputTile icon="zap" label="writes" value={stats.writes.toLocaleString()} className="text-blue-400" />
                <ThroughputTile icon="clock" label="avg_latency" value={`${stats.avgLatency}ms`} className="text-text-primary" />
                <ThroughputTile icon="activity" label="peak_ops" value={stats.peak.toLocaleString()} className="text-purple-400" />
              </div>

              <ThroughputChart timeframe={timeframe} visible={visible} />

              <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-border">
                <div className="flex items-center gap-3">
                  <LegendButton color={SERIES_COLORS.reads.line} active={visible.reads} onClick={() => setVisible((s) => ({ ...s, reads: !s.reads }))}>READS</LegendButton>
                  <LegendButton color={SERIES_COLORS.writes.line} active={visible.writes} onClick={() => setVisible((s) => ({ ...s, writes: !s.writes }))}>WRITES</LegendButton>
                  <LegendButton color={SERIES_COLORS.deletes.line} active={visible.deletes} onClick={() => setVisible((s) => ({ ...s, deletes: !s.deletes }))}>DELETES</LegendButton>
                </div>
                <span className="text-[10px] text-text-muted">last_updated: <span className="text-text-primary">{updated || "--:--:--"}</span></span>
              </div>
            </div>
          </Panel>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <SmallStat value="3" label="WORKSPACES" delay={0.25} onClick={() => navigate("workspaces")} />
            <SmallStat value="1,304" label="PEERS" delay={0.28} onClick={() => navigate("peers")} />
            <SmallStat value="4" label="REASONING QUEUE" delay={0.31} onClick={() => navigate("reasoning")} />
          </div>

          <Panel title="REASONING_ACTIVITY" status="idle" delay={0.3}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="text-text-muted text-[10px]">&gt; 52 week reasoning passes heatmap</div>
              <div className="flex items-center gap-3 text-[9px] text-text-muted">
                <span>total: <span className="text-text-primary">16,948</span></span>
                <span>avg: <span className="text-text-primary">46.6</span></span>
                <span>peak: <span className="text-text-primary">99</span></span>
              </div>
            </div>
            <Heatmap cells={cells} />
            <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
              <div className="flex items-center gap-1 text-[9px] text-text-muted">
                less
                {[0.15, 0.35, 0.55, 0.75, 1].map((a, i) => (
                  <span key={i} className="w-2.5 h-2.5" style={{ backgroundColor: `rgba(60, 130, 247, ${a})` }} />
                ))}
                more
              </div>
              <span className="text-[9px] text-text-muted">52 weeks · 7 days</span>
            </div>
          </Panel>
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-3">
          <Panel title="RECENT_SESSIONS" delay={0.25}>
            <div className="space-y-2">
              {SESSIONS.slice(0, 5).map((s, i) => (
                <motion.button
                  key={s.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.03, duration: 0.2 }}
                  whileHover={{ borderColor: "rgba(60, 130, 247, 0.5)", x: 2 }}
                  onClick={() => navigate("sessions")}
                  className="w-full flex items-center justify-between px-2 py-1.5 bg-void/50 border border-border text-left transition-colors duration-150"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-accent truncate">{s.id}</div>
                    <div className="text-[10px] text-text-muted truncate">{s.peers.join(", ")}</div>
                  </div>
                  <div className="text-right ml-2 shrink-0">
                    <div className="text-[10px]">{s.messageCount} msgs</div>
                    <div className={cn("text-[10px]", s.status === "active" ? "text-accent" : s.status === "idle" ? "text-yellow-400" : "text-text-muted")}>
                      {s.status}
                    </div>
                  </div>
                </motion.button>
              ))}
              <Button variant="ghost" className="w-full" onClick={() => navigate("sessions")}>VIEW_ALL_SESSIONS</Button>
            </div>
          </Panel>

          <Panel title="INSTANCE_STATUS" delay={0.3}>
            <div className="space-y-2 text-xs">
              {[
                ["uptime", "14d 7h 23m", "primary"],
                ["db_size", "4.2 GB", "primary"],
                ["vector_count", "2,412,847", "primary"],
                ["queue", "23 pending", "accent"],
              ].map(([k, v, tone]) => (
                <div key={k} className="flex justify-between py-1.5 border-b border-border last:border-0">
                  <span className="text-text-muted">{k}</span>
                  <span className={tone === "accent" ? "text-accent" : "text-text-primary"}>{v}</span>
                </div>
              ))}
              <Button variant="ghost" className="w-full mt-1" onClick={() => navigate("instance")}>VIEW_INSTANCE_DETAILS</Button>
            </div>
          </Panel>
        </div>
      </div>

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
          <span className={cn("relative z-10 transition-colors duration-150", value === tf ? "text-void" : "text-text-muted hover:text-text-primary")}>
            {tf}
          </span>
        </motion.button>
      ))}
    </div>
  );
}

function ThroughputTile({ icon, label, value, className }: { icon: "database" | "zap" | "clock" | "activity"; label: string; value: string; className?: string }) {
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

function LegendButton({ color, active, onClick, children }: { color: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
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

function SmallStat({ value, label, onClick, delay = 0 }: { value: string; label: string; onClick?: () => void; delay?: number }) {
  return (
    <motion.button
      onClick={onClick}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
      whileHover={{ borderColor: "rgba(60, 130, 247, 0.5)" }}
      whileTap={{ scale: 0.98 }}
      className="bg-surface border border-border p-4 text-left transition-colors duration-150 group"
    >
      <div className="font-pixel text-3xl text-text-primary tracking-wider">{value}</div>
      <div className="text-[10px] text-text-muted uppercase tracking-wider mt-1">{label}</div>
      <div className="text-[10px] text-text-muted mt-2 flex items-center gap-1">
        click to manage <Icon name="chevron-right" size={10} className="group-hover:translate-x-0.5 transition-transform" />
      </div>
    </motion.button>
  );
}

function Heatmap({ cells }: { cells: number[] }) {
  const weeks = 52;
  const days = 7;
  return (
    <div className="flex gap-0.5 overflow-x-auto pb-1">
      {Array.from({ length: weeks }).map((_, w) => (
        <div key={w} className="flex flex-col gap-0.5">
          {Array.from({ length: days }).map((_, d) => {
            const idx = w * days + d;
            const v = cells[idx] ?? 0;
            const alpha = v < 0.05 ? 0 : 0.15 + v * 0.85;
            const bg = alpha === 0 ? "#0d1129" : `rgba(60, 130, 247, ${alpha.toFixed(2)})`;
            return (
              <motion.span
                key={d}
                className="w-2.5 h-2.5"
                style={{ backgroundColor: bg }}
                whileHover={{ scale: 1.3, zIndex: 5 }}
                transition={{ duration: 0.1 }}
                title={`${Math.round(v * 100)}%`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
