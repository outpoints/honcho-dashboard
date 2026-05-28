"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Chip, StatTile } from "@/components/atoms";
import { Select } from "@/components/Select";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { REASONING_QUEUE, REASONING_TYPES, CONCLUSIONS_STATS, WORKSPACES } from "@/lib/data";
import type { ReasoningTask } from "@/types/honcho";
import { cn } from "@/lib/utils";

const TYPE_TONES: Record<string, "blue" | "purple" | "yellow" | "orange" | "cyan" | "pink"> = {
  deductive: "blue",
  explicit: "purple",
  summary: "cyan",
  peer_card: "pink",
  inductive: "yellow",
  abductive: "orange",
  consolidation: "yellow",
};

export function ReasoningPage() {
  const { push } = useToast();
  const [queue, setQueue] = useState<ReasoningTask[]>(REASONING_QUEUE);
  const [paused, setPaused] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [workspaceFilter, setWorkspaceFilter] = useState("all");

  const counts = useMemo(() => ({
    queued: queue.filter((t) => t.status === "queued").length,
    processing: queue.filter((t) => t.status === "processing").length,
    completed: queue.filter((t) => t.status === "completed").length,
    failed: queue.filter((t) => t.status === "failed").length,
    tokens: queue.reduce((s, t) => s + (t.tokens ?? 0), 0),
  }), [queue]);

  const visible = useMemo(() => queue.filter((t) => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (typeFilter !== "all" && t.type !== typeFilter) return false;
    return true;
  }), [queue, statusFilter, typeFilter]);
  void workspaceFilter;

  const retryTask = (id: string) => {
    setQueue((cur) =>
      cur.map((t) =>
        t.id === id ? { ...t, status: "queued", error: undefined } : t,
      ),
    );
    push({ type: "success", message: `Reasoning task ${id} retried` });
  };

  const dismissTask = (id: string) => {
    setQueue((cur) => cur.filter((t) => t.id !== id));
    push({ type: "info", message: `Task ${id} dismissed` });
  };

  const processAll = () => {
    if (paused) {
      push({ type: "info", message: "Queue is paused" });
      return;
    }
    const queued = queue.filter((t) => t.status === "queued");
    if (queued.length === 0) {
      push({ type: "info", message: "Queue is empty" });
      return;
    }
    setQueue((cur) => cur.map((t) => (t.status === "queued" ? { ...t, status: "processing" } : t)));
    push({ type: "success", message: `Processing ${queued.length} tasks` });
    window.setTimeout(() => {
      setQueue((cur) =>
        cur.map((t) => (t.status === "processing" ? { ...t, status: "completed" } : t)),
      );
      push({ type: "success", message: `${queued.length} tasks completed` });
    }, 1500);
  };

  return (
    <div className="space-y-3">
      <PageHeader
        title="REASONING"
        subtitle="background inference tasks that build peer representations"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              icon={paused ? "play" : "pause"}
              onClick={() => {
                setPaused((p) => !p);
                push({ type: "info", message: paused ? "Queue resumed" : "Queue paused" });
              }}
            >
              {paused ? "RESUME_QUEUE" : "PAUSE_QUEUE"}
            </Button>
            <Button variant="primary" icon="play" onClick={processAll}>
              PROCESS_ALL
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatTile label="queued" value={counts.queued} hint="awaiting" hintTone="muted" />
        <StatTile label="processing" value={counts.processing} hint="in-flight" hintTone="accent" className="!border-accent/40" />
        <StatTile label="completed" value={counts.completed} hint="this hour" hintTone="muted" />
        <StatTile
          label="failed"
          value={<span className={counts.failed ? "text-red-400" : "text-text-primary"}>{counts.failed}</span>}
          hint="needs review"
          hintTone="danger"
          className={counts.failed ? "!border-red-500/40" : ""}
        />
        <StatTile label="tokens_pending" value={counts.tokens.toLocaleString()} hint="estimated" hintTone="muted" />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <Filter label="status" value={statusFilter} onChange={setStatusFilter} options={["all", "queued", "processing", "completed", "failed"]} />
        <Filter label="type" value={typeFilter} onChange={setTypeFilter} options={["all", ...REASONING_TYPES.map((t) => t.label)]} />
        <Filter label="workspace" value={workspaceFilter} onChange={setWorkspaceFilter} options={["all", ...WORKSPACES.map((w) => w.name)]} />
      </div>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 lg:col-span-8">
          <Panel title="REASONING_QUEUE">
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {visible.map((t, i) => (
                  <motion.div
                    key={t.id}
                    layout
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 100, transition: { duration: 0.2 } }}
                    transition={{ delay: i * 0.05, duration: 0.2 }}
                    whileHover={{ borderColor: t.status === "failed" ? "rgba(248, 113, 113, 0.6)" : "rgba(60, 130, 247, 0.5)" }}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 border bg-void/40 transition-colors duration-150",
                      t.status === "failed" ? "border-red-500/40 bg-red-500/5" : "border-border",
                    )}
                  >
                    <span className="shrink-0">
                      {t.status === "processing" ? <Icon name="loader" className="text-accent animate-spin" size={14} /> :
                        t.status === "failed" ? <Icon name="x-circle" className="text-red-400" size={14} /> :
                        t.status === "completed" ? <Icon name="check" className="text-accent" size={14} /> :
                        <Icon name="clock" className="text-text-muted" size={14} />}
                    </span>
                    <Chip tone={TYPE_TONES[t.type] || "muted"}>{t.type}</Chip>
                    <span className="text-xs text-text-primary">{t.peer}</span>
                    <span className="text-[10px] text-text-muted">{t.messageCount} msgs</span>
                    {t.error ? <span className="text-[10px] text-red-400">{t.error}</span> : null}
                    <div className="ml-auto flex items-center gap-3 text-[10px] text-text-muted">
                      {t.tokens ? <span className="text-text-primary tabular-nums">{t.tokens.toLocaleString()} tokens</span> : null}
                      <span>{t.timestamp}</span>
                      {t.status === "failed" ? (
                        <motion.button
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => retryTask(t.id)}
                          className="text-accent hover:text-text-primary"
                          aria-label="Retry"
                        >
                          <Icon name="refresh" size={12} />
                        </motion.button>
                      ) : null}
                      {t.status === "queued" || t.status === "failed" ? (
                        <motion.button
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => dismissTask(t.id)}
                          className="text-text-muted hover:text-red-400"
                          aria-label="Dismiss"
                        >
                          <Icon name="x" size={12} />
                        </motion.button>
                      ) : null}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {visible.length === 0 ? (
                <div className="text-center py-8 text-text-muted text-xs">
                  No reasoning tasks match filters.
                </div>
              ) : null}
            </div>
          </Panel>
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-3">
          <Panel title="REASONING_TYPES">
            <div className="space-y-2">
              {REASONING_TYPES.map((t) => (
                <div key={t.code} className="flex items-start gap-2 text-[11px]">
                  <Chip tone={t.color as "purple" | "blue" | "yellow" | "orange" | "cyan" | "pink"}>{t.code}</Chip>
                  <p className="text-text-muted leading-snug">{t.description}</p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="CONCLUSIONS_STATS">
            <div className="space-y-1.5 text-xs">
              <Row k="total_conclusions" v={CONCLUSIONS_STATS.total} />
              <Row k="explicit" v={CONCLUSIONS_STATS.explicit} />
              <Row k="deductive" v={CONCLUSIONS_STATS.deductive} />
              <Row k="inductive" v={CONCLUSIONS_STATS.inductive} />
              <Row k="abductive" v={CONCLUSIONS_STATS.abductive} />
            </div>
          </Panel>

          <Panel title="BATCHING_CONFIG">
            <div className="space-y-1.5 text-xs">
              <Row k="batch_threshold" v="~1,000 tokens" />
              <Row k="batch_window" v="30s" />
              <Row k="max_concurrency" v="4" />
              <Row k="retry_count" v="3" />
            </div>
          </Panel>
        </div>
      </div>

      <StatusBar />
    </div>
  );
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="flex items-center gap-2">
      <Icon name="filter" size={12} className="text-text-muted" />
      <span className="text-text-muted">{label}:</span>
      <Select
        value={value}
        onChange={onChange}
        options={options.map((o) => ({ value: o, label: o }))}
        className="min-w-[120px]"
      />
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-text-muted">{k}</span>
      <span className="text-accent tabular-nums">{v}</span>
    </div>
  );
}
