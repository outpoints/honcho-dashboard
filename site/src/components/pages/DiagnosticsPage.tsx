"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Chip, RefreshButton, Tabs } from "@/components/atoms";
import { Select } from "@/components/Select";
import { Icon } from "@/components/icons";
import { HEALTH_CHECKS, LOG_ENTRIES, CONFIG_VALIDATIONS, TROUBLESHOOTING_ITEMS } from "@/lib/data";
import { cn } from "@/lib/utils";

type Tab = "health_checks" | "logs" | "config_validation" | "troubleshooting";

export function DiagnosticsPage() {
  const [tab, setTab] = useState<Tab>("health_checks");
  return (
    <div className="space-y-3">
      <PageHeader
        title="DIAGNOSTICS"
        subtitle="troubleshooting and health monitoring for self-hosted Honcho"
        actions={<RefreshButton label="RUN_CHECKS" />}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-yellow-500/5 border border-yellow-500/30 border-l-2 border-l-yellow-500">
        <div className="flex items-center gap-3">
          <Icon name="warning" className="text-yellow-400" size={20} />
          <div>
            <div className="text-sm uppercase tracking-wider text-yellow-400">2 WARNINGS - REVIEW RECOMMENDED</div>
            <div className="text-[10px] text-text-muted">10/12 checks passing</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Chip tone="accent" icon="check">10</Chip>
          <Chip tone="warn" icon="warning">2</Chip>
          <Chip tone="muted" icon="x-circle">0</Chip>
        </div>
      </div>

      <Tabs<Tab>
        items={[
          { key: "health_checks", label: "HEALTH_CHECKS", icon: "check" },
          { key: "logs", label: "LOGS", icon: "terminal" },
          { key: "config_validation", label: "CONFIG_VALIDATION", icon: "settings" },
          { key: "troubleshooting", label: "TROUBLESHOOTING", icon: "book" },
        ]}
        current={tab}
        onChange={setTab}
      />

      {tab === "health_checks" ? <HealthChecksTab /> : null}
      {tab === "logs" ? <LogsTab /> : null}
      {tab === "config_validation" ? <ConfigValidationTab /> : null}
      {tab === "troubleshooting" ? <TroubleshootingTab /> : null}

      <StatusBar />
    </div>
  );
}

function HealthChecksTab() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {HEALTH_CHECKS.map((c, i) => (
        <motion.div
          key={c.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.03, duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
          whileHover={{ borderColor: c.status === "warning" ? "rgba(245, 158, 11, 0.6)" : c.status === "error" ? "rgba(248, 113, 113, 0.6)" : "rgba(60, 130, 247, 0.5)" }}
          className={cn("p-3 bg-surface border transition-colors duration-150", c.status === "warning" ? "border-yellow-500/40" : c.status === "error" ? "border-red-500/40" : "border-border")}
        >
          <div className="flex items-start gap-2 mb-2">
            <Icon name={c.status === "warning" ? "warning" : c.status === "error" ? "x-circle" : "check"} className={c.status === "warning" ? "text-yellow-400" : c.status === "error" ? "text-red-400" : "text-accent"} size={14} />
            <Icon name={c.category === "database" ? "database" : c.category === "api" ? "server" : c.category === "deriver" ? "brain" : c.category === "llm" ? "sparkles" : c.category === "cache" ? "hard-drive" : "settings"} size={12} className="text-text-muted" />
            <span className="text-sm text-text-primary">{c.name}</span>
          </div>
          <p className="text-[11px] text-text-muted">{c.description}</p>
          {c.detail ? <p className="text-[10px] text-text-muted mt-1 font-mono break-all">{c.detail}</p> : null}
          <div className="flex items-center justify-between mt-3 text-[10px] text-text-muted">
            {c.timing ? <span className="flex items-center gap-1"><Icon name="clock" size={10} /> {c.timing}</span> : <span />}
            <span>{c.timestamp}</span>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function LogsTab() {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const [source, setSource] = useState("all");
  const filtered = LOG_ENTRIES.filter((l) => {
    if (level !== "all" && l.level !== level) return false;
    if (source !== "all" && l.source !== source) return false;
    if (query && !l.message.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });
  return (
    <Panel title="SYSTEM_LOGS">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex-1 min-w-[200px] flex items-center gap-2 bg-void border border-border px-3 py-2">
          <Icon name="search" className="text-text-muted" size={12} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="search logs..." className="bg-transparent text-xs flex-1 outline-none placeholder:text-text-muted" />
        </div>
        <button className="w-8 h-8 border border-border-light flex items-center justify-center text-text-muted"><Icon name="filter" size={12} /></button>
        <Select
          value={level}
          onChange={setLevel}
          options={[
            { value: "all", label: "all levels" },
            { value: "debug", label: "debug" },
            { value: "info", label: "info" },
            { value: "warn", label: "warn" },
            { value: "error", label: "error" },
          ]}
          className="min-w-[140px]"
        />
        <Select
          value={source}
          onChange={setSource}
          options={[
            { value: "all", label: "all sources" },
            { value: "api", label: "api" },
            { value: "deriver", label: "deriver" },
            { value: "database", label: "database" },
            { value: "cache", label: "cache" },
            { value: "system", label: "system" },
          ]}
          className="min-w-[140px]"
        />
        <span className="text-[10px] text-text-muted">{filtered.length} entries</span>
      </div>
      <div className="space-y-1">
        {filtered.map((l) => (
          <div key={l.id} className={cn("flex items-center gap-2 px-3 py-2 border-l-2 bg-void/40", l.level === "error" ? "border-red-500" : l.level === "warn" ? "border-yellow-500" : l.level === "debug" ? "border-text-muted" : "border-accent/60")}>
            <span className="text-[10px] text-text-muted tabular-nums w-20">{l.timestamp}</span>
            <Chip tone={l.level === "error" ? "danger" : l.level === "warn" ? "warn" : l.level === "debug" ? "muted" : "accent"}>{l.level}</Chip>
            <span className="text-[10px] text-text-muted">[{l.source}]</span>
            <span className="text-xs text-text-primary flex-1">{l.message}</span>
            <Icon name="chevron-right" size={10} className="text-text-muted" />
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ConfigValidationTab() {
  return (
    <Panel title="CONFIGURATION_VALIDATION">
      <div className="space-y-1">
        {CONFIG_VALIDATIONS.map((c) => (
          <div key={c.key} className={cn("flex items-center gap-3 px-3 py-3 border-l-2 bg-void/40", c.status === "warning" ? "border-yellow-500" : "border-accent")}>
            <Icon name={c.status === "warning" ? "warning" : "check"} className={c.status === "warning" ? "text-yellow-400" : "text-accent"} size={14} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-accent font-mono">{c.key}</span>
                {c.required ? <Chip tone="red">REQUIRED</Chip> : null}
                <Chip tone="muted">{c.category}</Chip>
              </div>
              <p className="text-[11px] text-text-muted mt-1">{c.description}</p>
            </div>
            <span className="text-[11px] text-text-muted font-mono break-all max-w-[40%] text-right">{c.value}</span>
          </div>
        ))}
        <div className="mt-3 pt-3 border-t border-border space-y-1 text-[11px] text-text-muted">
          <div>&gt; example .env configuration</div>
          <pre className="px-3 py-2 bg-void border border-border text-text-primary overflow-x-auto">{`# Database
DB_CONNECTION_URI=postgresql+psycopg://postgres:password@localhost:5432/honcho

# Authentication (disabled for local dev)
AUTH_USE_AUTH=false

# LLM Keys
LLM_GEMINI_API_KEY=AIzaSyXXXX
LLM_OPENAI_API_KEY=sk-XXXX

# Deriver
DERIVER_WORKERS=4
REPRESENTATION_BATCH_MAX_TOKENS=1000

# Embeddings
EMBED_MESSAGES=true`}</pre>
        </div>
      </div>
    </Panel>
  );
}

function TroubleshootingTab() {
  const [category, setCategory] = useState<string>("all");
  const [open, setOpen] = useState<string | null>(null);
  const categories = ["all", "startup", "runtime", "database", "llm", "docker", "cache"];
  const filtered = TROUBLESHOOTING_ITEMS.filter((i) => category === "all" || i.category === category);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-text-muted">category:</span>
        {categories.map((c) => (
          <button key={c} onClick={() => setCategory(c)} className={cn("px-2.5 py-1 border text-[10px] uppercase tracking-wider", category === c ? "border-accent text-accent bg-accent/10" : "border-border text-text-muted hover:border-border-light")}>{c}</button>
        ))}
      </div>
      <div className="space-y-2">
        {filtered.map((t) => {
          const isOpen = open === t.id;
          return (
            <div key={t.id} className={cn("bg-surface border", t.severity === "error" ? "border-red-500/30" : "border-yellow-500/30")}>
              <button onClick={() => setOpen(isOpen ? null : t.id)} className="w-full flex items-center gap-3 px-3 py-3 text-left">
                <Icon name={t.severity === "error" ? "alert-circle" : "warning"} className={t.severity === "error" ? "text-red-400" : "text-yellow-400"} size={14} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-text-primary">{t.title}</span>
                    <Chip tone="muted">{t.category}</Chip>
                  </div>
                  <p className="text-[11px] text-text-muted mt-1">{t.description}</p>
                </div>
                <Icon name="chevron-down" size={12} className={cn("text-text-muted transition-transform", isOpen && "rotate-180")} />
              </button>
              <AnimatePresence initial={false}>
              {isOpen && t.details ? (
                <motion.div
                  key="expanded"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
                  className="border-t border-border bg-void/30 overflow-hidden"
                >
                  <ul className="space-y-1 text-[11px] text-text-muted px-3 py-3">
                    {t.details.map((d, i) => (
                      <li key={i} className="flex items-start gap-2"><span className="text-accent">•</span> {d}</li>
                    ))}
                  </ul>
                </motion.div>
              ) : null}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
