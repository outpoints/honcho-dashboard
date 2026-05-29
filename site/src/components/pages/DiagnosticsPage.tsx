"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button } from "@/components/atoms";
import { Icon } from "@/components/icons";
import { useActiveHonchoOptions } from "@/lib/honcho/config";
import { useOperatorQuery } from "@/lib/operator/client";

interface Probe {
  id: string;
  category: "honcho" | "database" | "operator" | "logs";
  label: string;
  detail?: string;
  status: "ok" | "warn" | "err" | "skip";
  timing_ms?: number;
  message?: string;
}

interface DiagnosticsResp {
  generated_at: string;
  honcho_base_url?: string;
  probes: Probe[];
}

interface LogsResp {
  available: boolean;
  reason?: string;
  source?: string;
  entries?: { id: string; timestamp?: string; level: string; source?: string; message: string }[];
}

interface ConfigResp {
  available: boolean;
  entries: { key: string; value: string; redacted: boolean; set: boolean }[];
}

export function DiagnosticsPage() {
  const apiOpts = useActiveHonchoOptions();
  const [pollKey, setPollKey] = useState(0);
  const diag = useOperatorQuery<DiagnosticsResp>(
    `/api/operator/diagnostics?n=${pollKey}`,
    { withHonchoHeaders: true },
  );
  const logs = useOperatorQuery<LogsResp>("/api/operator/logs?limit=80", {
    refreshInterval: 15000,
  });
  const config = useOperatorQuery<ConfigResp>("/api/operator/config");

  const probes = diag.data?.probes ?? [];
  const byCategory = (cat: Probe["category"]) => probes.filter((p) => p.category === cat);

  const overall: "ok" | "warn" | "err" | "running" =
    diag.isLoading
      ? "running"
      : probes.some((p) => p.status === "err")
        ? "err"
        : probes.some((p) => p.status === "warn")
          ? "warn"
          : "ok";

  return (
    <div className="space-y-3">
      <PageHeader
        title="DIAGNOSTICS"
        subtitle="composite probes from operator + honcho"
        actions={
          <Button onClick={() => setPollKey((n) => n + 1)} disabled={!apiOpts || diag.isLoading}>
            {diag.isLoading ? "RUNNING…" : "RE_RUN"}
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="endpoint" value={apiOpts?.baseUrl ?? "—"} mono />
        <Card label="generated_at" value={diag.data?.generated_at?.replace("T", " ").slice(0, 19) ?? "—"} />
        <Card
          label="overall"
          value={overall}
          tone={overall === "ok" ? "accent" : overall === "err" ? "danger" : "muted"}
        />
        <Card
          label="probes"
          value={`${probes.filter((p) => p.status === "ok").length}/${probes.length}`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Panel title="HONCHO_PROBES">
          <ProbeList probes={byCategory("honcho")} loading={diag.isLoading} />
        </Panel>
        <Panel title="DATABASE_PROBES">
          <ProbeList probes={byCategory("database")} loading={diag.isLoading} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Panel title="OPERATOR">
          <ProbeList
            probes={[...byCategory("operator"), ...byCategory("logs")]}
            loading={diag.isLoading}
          />
        </Panel>
        <Panel title="CONFIG">
          {config.isLoading ? (
            <div className="text-xs text-text-muted py-4">Loading…</div>
          ) : (
            <div className="space-y-1 text-[11px]">
              {(config.data?.entries ?? []).map((e) => (
                <div key={e.key} className="flex justify-between gap-2 px-2 py-1.5 bg-void/40 border border-border">
                  <span className="text-accent font-mono truncate">{e.key}</span>
                  <span
                    className={
                      "font-mono truncate text-right " +
                      (e.set ? (e.redacted ? "text-yellow-300" : "text-text-primary") : "text-text-muted")
                    }
                    title={e.value}
                  >
                    {e.value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="LOGS">
        {!logs.data ? (
          <div className="text-xs text-text-muted py-4">Loading…</div>
        ) : !logs.data.available ? (
          <div className="text-xs text-text-muted py-4">
            {logs.data.reason ?? "Set HONCHO_LOG_FILE on the dashboard to enable tail."}
          </div>
        ) : (logs.data.entries ?? []).length === 0 ? (
          <div className="text-xs text-text-muted py-4">No log entries.</div>
        ) : (
          <div className="space-y-0.5 max-h-[280px] overflow-y-auto">
            {(logs.data.entries ?? []).slice(-80).map((e) => (
              <div key={e.id} className="text-[10px] font-mono flex gap-2 px-2 py-1 bg-void/30 border border-border/50">
                {e.timestamp ? <span className="text-text-muted shrink-0">{e.timestamp}</span> : null}
                <span className={"shrink-0 uppercase " + levelClass(e.level)}>{e.level}</span>
                {e.source ? <span className="text-text-muted shrink-0">[{e.source}]</span> : null}
                <span className="text-text-primary truncate">{e.message}</span>
              </div>
            ))}
            <div className="text-[10px] text-text-muted pt-1">
              source: <span className="font-mono">{logs.data.source}</span>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="API_NOTE">
        <div className="text-[11px] text-text-muted leading-relaxed">
          Honcho v3 only exposes <span className="text-accent">/health</span> as a single boolean.
          The granular probes above are computed by the dashboard&apos;s operator modules
          (read-only DB connection via <span className="text-accent">HONCHO_DATABASE_URL</span>,
          log tail via <span className="text-accent">HONCHO_LOG_FILE</span>). Honcho itself is not
          modified.
        </div>
      </Panel>

      <StatusBar />
    </div>
  );
}

function ProbeList({ probes, loading }: { probes: Probe[]; loading?: boolean }) {
  if (probes.length === 0) {
    return (
      <div className="space-y-2">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2, delay: i * 0.05 }}
              className="flex items-center gap-3 p-3 bg-void/40 border border-border"
            >
              <motion.span
                className="w-3.5 h-3.5 bg-yellow-500/40"
                animate={{ opacity: [1, 0.4, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
              />
              <div className="flex-1 space-y-1.5">
                <div className="h-2.5 bg-border/60 animate-pulse w-1/3" />
                <div className="h-2 bg-border/40 animate-pulse w-2/3" />
              </div>
              <div className="h-2 w-8 bg-border/40 animate-pulse" />
            </motion.div>
          ))
        ) : (
          <div className="text-xs text-text-muted py-4">No probes.</div>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <AnimatePresence initial={false}>
        {probes.map((p, i) => (
          <motion.div
            key={p.id}
            layout
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04, duration: 0.2 }}
            className="flex items-start gap-3 p-3 bg-void/40 border border-border transition-colors hover:border-accent/40"
          >
            <motion.div
              animate={
                p.status === "ok"
                  ? { scale: [1, 1.15, 1] }
                  : p.status === "warn"
                    ? { opacity: [1, 0.5, 1] }
                    : undefined
              }
              transition={{ duration: 0.4 }}
              className="shrink-0"
            >
              <Icon
                name={
                  p.status === "ok"
                    ? "check"
                    : p.status === "err"
                      ? "x-circle"
                      : p.status === "warn"
                        ? "warning"
                        : "alert-circle"
                }
                size={14}
                className={
                  p.status === "ok"
                    ? "text-accent"
                    : p.status === "err"
                      ? "text-red-400"
                      : p.status === "warn"
                        ? "text-yellow-400"
                        : "text-text-muted"
                }
              />
            </motion.div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-text-primary font-mono truncate">{p.label}</div>
              {p.message ? (
                <div
                  className={
                    "text-[10px] mt-0.5 truncate " +
                    (p.status === "err" ? "text-red-400" : "text-text-muted")
                  }
                >
                  {p.message}
                </div>
              ) : null}
            </div>
            {p.timing_ms !== undefined ? (
              <div className="text-[10px] text-text-muted shrink-0 tabular-nums">
                {p.timing_ms}ms
              </div>
            ) : null}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function levelClass(level: string): string {
  const l = level.toLowerCase();
  if (l === "error" || l === "fatal" || l === "exception") return "text-red-400";
  if (l === "warn" || l === "warning") return "text-yellow-400";
  if (l === "debug" || l === "trace") return "text-text-muted";
  if (l === "info" || l === "notice") return "text-accent";
  return "text-text-muted";
}

function Card({
  label,
  value,
  tone = "muted",
  mono,
}: {
  label: string;
  value: string;
  tone?: "accent" | "danger" | "muted";
  mono?: boolean;
}) {
  const cls = tone === "accent" ? "text-accent" : tone === "danger" ? "text-red-400" : "text-text-primary";
  return (
    <div className="bg-surface border border-border p-3">
      <div className="text-[10px] text-text-muted uppercase tracking-wider">&gt; {label}</div>
      <div className={`mt-1 text-sm truncate ${mono ? "font-mono" : ""} ${cls}`}>{value}</div>
    </div>
  );
}
