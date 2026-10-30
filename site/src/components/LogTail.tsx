"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Panel } from "@/components/Panel";
import { Button, Checkbox, Chip, TextInput, ToggleButton } from "@/components/atoms";
import { Icon } from "@/components/icons";
import { countLevels, mergeLogEntries, type LogEntry, type LogLevel } from "@/lib/operator/logLines";
import { highlightTerms, useTextHighlight } from "@/lib/textHighlight";
import { cn } from "@/lib/utils";

interface LogsResp {
  available: boolean;
  reason?: string;
  source?: string;
  entries?: LogEntry[];
  size?: number;
  truncated?: boolean;
  read_at?: string;
}

const POLL_MS = 2000;
const KEEP = 1000;
const RENDER = 400;
const LEVELS: { key: LogLevel; label: string; tone: string }[] = [
  { key: "error", label: "ERROR", tone: "text-red-400" },
  { key: "warn", label: "WARN", tone: "text-yellow-400" },
  { key: "info", label: "INFO", tone: "text-accent" },
  { key: "debug", label: "DEBUG", tone: "text-text-muted" },
  { key: "unknown", label: "OTHER", tone: "text-text-muted" },
];
const TONE = Object.fromEntries(LEVELS.map((l) => [l.key, l.tone])) as Record<LogLevel, string>;

function shortTime(timestamp?: string): string {
  if (!timestamp) return "";
  const match = timestamp.match(/[T ](\d{2}:\d{2}:\d{2})(?:[.,](\d{1,3}))?/);
  return match ? `${match[1]}${match[2] ? `.${match[2].padEnd(3, "0")}` : ""}` : timestamp;
}

/**
 * Live tail of HONCHO_LOG_FILE. Polls the bounded tail endpoint while LIVE and
 * the tab is visible, merges by byte offset, and sticks to the newest line
 * until the operator scrolls up. A changed `refreshKey` reads it again at once.
 */
export function LogTail({ refreshKey = 0 }: { refreshKey?: number }) {
  const reducedMotion = useReducedMotion();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const entriesRef = useRef<LogEntry[]>([]);
  const [meta, setMeta] = useState<LogsResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [hidden, setHidden] = useState<Set<LogLevel>>(() => new Set());
  const [query, setQuery] = useState("");
  const [wrap, setWrap] = useState(false);
  const [pinned, setPinned] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const known = useRef<Set<string> | null>(null);
  const fresh = useRef<Set<string>>(new Set());
  const lastSize = useRef<number | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/operator/logs?limit=500", { cache: "no-store", signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as LogsResp;
      setMeta(body);
      setError(null);
      if (!body.available) return;
      const incoming = body.entries ?? [];
      const rotated = lastSize.current !== null && body.size !== undefined && body.size < lastSize.current;
      lastSize.current = body.size ?? null;
      const next = mergeLogEntries(rotated ? [] : entriesRef.current, incoming, KEEP);
      // First load renders still; later arrivals fade in.
      if (known.current === null || rotated) {
        known.current = new Set(next.map((e) => e.id));
        fresh.current = new Set();
      } else {
        const added = next.filter((e) => !known.current!.has(e.id));
        fresh.current = new Set(added.map((e) => e.id));
        for (const e of added) known.current.add(e.id);
        if (added.length) setUnseen((n) => n + added.length);
      }
      if (next !== entriesRef.current) {
        entriesRef.current = next;
        setEntries(next);
      }
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
    // refreshKey: the page's RE_RUN reads the tail again right away.
  }, [load, refreshKey]);

  useEffect(() => {
    if (!live) return;
    let controller: AbortController | null = null;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      controller?.abort();
      controller = new AbortController();
      void load(controller.signal);
    }, POLL_MS);
    return () => { window.clearInterval(id); controller?.abort(); };
  }, [live, load]);

  const terms = useMemo(() => highlightTerms(query), [query]);
  const visible = useMemo(() => {
    const filtered = entries.filter((e) => {
      if (hidden.has(e.level)) return false;
      if (!terms.length) return true;
      const hay = `${e.source ?? ""} ${e.message}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
    return filtered.slice(-RENDER);
  }, [entries, hidden, terms]);
  const counts = useMemo(() => countLevels(entries), [entries]);
  const newestId = visible.at(-1)?.id ?? null;

  // Stick to the bottom while pinned; otherwise count what arrived below.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (pinned) {
      el.scrollTop = el.scrollHeight;
      setUnseen(0);
    }
  }, [newestId, pinned, wrap]);

  useTextHighlight(list, query, `${newestId}:${visible.length}:${wrap}`);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setPinned(atBottom);
    if (atBottom) setUnseen(0);
  };
  const jump = () => {
    setPinned(true);
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
  };
  const toggleLevel = (level: LogLevel) =>
    setHidden((cur) => {
      const next = new Set(cur);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  const clearFilters = () => { setHidden(new Set()); setQuery(""); };

  const status = !meta ? "processing" : meta.available && live ? "processing" : meta.available ? "active" : "idle";

  return (
    <Panel
      title="LOG_TAIL"
      status={status}
      actions={meta?.available ? (
        <div className="flex items-center gap-1.5">
          {live ? <Chip tone="accent" icon="activity">LIVE · {POLL_MS / 1000}s</Chip> : <Chip tone="muted" icon="pause">PAUSED</Chip>}
        </div>
      ) : undefined}
    >
      {error && !meta ? (
        <p role="alert" className="text-xs text-red-400">
          Log request failed: {error}. <button type="button" className="underline" onClick={() => void load()}>RETRY</button>
        </p>
      ) : !meta ? (
        <div className="space-y-1.5 py-1" role="status" aria-label="Loading logs">
          {[0, 1, 2, 3].map((n) => <div key={n} className="h-4 bg-border/50 motion-safe:animate-pulse" style={{ width: `${92 - n * 11}%` }} />)}
        </div>
      ) : !meta.available ? (
        <div className="space-y-2 py-2 text-[11px] text-text-primary max-w-[75ch]">
          <p>{meta.reason ?? "HONCHO_LOG_FILE not set"}</p>
          <p className="text-text-muted">
            Point <span className="text-accent font-mono">HONCHO_LOG_FILE</span> at a file the dashboard host can read. For a Docker
            install, keep one appended with{" "}
            <code className="font-mono text-text-primary">docker compose logs -f --timestamps --no-color api deriver &gt;&gt; honcho.log</code>{" "}
            and mount it read-only.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={live ? "secondary" : "primary"} icon={live ? "pause" : "play"} onClick={() => setLive((v) => !v)}>
              {live ? "PAUSE" : "RESUME"}
            </Button>
            {!live ? <Button size="sm" variant="ghost" icon="refresh" onClick={() => void load()}>READ_NOW</Button> : null}
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Levels">
              {LEVELS.map((l) => (
                <ToggleButton key={l.key} active={!hidden.has(l.key)} onClick={() => toggleLevel(l.key)} className="h-6 px-2">
                  {l.label} <span className="tabular-nums opacity-80">{counts[l.key]}</span>
                </ToggleButton>
              ))}
            </div>
            <div className="relative flex-1 min-w-[180px]">
              <Icon name="filter" size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <TextInput
                className="pl-7 h-7 py-1"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="filter lines…"
                aria-label="Filter log lines"
              />
            </div>
            <Checkbox checked={wrap} onChange={setWrap} label={<span className="text-[10px]">WRAP</span>} />
          </div>

          <div className="relative">
            <div
              ref={scroller}
              onScroll={onScroll}
              className="h-[340px] overflow-y-auto border border-border bg-void font-mono text-[10.5px] leading-[1.55]"
              aria-live="off"
            >
              <div ref={list} className="py-1">
                {visible.length === 0 ? (
                  <div className="flex flex-wrap items-center gap-3 px-3 py-6 text-[11px] text-text-muted">
                    {entries.length === 0 ? "No log lines yet. New lines appear here as Honcho writes them." : "No lines match these filters in the loaded window."}
                    {entries.length ? <Button size="sm" variant="secondary" onClick={clearFilters}>CLEAR_FILTERS</Button> : null}
                  </div>
                ) : visible.map((e) => {
                  const isFresh = fresh.current.has(e.id) && !reducedMotion;
                  return (
                    <motion.div
                      key={e.id}
                      initial={isFresh ? { opacity: 0, x: -4 } : false}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
                      className={cn(
                        "flex gap-2 px-2 hover:bg-border/30",
                        e.level === "error" && "bg-red-500/5",
                        wrap ? "items-start" : "items-center",
                      )}
                    >
                      <span className="text-text-muted shrink-0 tabular-nums" title={e.timestamp}>{shortTime(e.timestamp)}</span>
                      <span className={cn("shrink-0 w-11 uppercase", TONE[e.level])}>{e.level === "unknown" ? "·" : e.level}</span>
                      {e.source ? <span className="text-text-muted shrink-0 max-w-[18ch] truncate" title={e.source}>{e.source}</span> : null}
                      <span className={cn("text-text-primary min-w-0", wrap ? "whitespace-pre-wrap break-all" : "truncate")} title={wrap ? undefined : e.message}>
                        {e.message}
                      </span>
                    </motion.div>
                  );
                })}
              </div>
            </div>
            {!pinned && unseen > 0 ? (
              <motion.div
                initial={reducedMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute bottom-2 left-1/2 -translate-x-1/2"
              >
                <Button size="sm" variant="solid" icon="chevron-down" onClick={jump}>
                  {unseen} NEW · JUMP_TO_LATEST
                </Button>
              </motion.div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-text-muted">
            <span className="tabular-nums">
              {visible.length.toLocaleString()} shown · {entries.length.toLocaleString()} loaded
              {meta.truncated ? " · last 512 KB of the file" : ""}
              {error ? <span className="text-red-400"> · last read failed: {error}</span> : null}
            </span>
            <span className="font-mono truncate max-w-full" title={meta.source}>{meta.source}</span>
          </div>
        </div>
      )}
    </Panel>
  );
}
