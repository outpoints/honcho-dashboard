"use client";

import { useEffect, useId, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Chip, RefreshButton, ToggleButton } from "@/components/atoms";
import { Icon } from "@/components/icons";
import { Markdown } from "@/components/Markdown";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import { useToast } from "@/components/toast";
import { ConclusionInspector } from "@/components/ConclusionInspector";
import { HonchoFeatureNotice } from "@/components/HonchoFeatureNotice";
import { ScheduleDreamModal } from "@/components/ScheduleDreamModal";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { useHonchoCapabilities } from "@/lib/honcho/useCapabilities";
import { useListTotal } from "@/lib/honcho/useListTotal";
import { useHonchoQuery, type QueryState } from "@/lib/honcho/useQuery";
import { getSdk } from "@/lib/honcho/sdk";
import { toApiPeer } from "@/lib/honcho/adapters";
import type { ApiPeer } from "@/lib/honcho/types";
import {
  changeCounts,
  dreamRefreshMs,
  dreamRunHash,
  dreamsHash,
  formatDuration,
  formatElapsed,
  getDreamRun,
  groupRunsByStart,
  listDreamRuns,
  missingCreated,
  peerCardChanges,
  readDreamsHash,
  readLinkedRun,
  runChanges,
  runDurationMs,
  runElapsedMs,
  runFlags,
  runIsActive,
  runLooksStuck,
  stuckAfterMs,
  summarizeRuns,
  triggerLabel,
  unusualSpecialist,
  type DreamChange,
  type DreamChangeCounts,
  type DreamConclusionRef,
  type DreamCreatedConclusion,
  type DreamFilters,
  type DreamPage,
  type DreamPeerCardChange,
  type DreamRun,
  type DreamRunDetail,
  type DreamRunGroup,
  type DreamShow,
  type DreamSummary,
} from "@/lib/honcho/dreams";
import { levelMeta } from "@/lib/conclusionLevels";
import { useHash } from "@/lib/nav";
import { shortAge } from "@/lib/peerMemory";
import { FAILED_TASKS_HREF } from "@/lib/syncStatus";
import { useNow } from "@/lib/useNow";
import { useWriteActions } from "@/lib/writeActions";
import { cn } from "@/lib/utils";

const EASE = [0.25, 0.46, 0.45, 0.94] as const;
/** An open run lists this many new conclusions before folding the rest. */
const ADDED_SHOWN = 5;
const LEGEND_KEY = "honcho-dashboard:dreams-legend";

type ChangeKind = DreamChange["kind"];

/**
 * Diff markers: the glyph is the signal, colour repeats it, words go to screen
 * readers. A rewrite is routine housekeeping, so it stays neutral. Only a loss
 * gets the danger colour, and yellow is left to warnings.
 */
const MARK: Record<ChangeKind, { glyph: string; tone: string; word: string }> = {
  added: { glyph: "+", tone: "text-cyan-400", word: "Added" },
  rewritten: { glyph: "~", tone: "text-text-primary", word: "Rewritten" },
  forgotten: { glyph: "−", tone: "text-red-400", word: "Forgotten" },
};

const GROUP_COPY: Record<ChangeKind, { label: string; hint: string }> = {
  forgotten: { label: "FORGOTTEN", hint: "removed, with nothing to replace it" },
  rewritten: { label: "REWRITTEN", hint: "swapped for a sharper near-duplicate" },
  added: { label: "ADDED", hint: "new conclusions" },
};

/** Hash navigation lives outside components so render stays pure. */
function setFilters(next: DreamFilters) {
  window.location.hash = dreamsHash(next);
}

function readStored(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or a full store: the preference just is not remembered.
  }
}

/** When this browser last listed a workspace's dreams, so newer runs read as new. */
function readSeen(key: string): number | null {
  const value = Number(readStored(key));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function pairText(run: Pick<DreamRun, "observer_id" | "observed_id">): string {
  return run.observer_id === run.observed_id ? `${run.observed_id}'s own view` : `${run.observer_id}'s view of ${run.observed_id}`;
}

export function DreamsPage() {
  const opts = useActiveHonchoOptions();
  const { workspaceId } = useActiveWorkspace();
  return <DreamsSession key={`${opts?.baseUrl}/${opts?.token}/${workspaceId}`} />;
}

interface RunTiming {
  now: number;
  /** A running run older than this reads as stuck (see stuckAfterMs). */
  stuckAfter: number;
}

interface OpenRun {
  runId: string;
  /** A conclusion to mark in the opened run, when followed from another run. */
  focusId?: string;
}

type OnOpenRun = (runId: string, focusId?: string) => void;

function DreamsSession() {
  const opts = useActiveHonchoOptions();
  const { workspaceId } = useActiveWorkspace();
  const { dreamHistory, provenance } = useHonchoCapabilities();
  const { enabled: canWrite } = useWriteActions();
  const hash = useHash();
  const filters = readDreamsHash(hash);
  const linkedRun = readLinkedRun(hash);
  const show = filters.show ?? null;
  const filterKey = `${filters.observed ?? ""}/${filters.observer ?? ""}`;
  // The page belongs to the filters it was chosen under.
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const setPage = (next: number) => setPageState({ key: filterKey, page: next });
  const [schedule, setSchedule] = useState({ open: false, key: 0 });
  // Open rows outlive refreshes, filter changes and paging.
  const [openRuns, setOpenRuns] = useState<ReadonlySet<string>>(() => new Set());
  const [modalRun, setModalRun] = useState<OpenRun | null>(null);
  const [inspected, setInspected] = useState<string | null>(null);
  const now = useNow(30_000);
  const seenKey = `honcho-dashboard:dreams-seen:${opts?.baseUrl ?? ""}::${workspaceId ?? ""}`;
  // Read once per visit: runs newer than the previous visit stay marked new until the next one.
  const [seenBefore] = useState<number | null>(() => readSeen(seenKey));

  const enabled = dreamHistory === "available" && !!workspaceId;
  const list = useHonchoQuery<DreamPage>(
    enabled ? `dreams/${workspaceId}/list/${filterKey}/p${page}` : null,
    (o) => listDreamRuns(getSdk(o, workspaceId!), filters, page, dreamHistory),
    { refreshInterval: (data) => dreamRefreshMs(data?.items ?? [], now, stuckAfterMs(data?.items ?? [])) },
  );
  const peers = useHonchoQuery<{ items: ApiPeer[] }>(
    enabled ? `sdk/workspaces/${workspaceId}/peers/list?concl` : null,
    async (o) => ({ items: (await getSdk(o, workspaceId!).peers({ size: 100 })).items.map(toApiPeer) }),
  );

  const items = list.data?.items ?? [];
  // Only a run's detail says whether each removal was replaced or forgotten.
  // Finished runs on this page that removed something are read together, once
  // per set; a live run reads its own detail while it changes.
  const splitIds = items.filter((run) => run.removed_count > 0 && !run.pruned_at && !runIsActive(run)).map((run) => run.id);
  const split = useHonchoQuery<Record<string, DreamRunDetail | null>>(
    enabled && splitIds.length ? `dreams/${workspaceId}/split/${splitIds.join(",")}` : null,
    async (o) => {
      const sdk = getSdk(o, workspaceId!);
      const settled = await Promise.allSettled(splitIds.map((id) => getDreamRun(sdk, id, dreamHistory)));
      return Object.fromEntries(splitIds.map((id, i) => {
        const result = settled[i];
        return [id, result.status === "fulfilled" ? result.value : null];
      }));
    },
  );
  // A new finished run changes the set: keep the last split until the new one lands, so rows do not flicker.
  const [lastSplit, setLastSplit] = useState(split.data);
  if (split.data && split.data !== lastSplit) setLastSplit(split.data);
  const splitData = split.data ?? lastSplit;

  useEffect(() => {
    if (list.data) writeStored(seenKey, String(Date.now()));
  }, [list.data, seenKey]);

  const peerIds = (peers.data?.items ?? []).map((peer) => peer.id);
  for (const id of [filters.observed, filters.observer]) if (id && !peerIds.includes(id)) peerIds.push(id);
  const pages = Math.max(1, list.data?.pages ?? 1);
  const canInspect = provenance === "available";
  const listTotal = useListTotal();
  const timing: RunTiming = { now, stuckAfter: stuckAfterMs(items) };
  const countsOf = (run: DreamRun) => rowCounts(run, splitData?.[run.id] ?? undefined);
  const summary = summarizeRuns(items, (i) => countsOf(items[i]), now, timing.stuckAfter, seenBefore);
  const visible = show ? items.filter((run) => runFlags(run, countsOf(run), now, timing.stuckAfter, seenBefore)[show]) : items;
  const groups = groupRunsByStart(visible);
  // `omni` is the only dream type Honcho runs today: name it only where runs differ.
  const sharedType = items.length && items.every((run) => run.dream_type === items[0].dream_type) ? items[0].dream_type : undefined;
  const live = items.some((run) => runIsActive(run) && !runLooksStuck(run, now, timing.stuckAfter));
  const allOpen = visible.length > 0 && visible.every((run) => openRuns.has(run.id));
  const toggle = (id: string) =>
    setOpenRuns((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const shown: OpenRun | null = modalRun ?? (linkedRun ? { runId: linkedRun } : null);
  const closeRun = () => {
    setModalRun(null);
    if (linkedRun) setFilters(filters);
  };

  // Announce runs that change state while the page polls: a start, a finish, a failure, a stall.
  const liveRef = useRef<HTMLParagraphElement | null>(null);
  const statesRef = useRef<Map<string, string> | null>(null);
  const stuckAfter = timing.stuckAfter;
  useEffect(() => {
    const runs = list.data?.items;
    if (!runs) return;
    const before = statesRef.current;
    const after = new Map<string, string>();
    const notes: string[] = [];
    for (const run of runs) {
      const state = runLooksStuck(run, now, stuckAfter) ? "stuck" : run.status;
      after.set(run.id, state);
      if (!before) continue;
      const was = before.get(run.id);
      if (was === undefined) {
        if (state === "running") notes.push(`A dream started for ${pairText(run)}.`);
      } else if (was !== state) {
        notes.push(
          state === "stuck" ? `The dream for ${pairText(run)} may be stuck.`
            : state === "failed" ? `The dream for ${pairText(run)} failed.`
              : state === "completed" ? `The dream for ${pairText(run)} finished.`
                : `The dream for ${pairText(run)} was ${state}.`,
        );
      }
    }
    statesRef.current = after;
    if (notes.length && liveRef.current) liveRef.current.textContent = notes.join(" ");
  }, [list.data, now, stuckAfter]);

  return (
    <div className="space-y-3">
      <PageHeader
        title="DREAMS"
        subtitle="what each dream added, rewrote and forgot in a peer's representation"
        actions={
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <RefreshButton label="REFRESH" onClick={() => { list.refetch(); split.refetch(); peers.refetch(); }} />
            {canWrite && enabled ? (
              <Button icon="sparkles" onClick={() => setSchedule((s) => ({ open: true, key: s.key + 1 }))}>
                SCHEDULE_DREAM
              </Button>
            ) : null}
          </div>
        }
      />
      <p ref={liveRef} role="status" aria-live="polite" className="sr-only" />

      {!workspaceId ? (
        <Panel title="NO_WORKSPACE" status="idle">
          <p className="text-xs text-text-muted py-4">Select a workspace in the sidebar.</p>
        </Panel>
      ) : dreamHistory !== "available" ? (
        <Panel title="REPRESENTATION_HISTORY" status={dreamHistory === "checking" ? "processing" : "idle"}>
          <div className="space-y-3 max-w-[75ch]">
            <HonchoFeatureNotice state={dreamHistory} minimum="3.6" feature="Representation History" />
            <p className="text-[11px] text-text-primary leading-relaxed">
              From Honcho 3.6, each dream is recorded as it runs: the conclusions it created and what each came from,
              the conclusions it removed as they read before, and the peer card before and after. Scheduling dreams and
              watching the queue stay on <a href="#/reasoning" className="text-accent underline underline-offset-2">REASONING</a>.
            </p>
          </div>
        </Panel>
      ) : (
        <Panel
          title="DREAM_RUNS"
          status={list.isLoading || live ? "processing" : "active"}
          actions={list.data ? (
            <div className="flex items-center gap-2">
              {visible.length > 1 ? (
                <QuietButton
                  icon={allOpen ? "chevron-up" : "chevron-down"}
                  onClick={() => setOpenRuns(allOpen ? new Set() : new Set(visible.map((run) => run.id)))}
                >
                  {allOpen ? "COLLAPSE_ALL" : "EXPAND_ALL"}
                </QuietButton>
              ) : null}
              <span className="text-[11px] text-text-muted tabular-nums">
                {listTotal.format(list.data.total)} {list.data.total === 1 ? "run" : "runs"}
                {list.updatedAt ? (
                  <span className="hidden sm:inline"> · updated {shortAge(new Date(list.updatedAt).toISOString(), now)}</span>
                ) : null}
              </span>
            </div>
          ) : undefined}
        >
          {list.data && items.length ? (
            <TriageBar
              summary={summary}
              show={show}
              scope={pages > 1 ? `page ${page} of ${listTotal.pages(page, pages, list.data.total)}` : null}
              splitting={split.isLoading || split.isFetching}
              onShow={(next) => setFilters({ ...filters, show: next })}
            />
          ) : null}
          <FilterBar filters={filters} peerIds={peerIds} />
          {list.error ? (
            <RunsError error={list.error} retry={list.refetch} />
          ) : list.isLoading ? (
            <div className="space-y-2" role="status" aria-label="Loading dream runs">
              {[0, 1, 2, 3].map((n) => <div key={n} className="h-9 bg-border/40 motion-safe:animate-pulse" />)}
            </div>
          ) : items.length === 0 ? (
            <EmptyRuns
              filters={filters}
              canSchedule={canWrite}
              onSchedule={() => setSchedule((s) => ({ open: true, key: s.key + 1 }))}
            />
          ) : visible.length === 0 ? (
            <div className="flex flex-wrap items-center gap-3 py-6">
              <p className="text-xs text-text-primary">No run on this page matches that.</p>
              <Button size="sm" variant="secondary" onClick={() => setFilters({ ...filters, show: null })}>SHOW_ALL</Button>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                {groups.map((group) => (
                  <RunGroup
                    key={group.key}
                    group={group}
                    workspaceId={workspaceId}
                    timing={timing}
                    sharedType={sharedType}
                    seenBefore={seenBefore}
                    split={splitData}
                    refetchSplit={split.refetch}
                    openRuns={openRuns}
                    onToggle={toggle}
                    canInspect={canInspect}
                    onOpenRun={(runId, focusId) => setModalRun({ runId, focusId })}
                    onInspect={setInspected}
                  />
                ))}
              </div>
              {pages > 1 ? (
                <div className="flex items-center justify-between gap-2 pt-3 text-[11px] text-text-primary">
                  <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>PREV</Button>
                  <span className="tabular-nums">page {page} / {listTotal.pages(page, pages, list.data?.total ?? 0)}</span>
                  <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>NEXT</Button>
                </div>
              ) : null}
            </>
          )}
        </Panel>
      )}

      <StatusBar />

      {shown && workspaceId && enabled ? (
        <DreamRunModal
          key={`${shown.runId}/${shown.focusId ?? ""}`}
          start={shown}
          workspaceId={workspaceId}
          timing={timing}
          canInspect={canInspect}
          onInspect={setInspected}
          onClose={closeRun}
        />
      ) : null}
      {inspected ? <ConclusionInspector id={inspected} onClose={() => setInspected(null)} /> : null}
      {canWrite ? (
        <ScheduleDreamModal
          key={schedule.key}
          open={schedule.open}
          onClose={() => setSchedule((s) => ({ ...s, open: false }))}
          onScheduled={() => list.refetch()}
          initial={{ observer: filters.observer ?? filters.observed, observed: filters.observed }}
        />
      ) : null}
    </div>
  );
}

// --- The verdict --------------------------------------------------------------

/**
 * One line that answers "did anything go wrong": failures, stalls, losses and
 * card changes on the loaded page, each a toggle that narrows the list to it.
 */
function TriageBar({ summary, show, scope, splitting, onShow }: {
  summary: DreamSummary;
  show: DreamShow | null;
  /** Set when the list has more pages than the one counted. */
  scope: string | null;
  splitting: boolean;
  onShow: (next: DreamShow | null) => void;
}) {
  const trouble = summary.failed + summary.stuck + summary.forgotten;
  // Still reading removals that would change the verdict.
  const settled = !(splitting && summary.unsplit > 0);
  const verdict = trouble > 0
    ? null
    : !settled
      ? "checking what was removed"
      : summary.running
        ? `${summary.running} running, nothing failed or forgotten`
        : "all finished, nothing forgotten";
  const toggles: { key: DreamShow; n: number; label: string; tone?: string; title: string }[] = [
    { key: "failed", n: summary.failed, label: "failed", tone: "text-red-400", title: "Failed or interrupted runs" },
    { key: "stuck", n: summary.stuck, label: "may be stuck", tone: "text-yellow-400", title: "Running far longer than dreams here take" },
    { key: "forgotten", n: summary.forgotten, label: "forgotten", tone: "text-red-400", title: "Conclusions removed with nothing to replace them" },
    { key: "card", n: summary.cards, label: summary.cards === 1 ? "card changed" : "cards changed", title: "Runs that changed a peer card" },
    { key: "new", n: summary.new, label: "new", title: "Runs that started since you last opened this page" },
  ];
  const icon = trouble > 0 ? "warning" : settled ? "check" : "loader";
  return (
    <div role="group" aria-label="What needs attention" className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border border-border px-2.5 py-2 text-[11px]">
      <span className="flex min-w-0 items-center gap-1.5 text-text-primary">
        <Icon
          name={icon}
          size={12}
          className={cn("shrink-0", trouble > 0 ? "text-yellow-400" : settled ? "text-cyan-400" : "text-text-muted motion-safe:animate-spin")}
        />
        <span className="tabular-nums">
          {summary.runs.toLocaleString()} {summary.runs === 1 ? "dream" : "dreams"}
          {scope ? <span className="text-text-muted"> on {scope}</span> : null}
          {verdict ? <span className="text-text-muted">, {verdict}</span> : null}
        </span>
      </span>
      {toggles.filter((t) => t.n > 0 || show === t.key).map((t) => (
        <ToggleButton
          key={t.key}
          active={show === t.key}
          title={t.title}
          onClick={() => onShow(show === t.key ? null : t.key)}
          className={cn("h-9 sm:h-7 text-[11px] tabular-nums", show !== t.key && t.tone)}
        >
          {t.n.toLocaleString()} {t.label}
        </ToggleButton>
      ))}
      {summary.unsplit > 0 && settled ? (
        <span
          className="text-text-muted"
          title="Retention dropped what these runs removed, or they are still running, so their removals are not split into rewritten and forgotten."
        >
          {summary.unsplit} with removals not split
        </span>
      ) : null}
      {show ? (
        <QuietButton icon="x" className="ml-auto" onClick={() => onShow(null)}>SHOW_ALL</QuietButton>
      ) : null}
    </div>
  );
}

// --- Filters and the legend -------------------------------------------------

function FilterBar({ filters, peerIds }: { filters: DreamFilters; peerIds: string[] }) {
  const [open, setOpen] = useState(false);
  // Open on a first visit where there is room for it, then as last left.
  const [help, setHelp] = useState(() => {
    const stored = readStored(LEGEND_KEY);
    if (stored) return stored === "open";
    return typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
  });
  const fieldsId = useId();
  const helpId = useId();
  const filtered = !!(filters.observed || filters.observer);
  const options = peerIds.map((id) => ({ value: id, label: id }));
  const summary = `${filters.observed ? `about ${filters.observed}` : "every peer"} · ${filters.observer ? `${filters.observer}'s view` : "every observer"}`;
  const toggleHelp = () => {
    setHelp(!help);
    writeStored(LEGEND_KEY, help ? "closed" : "open");
  };
  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          icon="filter"
          className="md:hidden h-9 text-[11px]"
          aria-expanded={open}
          aria-controls={fieldsId}
          onClick={() => setOpen((v) => !v)}
        >
          FILTER
        </Button>
        <span className="md:hidden min-w-0 flex-1 truncate text-[11px] text-text-primary" title={summary}>{summary}</span>
        <div
          id={fieldsId}
          className={cn("w-full md:w-auto", open ? "grid grid-cols-1 gap-2" : "hidden", "md:flex md:flex-wrap md:items-center md:gap-3")}
        >
          <FilterSelect
            label="OBSERVER"
            value={filters.observer}
            empty="— every observer —"
            options={options}
            describe={(v) => `Observer: ${v ?? "every observer"}`}
            onChange={(value) => setFilters({ ...filters, observer: value })}
          />
          <FilterSelect
            label="OBSERVED"
            value={filters.observed}
            empty="— every peer —"
            options={options}
            describe={(v) => `Observed: ${v ?? "every peer"}`}
            onChange={(value) => setFilters({ ...filters, observed: value })}
          />
          {filtered ? (
            <Button
              size="sm"
              variant="ghost"
              icon="x"
              className="justify-self-start"
              onClick={() => setFilters({ observed: null, observer: null, show: filters.show })}
            >
              CLEAR
            </Button>
          ) : null}
        </div>
        <Button
          size="sm"
          variant={help ? "secondary" : "ghost"}
          icon="book"
          className="ml-auto h-9 md:h-7 text-[11px]"
          aria-expanded={help}
          aria-controls={help ? helpId : undefined}
          onClick={toggleHelp}
        >
          HOW_TO_READ
        </Button>
      </div>
      {help ? <HowToRead id={helpId} /> : null}
    </div>
  );
}

function FilterSelect({ label, value, empty, options, describe, onChange }: {
  label: string;
  value: string | null;
  empty: string;
  options: { value: string; label: string }[];
  describe: (value: string | null) => string;
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="w-[72px] md:w-auto shrink-0 text-[11px] uppercase tracking-wider text-text-muted" aria-hidden>{label}</span>
      <Select
        className="min-w-0 flex-1 md:w-52 md:flex-none"
        value={value ?? ""}
        onChange={(next) => onChange(next || null)}
        options={[{ value: "", label: empty }, ...options]}
        placeholder={empty}
        ariaLabel={describe(value)}
      />
    </div>
  );
}

/**
 * One line of the key: a category, then what you see in the list beside what
 * it means. On wide screens the lines share columns (subgrid), so the key reads
 * as a table: four columns on wide screens, two on narrower ones. On a phone
 * each line wraps on its own.
 */
function LegendGroup({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className="grid gap-x-4 gap-y-1 sm:grid-cols-[72px_minmax(0,1fr)] lg:col-span-3 lg:grid-cols-subgrid xl:col-span-5"
    >
      <p id={titleId} className="text-[11px] uppercase tracking-wider leading-5 text-text-muted">{title}</p>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 lg:col-span-2 lg:grid lg:grid-cols-subgrid xl:col-span-4">{children}</dl>
    </div>
  );
}

function LegendItem({ shows, children, title }: { shows: ReactNode; children: ReactNode; title?: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2" title={title}>
      <dt className="flex shrink-0 items-center gap-1.5 whitespace-nowrap leading-5 text-text-primary">{shows}</dt>
      <dd className="min-w-0 leading-5 text-text-muted">{children}</dd>
    </div>
  );
}

/** A key, not prose: each entry is drawn the way it appears in the list. */
function HowToRead({ id }: { id: string }) {
  return (
    <div id={id} className="grid gap-y-1.5 border border-border px-3 py-2.5 text-[11px] lg:grid-cols-[72px_repeat(2,auto)] lg:justify-start lg:gap-x-8 xl:grid-cols-[72px_repeat(4,auto)]">
      <LegendGroup title="RUNS">
        <LegendItem shows={<span className="font-mono">alice<span className="text-text-muted"> → </span>bob</span>}>alice&apos;s view of bob</LegendItem>
        <LegendItem shows={<span className="font-mono">bob</span>}>bob&apos;s view of itself</LegendItem>
        <LegendItem shows="auto">after enough new conclusions</LegendItem>
        <LegendItem shows="scheduled">queued by hand</LegendItem>
      </LegendGroup>
      <LegendGroup title="CHANGES">
        <LegendItem shows={<><Marker kind="forgotten" spoken={false} />forgotten</>}>removed, not replaced</LegendItem>
        <LegendItem shows={<><Marker kind="rewritten" spoken={false} />rewritten</>}>swapped for a near-duplicate</LegendItem>
        <LegendItem shows={<><Marker kind="added" spoken={false} />added</>}>a new conclusion</LegendItem>
      </LegendGroup>
      <LegendGroup title="LEVELS">
        <LegendItem shows={<><LevelIcon level="deductive" spoken={false} />deductive</>}>deduced from premises</LegendItem>
        <LegendItem shows={<><LevelIcon level="inductive" spoken={false} />inductive</>}>a pattern across conclusions</LegendItem>
        <LegendItem shows={<><LevelIcon level="explicit" spoken={false} />explicit</>}>stated in a message</LegendItem>
      </LegendGroup>
      <LegendGroup title="FLAGS">
        <LegendItem shows="card">peer card rewritten</LegendItem>
        <LegendItem
          shows={<span className="inline-flex items-center gap-1 text-yellow-400"><Icon name="warning" size={12} />may be stuck</span>}
          title="Running more than three times as long as the slowest finished dream on this page. Never flagged under 30 minutes, always flagged after 6 hours."
        >
          over 3× the slowest run
        </LegendItem>
        <LegendItem shows="pruned" title="Honcho keeps runs 30 days by default. After that a run keeps only the conclusions it created that still exist.">
          past retention, removals not split
        </LegendItem>
        <LegendItem shows={<span className="text-accent">new</span>}>since your last visit</LegendItem>
      </LegendGroup>
    </div>
  );
}

// --- States -----------------------------------------------------------------

const LINK = "text-accent underline underline-offset-2";

function RunsError({ error, retry }: { error: Error; retry: () => void }) {
  const status = (error as { status?: number }).status;
  return (
    <div className="space-y-2 py-2" role="alert">
      <p className="text-[11px] text-red-400 break-words">{error.message}</p>
      <p className="text-[11px] text-text-primary">
        {status === 401 || status === 403
          ? "Representation History needs a workspace or admin key. Check the key in CONFIG."
          : status !== undefined && status >= 500
            ? <>Honcho answered {status} for dream history, so the server is reachable. Its log on <a href="#/diagnostics" className={LINK}>DIAGNOSTICS</a> should say why.</>
            : <>Check the connection in <a href="#/config" className={LINK}>CONFIG</a>, then retry.</>}
      </p>
      <Button size="sm" variant="ghost" onClick={retry}>RETRY</Button>
    </div>
  );
}

function RunReadError({ error, retry }: { error: Error; retry: () => void }) {
  const status = (error as { status?: number }).status;
  return (
    <div className="space-y-2" role="alert">
      <p className="text-[11px] text-red-400 break-words">{error.message}</p>
      <p className="text-[11px] text-text-primary">
        {status === 404
          ? "Honcho no longer has this run: it went with its workspace, or retention removed it once nothing in it was left."
          : status === 401 || status === 403
            ? "Access denied. Check the key in CONFIG."
            : status !== undefined && status >= 500
              ? `Honcho answered ${status} for this run, so the server is reachable. Its log on DIAGNOSTICS should say why.`
              : "Check the connection in CONFIG, then retry."}
      </p>
      <Button size="sm" variant="ghost" onClick={retry}>RETRY</Button>
    </div>
  );
}

function EmptyRuns({ filters, canSchedule, onSchedule }: { filters: DreamFilters; canSchedule: boolean; onSchedule: () => void }) {
  if (filters.observed || filters.observer) {
    const about = filters.observed ? <> about <span className="font-mono text-accent">{filters.observed}</span></> : null;
    const from = filters.observer ? <> from <span className="font-mono text-accent">{filters.observer}</span>&apos;s view</> : null;
    return (
      <div className="flex flex-wrap items-center gap-3 py-6">
        <p className="text-xs text-text-primary">No dreams{about}{from} in the retention window.</p>
        <Button size="sm" variant="secondary" onClick={() => setFilters({ observed: null, observer: null })}>CLEAR_FILTERS</Button>
      </div>
    );
  }
  return (
    <div className="py-6 space-y-3 max-w-[75ch]">
      <div className="flex items-center gap-2 text-xs text-text-primary">
        <Icon name="history" size={14} className="text-text-muted" />
        No dreams recorded in this workspace yet.
      </div>
      <p className="text-[11px] text-text-muted leading-relaxed">
        A dream runs on its own once a representation has gathered enough new conclusions, or when you schedule one. Each
        run shows up here as it starts. If dreams do run and this stays empty, the server may have recording turned off
        (<span className="font-mono">DREAM_HISTORY_ENABLED=false</span>).
      </p>
      {canSchedule ? <Button icon="sparkles" onClick={onSchedule}>SCHEDULE_DREAM</Button> : null}
    </div>
  );
}

// --- The run list -----------------------------------------------------------

/** "Today 2:05 PM", "Yesterday 6:56 PM" or a date. The age shows only within a day, where it adds something. */
function startLabel(iso: string, now: number): { label: string; age: string | null } {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return { label: "start not recorded", age: null };
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(new Date(now)) - day(at)) / 86_400_000);
  const age = now - at.getTime() < 86_400_000 ? shortAge(iso, now) : null;
  if (days === 0) return { label: `Today ${time}`, age };
  if (days === 1) return { label: `Yesterday ${time}`, age };
  return { label: `${at.toLocaleDateString(undefined, { month: "short", day: "numeric", year: days > 330 ? "numeric" : undefined })}, ${time}`, age };
}

interface RunListProps {
  workspaceId: string;
  timing: RunTiming;
  sharedType: string | null | undefined;
  seenBefore: number | null;
  split: Record<string, DreamRunDetail | null> | undefined;
  refetchSplit: () => void;
  canInspect: boolean;
  onOpenRun: OnOpenRun;
  onInspect: (id: string) => void;
}

/** Runs that started together, under the time they started. */
function RunGroup({ group, openRuns, onToggle, ...props }: RunListProps & {
  group: DreamRunGroup;
  openRuns: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const headingId = useId();
  const triggers = new Set(group.runs.map((run) => triggerLabel(run.trigger_reason)));
  const sharedTrigger = triggers.size === 1 ? [...triggers][0] : undefined;
  const n = group.runs.length;
  const start = startLabel(group.startedAt, props.timing.now);
  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <h2 id={headingId} className="flex flex-wrap items-baseline gap-x-2 pb-1.5 text-[11px] font-medium text-text-primary tabular-nums">
        <time dateTime={group.startedAt} title={new Date(group.startedAt).toLocaleString()}>{start.label}</time>
        <span className="font-normal text-text-muted">
          {start.age ? `${start.age} · ` : null}{n} {n === 1 ? "dream" : "dreams"}
          {sharedTrigger ? ` · ${sharedTrigger}` : null}
        </span>
      </h2>
      <ul className="border border-border divide-y divide-border">
        {group.runs.map((run) => (
          <RunRow
            key={run.id}
            run={run}
            open={openRuns.has(run.id)}
            onToggle={() => onToggle(run.id)}
            showTrigger={sharedTrigger === undefined}
            {...props}
          />
        ))}
      </ul>
    </section>
  );
}

/** A run's own detail: an open run the page did not read, or a live run that changes as it commits. */
function useRunDetail(run: DreamRun, workspaceId: string, load: boolean, timing: RunTiming): QueryState<DreamRunDetail> {
  const { dreamHistory } = useHonchoCapabilities();
  const stuck = runLooksStuck(run, timing.now, timing.stuckAfter);
  return useHonchoQuery<DreamRunDetail>(
    load ? `dreams/${workspaceId}/run/${run.id}` : null,
    (o) => getDreamRun(getSdk(o, workspaceId), run.id, dreamHistory),
    // A finished run only changes when retention trims it; a live one changes as it commits.
    { refreshInterval: (data) => ((data ? runIsActive(data) : runIsActive(run)) ? (stuck ? 60_000 : 5_000) : undefined) },
  );
}

/** Counts for a row: known outright when nothing was removed, otherwise from the detail. */
function rowCounts(run: DreamRun, detail: DreamRunDetail | undefined): DreamChangeCounts | null {
  if (run.removed_count === 0) return { added: run.created_count, rewritten: 0, forgotten: 0 };
  return detail ? changeCounts(detail) : null;
}

function RunRow({ run, open, onToggle, showTrigger, workspaceId, timing, sharedType, seenBefore, split, refetchSplit, canInspect, onOpenRun, onInspect }: RunListProps & {
  run: DreamRun;
  open: boolean;
  onToggle: () => void;
  showTrigger: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const bodyId = useId();
  const rowRef = useRef<HTMLButtonElement | null>(null);
  const batched = split?.[run.id] ?? undefined;
  const live = runIsActive(run);
  const own = useRunDetail(run, workspaceId, (open && !batched) || (live && run.removed_count > 0 && !run.pruned_at), timing);
  const detail: QueryState<DreamRunDetail> = batched && !live
    ? { data: batched, error: undefined, isLoading: false, isFetching: false, updatedAt: undefined, refetch: refetchSplit }
    : own;
  const counts = rowCounts(run, detail.data);
  const stuck = runLooksStuck(run, timing.now, timing.stuckAfter);
  const flags = runFlags(run, counts, timing.now, timing.stuckAfter, seenBefore);
  const extras = [
    run.dream_type && run.dream_type !== sharedType ? run.dream_type : null,
    showTrigger ? triggerLabel(run.trigger_reason) : null,
  ].filter(Boolean);

  const collapse = () => {
    onToggle();
    rowRef.current?.focus();
    rowRef.current?.scrollIntoView({ block: "nearest" });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    const target = event.target as HTMLElement;
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      collapse();
      return;
    }
    if (!target.matches("[data-dream-row]")) return;
    const rows = [...document.querySelectorAll<HTMLButtonElement>("[data-dream-row]")];
    const at = rows.indexOf(target as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? rows[at + 1]
      : event.key === "ArrowUp" ? rows[at - 1]
        : event.key === "Home" ? rows[0]
          : event.key === "End" ? rows.at(-1)
            : undefined;
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  return (
    <li className={cn("min-w-0", open && "bg-void/30")} onKeyDown={onKeyDown}>
      <h3>
        <button
          ref={rowRef}
          type="button"
          data-dream-row
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={onToggle}
          className="w-full min-h-11 sm:min-h-0 grid grid-cols-[minmax(0,1fr)_auto_12px] sm:grid-cols-[minmax(0,22rem)_minmax(0,1fr)_minmax(88px,auto)_12px] items-center gap-x-4 px-3 py-2 text-left hover:bg-void/40 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        >
          <span className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
            <PeerPair run={run} active={open} />
            {flags.new ? <span className="text-[11px] text-accent">new</span> : null}
            <RunStatus run={run} stuck={stuck} now={timing.now} inRow />
            {run.pruned_at ? <span className="text-[11px] text-text-muted">pruned</span> : null}
            {extras.length ? <span className="text-[11px] text-text-muted">{extras.join(" · ")}</span> : null}
          </span>
          <span className="text-right sm:text-left text-[11px] whitespace-nowrap">
            <ChangeTokens run={run} counts={counts} />
          </span>
          <span className="hidden sm:block text-right text-[11px] text-text-muted tabular-nums whitespace-nowrap">
            <RunTime run={run} stuck={stuck} now={timing.now} />
          </span>
          <Icon
            name="chevron-right"
            size={12}
            className={cn("text-text-muted motion-safe:transition-transform motion-safe:duration-150", open && "rotate-90 text-accent")}
          />
        </button>
      </h3>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={bodyId}
            key="body"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, height: "auto" }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="border-t border-border px-3 py-3 space-y-3">
              <RunBody detail={detail} timing={timing} canInspect={canInspect} onOpenRun={onOpenRun} onInspect={onInspect} />
              {/* A long run scrolls its row away, so it can also be closed from the bottom. */}
              <div className="flex justify-end">
                <QuietButton icon="chevron-up" onClick={collapse} aria-label={`Collapse the dream for ${pairText(run)}`}>COLLAPSE</QuietButton>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </li>
  );
}

function PeerPair({ run, active = false }: { run: Pick<DreamRun, "observer_id" | "observed_id">; active?: boolean }) {
  const name = cn("font-mono text-[13px] break-all", active ? "text-accent" : "text-text-primary");
  if (run.observer_id === run.observed_id) {
    return (
      <span className={name} title={pairText(run)}>
        {run.observed_id}
        <span className="sr-only">&apos;s own view</span>
      </span>
    );
  }
  return (
    <span className={name} title={pairText(run)}>
      {run.observer_id}
      <span aria-hidden className="text-text-muted"> → </span>
      <span className="sr-only">&apos;s view of </span>
      {run.observed_id}
    </span>
  );
}

const CHIP_TEXT = "text-[11px]";

/**
 * Nothing for a finished run: only the states that need attention speak. A
 * live run is accent, not a warning. Only a stall or a failure warns. Elapsed
 * time stays out of the uppercase chip: in a row it shows in the timing column,
 * or beside the chip on a phone.
 */
function RunStatus({ run, stuck, now, inRow = false }: { run: DreamRun; stuck: boolean; now: number; inRow?: boolean }) {
  const elapsed = runElapsedMs(run, now);
  if (run.status === "running") {
    return (
      <>
        {stuck ? (
          <Chip tone="warn" icon="warning" className={CHIP_TEXT}>may be stuck</Chip>
        ) : (
          <Chip tone="accent" icon="loader" className={CHIP_TEXT}>running</Chip>
        )}
        {elapsed !== null ? (
          <span className={cn("text-[11px] tabular-nums", stuck ? "text-yellow-400" : "text-text-muted", inRow && "sm:sr-only")}>
            {formatElapsed(elapsed)}
          </span>
        ) : null}
      </>
    );
  }
  if (run.status === "failed") return <Chip tone="danger" icon="x-circle" className={CHIP_TEXT}>failed</Chip>;
  if (run.status === "interrupted") return <Chip tone="orange" icon="alert-circle" className={CHIP_TEXT}>interrupted</Chip>;
  return null;
}

function RunTime({ run, stuck, now }: { run: DreamRun; stuck: boolean; now: number }) {
  const duration = runDurationMs(run);
  if (duration !== null) return <span title="How long the dream took">{formatDuration(duration)}</span>;
  if (run.status === "running") {
    const elapsed = runElapsedMs(run, now);
    // The status chip's own elapsed time is read to screen readers; this repeats it for sight.
    return <span aria-hidden className={cn(stuck && "text-yellow-400")}>running {elapsed !== null ? formatElapsed(elapsed) : ""}</span>;
  }
  return <span>no finish recorded</span>;
}

function Token({ kind, n }: { kind: ChangeKind; n: number }) {
  const mark = MARK[kind];
  return (
    <span className={cn("tabular-nums", mark.tone)}>
      <span aria-hidden>{mark.glyph}{n.toLocaleString()}</span>
      <span className="sr-only">{n.toLocaleString()} {mark.word.toLowerCase()}</span>
    </span>
  );
}

/**
 * `+10 ~2 −1 card`. Until a run's removals are split (its detail is loading,
 * retention dropped them, or it is still running), the same grammar reads
 * muted: `+12 −2`, created and removed.
 */
function ChangeTokens({ run, counts }: {
  run: Pick<DreamRun, "created_count" | "removed_count" | "peer_card_updated" | "pruned_at">;
  counts: DreamChangeCounts | null;
}) {
  const parts: ReactNode[] = [];
  if (counts) {
    if (counts.added) parts.push(<Token key="a" kind="added" n={counts.added} />);
    if (counts.rewritten) parts.push(<Token key="r" kind="rewritten" n={counts.rewritten} />);
    if (counts.forgotten) parts.push(<Token key="f" kind="forgotten" n={counts.forgotten} />);
  } else {
    const why = run.pruned_at ? "Retention dropped what this run removed" : "What this run removed is still being read";
    parts.push(
      <span key="u" className="tabular-nums text-text-muted" title={`${why}, so removals are not split into rewritten and forgotten.`}>
        <span aria-hidden>
          {run.created_count ? `+${run.created_count.toLocaleString()}` : null}
          {run.created_count && run.removed_count ? " " : null}
          {run.removed_count ? `−${run.removed_count.toLocaleString()}` : null}
        </span>
        <span className="sr-only">{run.created_count.toLocaleString()} created, {run.removed_count.toLocaleString()} removed, not split</span>
      </span>,
    );
  }
  if (run.peer_card_updated) {
    parts.push(
      <span key="card" className={run.pruned_at ? "text-text-muted" : "text-text-primary"} title="The dream rewrote the peer card">
        card<span className="sr-only"> updated</span>
      </span>,
    );
  }
  if (!parts.length) return <span className="text-text-muted">no changes</span>;
  return <span className="inline-flex flex-wrap justify-end sm:justify-start gap-x-2">{parts}</span>;
}

// --- One run ------------------------------------------------------------------

function RunBody({ detail, timing, canInspect, onOpenRun, onInspect, showHeader = false, focusId }: {
  detail: QueryState<DreamRunDetail>;
  timing: RunTiming;
  canInspect: boolean;
  onOpenRun: OnOpenRun;
  onInspect: (id: string) => void;
  showHeader?: boolean;
  focusId?: string;
}) {
  if (detail.error) return <RunReadError error={detail.error} retry={detail.refetch} />;
  if (!detail.data) {
    return (
      <div className="space-y-2" role="status" aria-label="Loading dream run">
        {[0, 1, 2].map((n) => <div key={n} className="h-4 bg-border/40 motion-safe:animate-pulse" style={{ width: `${90 - n * 20}%` }} />)}
      </div>
    );
  }
  return (
    <DreamRunDetailView
      run={detail.data}
      timing={timing}
      canInspect={canInspect}
      onOpenRun={onOpenRun}
      onInspect={onInspect}
      showHeader={showHeader}
      focusId={focusId}
    />
  );
}

function DreamRunDetailView({ run, timing, canInspect, onOpenRun, onInspect, showHeader, focusId }: {
  run: DreamRunDetail;
  timing: RunTiming;
  canInspect: boolean;
  onOpenRun: OnOpenRun;
  onInspect: (id: string) => void;
  showHeader: boolean;
  focusId?: string;
}) {
  const missing = missingCreated(run);
  const changes = runChanges(run);
  const counts = changeCounts(run);
  const stuck = runLooksStuck(run, timing.now, timing.stuckAfter);
  const startText = new Date(run.started_at).toLocaleString();
  const conclusionsId = useId();
  const cardId = useId();
  return (
    <div className="space-y-3 min-w-0">
      {showHeader ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <PeerPair run={run} />
          <RunStatus run={run} stuck={stuck} now={timing.now} />
          <span className="text-[11px]"><ChangeTokens run={run} counts={counts} /></span>
        </div>
      ) : null}

      <RunMeta run={run} showDuration={showHeader} />

      {run.status === "failed" || run.status === "interrupted" ? (
        <Note tone={run.status === "failed" ? "danger" : "warn"}>
          This dream {run.status === "failed" ? "failed" : "was interrupted"}. Honcho records no reason in its history, and it
          commits each change as it is made, so the changes below did happen. Failed queue items are on{" "}
          <a href={FAILED_TASKS_HREF} className={LINK}>REASONING</a> and the deriver log is on{" "}
          <a href="#/diagnostics" className={LINK}>DIAGNOSTICS</a>. Look around {startText}.{" "}
          <CopyButton value={run.started_at} label="start time" text="COPY_TIME" />
        </Note>
      ) : null}
      {run.status === "running" && stuck ? (
        <Note tone="warn">
          Running for {formatElapsed(runElapsedMs(run, timing.now) ?? 0)} with no finish recorded, far longer than dreams here
          take. The deriver may have stopped mid-dream, which leaves a run marked running for good. The queue is on{" "}
          <a href="#/reasoning" className={LINK}>REASONING</a> and the deriver log on{" "}
          <a href="#/diagnostics" className={LINK}>DIAGNOSTICS</a>. Look around {startText}.{" "}
          <CopyButton value={run.started_at} label="start time" text="COPY_TIME" />
        </Note>
      ) : run.status === "running" ? (
        <Note>Still running. Changes appear as the dream commits them.</Note>
      ) : null}
      {run.pruned_at ? (
        <Note>
          Retention trimmed this run on {new Date(run.pruned_at).toLocaleDateString()}. It keeps only the conclusions it created
          that still exist. What it removed and how the peer card changed are gone. The counts are as the dream recorded them.
        </Note>
      ) : null}

      <section aria-labelledby={conclusionsId} className="space-y-2">
        <SectionHead id={conclusionsId} label="CONCLUSIONS">
          <CountsLine run={run} counts={counts} />
        </SectionHead>
        {missing > 0 ? (
          <p className="text-[11px] text-text-muted">
            {missing.toLocaleString()} of {run.created_count.toLocaleString()} created no longer listed: deleted since, or trimmed by retention.
          </p>
        ) : null}
        {changes.length ? (
          (["forgotten", "rewritten", "added"] as const).map((kind) => {
            const group = changes.filter((change) => change.kind === kind);
            return group.length ? (
              <ChangeGroup
                key={kind}
                kind={kind}
                changes={group}
                runId={run.id}
                canInspect={canInspect}
                onOpenRun={onOpenRun}
                onInspect={onInspect}
                focusId={focusId}
              />
            ) : null;
          })
        ) : (
          <p className="text-[11px] text-text-primary">
            {run.created_count === 0 && run.removed_count === 0 ? "This dream changed no conclusions." : "Not kept past the retention window."}
          </p>
        )}
      </section>

      <section aria-labelledby={cardId} className="space-y-1.5">
        <SectionHead id={cardId} label="PEER_CARD">
          {run.peer_card ? <CardSummary change={run.peer_card} /> : null}
        </SectionHead>
        {run.peer_card ? <PeerCardChange change={run.peer_card} /> : (
          <p className="text-[11px] text-text-primary">
            {run.peer_card_updated ? "Not kept past the retention window." : "This dream left the peer card unchanged."}
          </p>
        )}
      </section>
    </div>
  );
}

/** Reconciles the dream's own counts with the diff: "12 created (10 new, 2 replacing) · 2 removed (2 rewritten)". */
function CountsLine({ run, counts }: { run: DreamRunDetail; counts: DreamChangeCounts | null }) {
  const created = run.created_count.toLocaleString();
  const removed = run.removed_count.toLocaleString();
  if (!counts) {
    return <span className="text-text-muted tabular-nums">{created} created · {removed} removed{run.removed_count ? ", not split" : ""}</span>;
  }
  const replacing = run.created_count - counts.added;
  const createdParts = replacing > 0 ? ` (${counts.added.toLocaleString()} new, ${replacing.toLocaleString()} replacing)` : "";
  const removedParts = [
    counts.rewritten ? `${counts.rewritten.toLocaleString()} rewritten` : null,
    counts.forgotten ? `${counts.forgotten.toLocaleString()} forgotten` : null,
  ].filter(Boolean).join(", ");
  return (
    <span className="text-text-muted tabular-nums">
      {created} created{createdParts} · {removed} removed{removedParts ? ` (${removedParts})` : ""}
    </span>
  );
}

function RunMeta({ run, showDuration }: { run: DreamRunDetail; showDuration: boolean }) {
  const duration = runDurationMs(run);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
      <span>
        Started <time dateTime={run.started_at} className="text-text-primary">{new Date(run.started_at).toLocaleString()}</time>
        {run.finished_at ? (
          <>
            {" · finished "}
            <time dateTime={run.finished_at} className="text-text-primary">{new Date(run.finished_at).toLocaleTimeString()}</time>
          </>
        ) : null}
        {showDuration && duration !== null ? <> · <span className="text-text-primary">{formatDuration(duration)}</span></> : null}
      </span>
      <span className="flex flex-wrap items-center gap-1">
        <CopyButton value={run.id} label="run id" text="COPY_RUN_ID" />
        <CopyButton
          value={() => `${window.location.origin}${window.location.pathname}${dreamRunHash(run.id)}`}
          label="link to this run"
          text="COPY_LINK"
          icon="external-link"
        />
      </span>
    </div>
  );
}

function CopyButton({ value, label, text, icon = "copy" }: {
  value: string | (() => string);
  label: string;
  text: string;
  icon?: "copy" | "external-link";
}) {
  const { push } = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(typeof value === "function" ? value() : value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      push({ type: "error", message: `Could not copy the ${label}. The browser blocked clipboard access.` });
    }
  };
  return (
    <QuietButton
      icon={copied ? "check" : icon}
      onClick={copy}
      title={typeof value === "string" ? value : undefined}
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
    >
      {copied ? "COPIED" : text}
    </QuietButton>
  );
}

function Note({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" | "danger" }) {
  return (
    <div className={cn(
      "text-[11px] text-text-primary leading-relaxed border px-3 py-2 max-w-[80ch]",
      tone === "danger" ? "border-red-500/40 bg-red-500/5" : tone === "warn" ? "border-yellow-500/40 bg-yellow-500/5" : "border-border bg-void/30",
    )}>
      {children}
    </div>
  );
}

function SectionHead({ id, label, children }: { id: string; label: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-border-light pb-1">
      <h4 id={id} className="text-[11px] font-medium uppercase tracking-wider text-text-primary">{label}</h4>
      {children ? <span className="text-[11px]">{children}</span> : null}
    </div>
  );
}

/** `spoken` is false where the text beside the marker already names it. */
function Marker({ kind, spoken = true }: { kind: ChangeKind; spoken?: boolean }) {
  const mark = MARK[kind];
  return (
    <span className={cn("font-mono text-[13px] leading-5 select-none", mark.tone)}>
      <span aria-hidden>{mark.glyph}</span>
      {spoken ? <span className="sr-only">{mark.word}: </span> : null}
    </span>
  );
}

function LevelIcon({ level, spoken = true }: { level: string | null | undefined; spoken?: boolean }) {
  const meta = levelMeta(level);
  const name = level ? meta.label.toLowerCase() : "level not recorded";
  return (
    <span className={cn("inline-flex h-5 items-center", meta.tone)} title={name}>
      {"icon" in meta && meta.icon ? <Icon name={meta.icon} size={12} /> : <span aria-hidden className="text-text-muted">·</span>}
      {spoken ? <span className="sr-only">{name}, </span> : null}
    </span>
  );
}

/** A created conclusion that is no longer current says why, as a status beside a plain action. */
function RefStatus({ conclusion, runId, onOpenRun }: {
  conclusion: DreamConclusionRef;
  /** The run being shown: a conclusion removed later in the same dream needs no link. */
  runId: string;
  onOpenRun: OnOpenRun;
}) {
  if (conclusion.status === "current") return null;
  if (conclusion.status === "removed" && conclusion.removed_in_run === runId) {
    return <span className="text-[11px] text-text-muted">removed later in this dream</span>;
  }
  if (conclusion.status === "removed" && conclusion.removed_in_run) {
    const removedIn = conclusion.removed_in_run;
    return (
      <span className="inline-flex items-center gap-1">
        <span className="text-[11px] text-text-muted">removed by a later dream</span>
        <QuietButton
          icon="history"
          onClick={() => onOpenRun(removedIn, conclusion.id)}
          aria-label={`Open the dream that removed conclusion ${conclusion.id}`}
        >
          OPEN
        </QuietButton>
      </span>
    );
  }
  return <span className="text-[11px] text-text-muted">{conclusion.status === "removed" ? "removed since" : "deleted since"}</span>;
}

/**
 * Row actions stay quiet until pointed at, so the conclusion text leads. Same
 * focus ring as the rows, and phone-sized targets below `sm`.
 */
function QuietButton(props: ComponentProps<typeof Button>) {
  return (
    <Button
      size="sm"
      variant="ghost"
      {...props}
      className={cn(
        "h-9 sm:h-6 px-2 sm:px-1.5 text-[11px] border-transparent focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
        props.className,
      )}
    />
  );
}

function RefText({ conclusion, muted = false }: { conclusion: Pick<DreamConclusionRef, "content">; muted?: boolean }) {
  return conclusion.content ? (
    <span className={cn("block text-xs break-words leading-relaxed max-w-[75ch]", muted ? "text-text-muted" : "text-text-primary")}>
      <Markdown inline text={conclusion.content} />
    </span>
  ) : (
    <span className="block text-[11px] text-text-muted">Text unavailable: deleted since, or removed by a dream that is past the retention window.</span>
  );
}

function changeKey(change: DreamChange): string {
  return change.kind === "added" ? `a:${change.item.conclusion.id}` : change.kind === "rewritten" ? `r:${change.replacedBy}` : `f:${change.removed.id}`;
}

/** The ids a change stands for, so a conclusion followed from another run can be found in it. */
function changeIds(change: DreamChange): string[] {
  if (change.kind === "added") return [change.item.conclusion.id];
  if (change.kind === "forgotten") return [change.removed.id];
  return [change.replacedBy, ...change.removed.map((removed) => removed.id)];
}

/** One kind of change under its own heading. New conclusions fold after a few, so losses and rewrites stay in view. */
function ChangeGroup({ kind, changes, focusId, ...props }: {
  kind: ChangeKind;
  changes: DreamChange[];
  runId: string;
  canInspect: boolean;
  onOpenRun: OnOpenRun;
  onInspect: (id: string) => void;
  focusId?: string;
}) {
  const headingId = useId();
  const listId = useId();
  const focusedAt = focusId ? changes.findIndex((change) => changeIds(change).includes(focusId)) : -1;
  const [expanded, setExpanded] = useState(focusedAt >= ADDED_SHOWN);
  // Folding one line away saves nothing.
  const foldable = kind === "added" && changes.length > ADDED_SHOWN + 1;
  const shown = foldable && !expanded ? changes.slice(0, ADDED_SHOWN) : changes;
  const copy = GROUP_COPY[kind];
  return (
    <div className="space-y-1">
      <h5 id={headingId} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
        <span className={cn("font-medium uppercase tracking-wider", kind === "forgotten" ? "text-red-400" : "text-text-primary")}>
          {copy.label} · <span className="tabular-nums">{changes.length.toLocaleString()}</span>
        </span>
        <span className="text-text-muted">{copy.hint}</span>
      </h5>
      <ul id={listId} aria-labelledby={headingId} className="divide-y divide-border border-y border-border">
        {shown.map((change) => (
          <ChangeLine key={changeKey(change)} change={change} focused={!!focusId && changeIds(change).includes(focusId)} {...props} />
        ))}
      </ul>
      {foldable ? (
        <QuietButton
          icon={expanded ? "chevron-up" : "chevron-down"}
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "SHOW_FEWER" : `SHOW_ALL_ADDED · ${changes.length.toLocaleString()}`}
        </QuietButton>
      ) : null}
    </div>
  );
}

function ChangeLine({ change, runId, canInspect, onOpenRun, onInspect, focused }: {
  change: DreamChange;
  runId: string;
  canInspect: boolean;
  onOpenRun: OnOpenRun;
  onInspect: (id: string) => void;
  focused: boolean;
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const sourcesId = useId();
  const lineRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (focused) lineRef.current?.scrollIntoView({ block: "center" });
  }, [focused]);
  const created: DreamCreatedConclusion | null = change.kind === "added" ? change.item : change.kind === "rewritten" ? change.replacement : null;
  const removed = change.kind === "forgotten" ? change.removed : change.kind === "rewritten" ? change.removed[0] : undefined;
  const level = created?.conclusion.level ?? removed?.level ?? null;
  // Who made the change: the specialist that wrote a new conclusion, or the one that removed an old one.
  const specialist = unusualSpecialist(level, created?.specialist ?? removed?.specialist);
  const c = created?.conclusion;

  return (
    <li
      ref={lineRef}
      data-focused={focused || undefined}
      className={cn("grid grid-cols-[12px_14px_minmax(0,1fr)] gap-x-2 py-2 min-w-0", focused && "bg-accent/10 outline outline-1 -outline-offset-1 outline-accent/50")}
    >
      <Marker kind={change.kind} />
      <LevelIcon level={level} />
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="min-w-0 flex-1 basis-[36ch]">
            {c ? (
              <RefText conclusion={c} />
            ) : change.kind === "forgotten" ? (
              <RefText conclusion={change.removed} />
            ) : change.kind === "rewritten" ? (
              <span className="block text-[11px] text-text-primary">
                Replaced by a conclusion written outside this dream
                <span className="font-mono text-text-muted"> {change.replacedBy}</span>.
              </span>
            ) : null}
            {/* The old text sits right under the new, so a rewrite reads as one change. */}
            {change.kind === "rewritten"
              ? change.removed.map((old) => (
                <div key={old.id} className="mt-1 grid grid-cols-[28px_minmax(0,1fr)] gap-x-2" title={old.id}>
                  <span className="text-[11px] text-text-muted leading-5">was</span>
                  <RefText conclusion={old} muted />
                </div>
              ))
              : null}
          </div>
          <div className="flex flex-wrap items-center gap-1 shrink-0">
            {specialist ? <span className="text-[11px] text-text-muted" title="The dream specialist that made this change">by {specialist}</span> : null}
            {c ? <RefStatus conclusion={c} runId={runId} onOpenRun={onOpenRun} /> : null}
            {created?.sources.length ? (
              <QuietButton
                icon={sourcesOpen ? "chevron-up" : "chevron-down"}
                aria-expanded={sourcesOpen}
                aria-controls={sourcesOpen ? sourcesId : undefined}
                onClick={() => setSourcesOpen((v) => !v)}
              >
                {`SOURCES · ${created.sources.length}`}
              </QuietButton>
            ) : null}
            {canInspect && c?.status === "current" ? (
              <QuietButton onClick={() => onInspect(c.id)} aria-label={`Inspect conclusion ${c.id}`} title={c.id}>INSPECT</QuietButton>
            ) : null}
            {canInspect && change.kind === "rewritten" && !c ? (
              <QuietButton onClick={() => onInspect(change.replacedBy)} aria-label={`Inspect conclusion ${change.replacedBy}`} title={change.replacedBy}>INSPECT</QuietButton>
            ) : null}
          </div>
        </div>
        {sourcesOpen && created ? (
          <ul id={sourcesId} className="mt-1 space-y-1.5 border-l border-border-light pl-3">
            <li className="text-[11px] text-text-muted">
              {created.conclusion.level === "inductive" ? "Evidence this pattern was drawn from." : "Premises this conclusion was deduced from."}
            </li>
            {created.sources.map((source) => (
              <li key={source.id} className="grid grid-cols-[14px_minmax(0,1fr)] gap-x-2 min-w-0">
                <LevelIcon level={source.level} />
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 min-w-0">
                  <div className="min-w-0 flex-1 basis-[32ch]"><RefText conclusion={source} /></div>
                  <div className="flex flex-wrap items-center gap-1 shrink-0">
                    <RefStatus conclusion={source} runId={runId} onOpenRun={onOpenRun} />
                    {canInspect && source.status === "current" ? (
                      <QuietButton onClick={() => onInspect(source.id)} aria-label={`Inspect conclusion ${source.id}`} title={source.id}>INSPECT</QuietButton>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

// --- Peer card ----------------------------------------------------------------

function CardSummary({ change }: { change: DreamPeerCardChange }) {
  const before = change.before;
  return (
    <span className="text-text-muted tabular-nums">
      {before ? `${before.length.toLocaleString()} lines before` : "no card before"} · {change.after.length.toLocaleString()} after
    </span>
  );
}

/** Card lines in the same risk order as conclusions: lost, changed, then new. */
function PeerCardChange({ change }: { change: DreamPeerCardChange }) {
  const [showKept, setShowKept] = useState(false);
  const diff = peerCardChanges(change);
  if (!diff.changed.length && !diff.added.length && !diff.removed.length) {
    return <p className="text-[11px] text-text-primary">The card was rewritten with the same {diff.kept.length.toLocaleString()} lines.</p>;
  }
  return (
    <div className="space-y-1.5 max-w-[100ch]">
      <ul className="space-y-1">
        {diff.removed.map((line, i) => <CardLine key={`r:${i}:${line}`} kind="forgotten" line={line} />)}
        {diff.changed.map(({ before, after }) => (
          <li key={`c:${before}`} className="grid grid-cols-[12px_minmax(0,1fr)] gap-x-2">
            <Marker kind="rewritten" />
            <div className="min-w-0">
              <span className="block text-[11px] text-text-primary break-words leading-5"><Markdown inline text={after} /></span>
              <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-2">
                <span className="text-[11px] text-text-muted leading-5">was</span>
                <span className="block text-[11px] text-text-muted break-words leading-5"><Markdown inline text={before} /></span>
              </div>
            </div>
          </li>
        ))}
        {diff.added.map((line, i) => <CardLine key={`a:${i}:${line}`} kind="added" line={line} />)}
      </ul>
      {diff.kept.length ? (
        <div>
          <QuietButton icon={showKept ? "chevron-up" : "chevron-down"} aria-expanded={showKept} onClick={() => setShowKept((v) => !v)}>
            {`UNCHANGED · ${diff.kept.length}`}
          </QuietButton>
          {showKept ? (
            <ul className="mt-1 space-y-1">
              {diff.kept.map((line, i) => (
                <li key={`k:${i}:${line}`} className="grid grid-cols-[12px_minmax(0,1fr)] gap-x-2">
                  <span aria-hidden />
                  <span className="block text-[11px] text-text-muted break-words leading-5"><Markdown inline text={line} /></span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CardLine({ kind, line }: { kind: "added" | "forgotten"; line: string }) {
  return (
    <li className="grid grid-cols-[12px_minmax(0,1fr)] gap-x-2">
      <Marker kind={kind} />
      <span className="block text-[11px] text-text-primary break-words leading-5"><Markdown inline text={line} /></span>
    </li>
  );
}

// --- A run opened on its own ------------------------------------------------------

/** A run opened from a link or from another run's reference. BACK walks the trail. */
function DreamRunModal({ start, workspaceId, timing, canInspect, onInspect, onClose }: {
  start: OpenRun;
  workspaceId: string;
  timing: RunTiming;
  canInspect: boolean;
  onInspect: (id: string) => void;
  onClose: () => void;
}) {
  const [trail, setTrail] = useState<OpenRun[]>([start]);
  const current = trail.at(-1)!;
  const open: OnOpenRun = (runId, focusId) =>
    setTrail((old) => {
      const at = old.findIndex((entry) => entry.runId === runId);
      return at >= 0 ? [...old.slice(0, at), { runId, focusId }] : [...old.slice(-19), { runId, focusId }];
    });
  return (
    <Modal title="DREAM_RUN" open onClose={onClose} className="max-w-3xl"
      footer={<Button variant="secondary" onClick={onClose}>CLOSE</Button>}>
      <div className="max-h-[65vh] overflow-y-auto space-y-3 pr-1" role="region" aria-label="Dream run">
        {trail.length > 1 ? (
          <Button size="sm" variant="ghost" icon="chevron-right" className="[&_svg]:rotate-180" onClick={() => setTrail((old) => old.slice(0, -1))}>BACK</Button>
        ) : null}
        {current.focusId ? (
          <p className="text-[11px] text-text-muted">
            Opened from conclusion <span className="font-mono text-text-primary">{current.focusId}</span>, marked below.
          </p>
        ) : null}
        <ModalRun
          key={`${current.runId}/${current.focusId ?? ""}`}
          runId={current.runId}
          focusId={current.focusId}
          workspaceId={workspaceId}
          timing={timing}
          canInspect={canInspect}
          onOpenRun={open}
          onInspect={onInspect}
        />
      </div>
    </Modal>
  );
}

function ModalRun({ runId, focusId, workspaceId, timing, canInspect, onOpenRun, onInspect }: {
  runId: string;
  focusId?: string;
  workspaceId: string;
  timing: RunTiming;
  canInspect: boolean;
  onOpenRun: OnOpenRun;
  onInspect: (id: string) => void;
}) {
  const { dreamHistory } = useHonchoCapabilities();
  const detail = useHonchoQuery<DreamRunDetail>(
    `dreams/${workspaceId}/run/${runId}`,
    (o) => getDreamRun(getSdk(o, workspaceId), runId, dreamHistory),
    { refreshInterval: (data) => (data && runIsActive(data) ? (runLooksStuck(data, timing.now, timing.stuckAfter) ? 60_000 : 5_000) : undefined) },
  );
  return <RunBody detail={detail} timing={timing} canInspect={canInspect} onOpenRun={onOpenRun} onInspect={onInspect} showHeader focusId={focusId} />;
}
