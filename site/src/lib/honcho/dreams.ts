import type {
  DreamConclusionRef,
  DreamCreatedConclusion,
  DreamPeerCardChange,
  DreamRemovedConclusion,
  DreamRun,
  DreamRunDetail,
  Honcho,
} from "@honcho-ai/sdk";
import type { HonchoCapabilityState } from "./capabilities.ts";

/**
 * Honcho 3.6 Representation History (#1542). Each dream is recorded as a run:
 * the conclusions it created (with the conclusions each came from), the ones
 * it removed as they read when removed, and the peer card before and after.
 * Runs are read through `POST /dreams/list` and `GET /dreams/{run_id}`, which
 * only read. Workspace and admin keys only.
 *
 * Past the server's retention window (`DREAM_HISTORY_RETENTION_DAYS`, 30 days
 * by default) a run keeps only the created conclusions that still exist and
 * gets `pruned_at`; its counts stay as recorded. Recording can be off
 * (`DREAM_HISTORY_ENABLED=false`), so an empty history is not an error.
 */

export type { DreamConclusionRef, DreamCreatedConclusion, DreamPeerCardChange, DreamRemovedConclusion, DreamRun, DreamRunDetail };

export const DREAM_PAGE_SIZE = 20;

/** Triage views over the loaded runs, kept in the link as `show=`. */
export const DREAM_SHOWS = ["failed", "stuck", "forgotten", "card", "new"] as const;
export type DreamShow = (typeof DREAM_SHOWS)[number];

export interface DreamFilters {
  /** Runs about this peer. `#/dreams?peer=` is an alias, as the Peers page links it. */
  observed: string | null;
  /** Runs from this observer's perspective. */
  observer: string | null;
  /** Client-side triage over the loaded page; present only when set. */
  show?: DreamShow | null;
}

export interface DreamPage {
  items: DreamRun[];
  total: number;
  page: number;
  pages: number;
}

function param(query: URLSearchParams, key: string): string | null {
  const value = query.get(key)?.trim();
  return value ? value : null;
}

export function readDreamsHash(hash: string): DreamFilters {
  const query = new URLSearchParams(hash.split("?")[1] ?? "");
  const show = param(query, "show");
  return {
    observed: param(query, "observed") ?? param(query, "peer"),
    observer: param(query, "observer"),
    ...(show && (DREAM_SHOWS as readonly string[]).includes(show) ? { show: show as DreamShow } : {}),
  };
}

/** The run a `#/dreams?run=<id>` link opens. */
export function readLinkedRun(hash: string): string | null {
  return param(new URLSearchParams(hash.split("?")[1] ?? ""), "run");
}

/** Filters only: setting a filter closes a linked run. */
export function dreamsHash(filters: DreamFilters): string {
  const query = new URLSearchParams();
  if (filters.observed) query.set("observed", filters.observed);
  if (filters.observer) query.set("observer", filters.observer);
  if (filters.show) query.set("show", filters.show);
  const text = query.toString();
  return text ? `#/dreams?${text}` : "#/dreams";
}

export function dreamRunHash(runId: string): string {
  return `#/dreams?${new URLSearchParams({ run: runId }).toString()}`;
}

function requireDreamHistory(state: HonchoCapabilityState) {
  if (state !== "available") throw new Error("Representation History requires a Honcho 3.6+ server");
}

/** One page of runs, newest first. Only the filters that are set are sent. */
export async function listDreamRuns(
  sdk: Honcho,
  filters: DreamFilters,
  page: number,
  state: HonchoCapabilityState,
): Promise<DreamPage> {
  requireDreamHistory(state);
  const result = await sdk.dreams({
    ...(filters.observed ? { observed: filters.observed } : {}),
    ...(filters.observer ? { observer: filters.observer } : {}),
    page,
    size: DREAM_PAGE_SIZE,
  });
  return { items: result.items, total: result.total, page: result.page, pages: result.pages };
}

export async function getDreamRun(sdk: Honcho, runId: string, state: HonchoCapabilityState): Promise<DreamRunDetail> {
  requireDreamHistory(state);
  return normalizeRunDetail(await sdk.getDream(runId));
}

/** The schema requires `created` and `removed`; keep a malformed reply from breaking the page. */
export function normalizeRunDetail(run: DreamRunDetail): DreamRunDetail {
  return {
    ...run,
    created: Array.isArray(run.created) ? run.created.map((item) => ({ ...item, sources: Array.isArray(item.sources) ? item.sources : [] })) : [],
    removed: Array.isArray(run.removed) ? run.removed : [],
    peer_card: run.peer_card ?? null,
  };
}

export function runDurationMs(run: Pick<DreamRun, "started_at" | "finished_at">): number | null {
  if (!run.finished_at) return null;
  const ms = Date.parse(run.finished_at) - Date.parse(run.started_at);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/**
 * Lines the card gained, lost and kept. Compared as multisets so a repeated
 * line counts once per copy; order follows the card each line comes from.
 */
export function peerCardDiff(change: DreamPeerCardChange): { added: string[]; removed: string[]; kept: string[]; hadCard: boolean } {
  const before = change.before ?? [];
  const after = change.after ?? [];
  const remaining = new Map<string, number>();
  for (const line of after) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  const removed: string[] = [];
  const kept: string[] = [];
  for (const line of before) {
    const left = remaining.get(line) ?? 0;
    if (left > 0) {
      remaining.set(line, left - 1);
      kept.push(line);
    } else {
      removed.push(line);
    }
  }
  const added: string[] = [];
  for (const line of after) {
    const left = remaining.get(line) ?? 0;
    if (left > 0) {
      remaining.set(line, left - 1);
      added.push(line);
    }
  }
  return { added, removed, kept, hadCard: change.before !== null };
}

/** The conclusion from the same run that replaced a removed near-duplicate. */
export function replacementFor(run: Pick<DreamRunDetail, "created">, removed: DreamRemovedConclusion): DreamCreatedConclusion | null {
  if (!removed.replaced_by) return null;
  return run.created.find((item) => item.conclusion.id === removed.replaced_by) ?? null;
}

/**
 * Created conclusions the run recorded but no longer lists: retention keeps
 * only the ones that still exist, and a conclusion deleted through the API
 * reads as `unavailable` instead of disappearing.
 */
export function missingCreated(run: Pick<DreamRunDetail, "created_count" | "created">): number {
  return Math.max(0, run.created_count - run.created.length);
}

export function refStatusLabel(ref: Pick<DreamConclusionRef, "status">): string {
  return ref.status === "current" ? "CURRENT" : ref.status === "removed" ? "REMOVED" : "UNAVAILABLE";
}

export function runIsActive(run: Pick<DreamRun, "status">): boolean {
  return run.status === "running";
}

// --- Reading a run as a diff ------------------------------------------------

/**
 * One line of a run's diff. A removed conclusion with `replaced_by` was
 * rewritten: the dreamer swapped it for a near-duplicate. One without it was
 * forgotten. Removed conclusions sharing a replacement fold into one entry.
 */
export type DreamChange =
  | { kind: "rewritten"; replacedBy: string; replacement: DreamCreatedConclusion | null; removed: DreamRemovedConclusion[] }
  | { kind: "added"; item: DreamCreatedConclusion }
  | { kind: "forgotten"; removed: DreamRemovedConclusion };

/**
 * In risk order: what was forgotten, then rewrites, then new conclusions,
 * each in recorded order. A loss is the change an operator most needs to see.
 */
export function runChanges(run: Pick<DreamRunDetail, "created" | "removed">): DreamChange[] {
  const rewrites = new Map<string, Extract<DreamChange, { kind: "rewritten" }>>();
  const forgotten: DreamChange[] = [];
  for (const removed of run.removed) {
    if (!removed.replaced_by) {
      forgotten.push({ kind: "forgotten", removed });
      continue;
    }
    const entry = rewrites.get(removed.replaced_by);
    if (entry) entry.removed.push(removed);
    else rewrites.set(removed.replaced_by, { kind: "rewritten", replacedBy: removed.replaced_by, replacement: replacementFor(run, removed), removed: [removed] });
  }
  const added: DreamChange[] = run.created
    .filter((item) => !rewrites.has(item.conclusion.id))
    .map((item) => ({ kind: "added", item }));
  return [...forgotten, ...rewrites.values(), ...added];
}

/** The specialist each level normally comes from; anything else is worth naming. */
const USUAL_SPECIALIST: Record<string, string> = { deductive: "deduction", inductive: "induction" };

export function unusualSpecialist(level: string | null | undefined, specialist: string | null | undefined): string | null {
  if (!specialist) return null;
  return level && USUAL_SPECIALIST[level] === specialist ? null : specialist;
}

export interface DreamChangeCounts {
  /** New conclusions: created ones that replaced nothing in this run. */
  added: number;
  /** Removed conclusions a near-duplicate replaced. */
  rewritten: number;
  /** Removed conclusions nothing replaced. */
  forgotten: number;
}

/**
 * Counts from a run's detail, or null when the detail cannot split removals:
 * a pruned run lost what it removed. `added` counts against `created_count`,
 * so conclusions deleted since still count; a deleted replacement counts as
 * added.
 */
export function changeCounts(run: Pick<DreamRunDetail, "created" | "removed" | "created_count" | "removed_count" | "pruned_at">): DreamChangeCounts | null {
  if (run.pruned_at || run.removed.length !== run.removed_count) return null;
  const createdIds = new Set(run.created.map((item) => item.conclusion.id));
  const replacementsHere = new Set(run.removed.flatMap((item) => (item.replaced_by && createdIds.has(item.replaced_by) ? [item.replaced_by] : [])));
  const rewritten = run.removed.filter((item) => item.replaced_by).length;
  return { added: Math.max(0, run.created_count - replacementsHere.size), rewritten, forgotten: run.removed.length - rewritten };
}

// --- Peer card --------------------------------------------------------------

/** `ATTRIBUTE: Billing day: 15th` → `ATTRIBUTE: Billing day`; null for a line without a key. */
export function cardLineKey(line: string): string | null {
  const match = line.match(/^\s*([^:\n]+:[^:\n]+):\s*\S/);
  return match ? match[1].trim() : null;
}

export interface CardLineChange {
  before: string;
  after: string;
}

/**
 * peerCardDiff, with a dropped and an added line paired as one change when
 * they share a key that appears once on each side (`Billing day: 3rd` →
 * `Billing day: 15th`). A key repeated on either side stays unpaired, since
 * which value replaced which is unknown.
 */
export function peerCardChanges(change: DreamPeerCardChange) {
  const diff = peerCardDiff(change);
  const once = (lines: string[]) => {
    const seen = new Map<string, number>();
    for (const line of lines) {
      const key = cardLineKey(line);
      if (key) seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return seen;
  };
  const droppedKeys = once(diff.removed);
  const addedKeys = once(diff.added);
  const changed: CardLineChange[] = [];
  const pairedAdded = new Set<string>();
  const removed: string[] = [];
  for (const line of diff.removed) {
    const key = cardLineKey(line);
    const after = key && droppedKeys.get(key) === 1 && addedKeys.get(key) === 1 ? diff.added.find((a) => cardLineKey(a) === key) : undefined;
    if (after !== undefined) {
      changed.push({ before: line, after });
      pairedAdded.add(after);
    } else {
      removed.push(line);
    }
  }
  return { changed, added: diff.added.filter((line) => !pairedAdded.has(line)), removed, kept: diff.kept, hadCard: diff.hadCard };
}

// --- Grouping and labels ----------------------------------------------------

/** Runs starting within this gap of each other were most likely queued by one pass. */
export const DREAM_GROUP_GAP_MS = 2 * 60_000;

export interface DreamRunGroup {
  key: string;
  /** Start of the earliest run in the group. */
  startedAt: string;
  runs: DreamRun[];
}

/**
 * Consecutive runs (newest first) whose starts fall within `gapMs` of the
 * previous run join one group. Honcho records no cycle id, so this groups by
 * start time only and never claims more.
 */
export function groupRunsByStart(runs: DreamRun[], gapMs = DREAM_GROUP_GAP_MS): DreamRunGroup[] {
  const groups: DreamRunGroup[] = [];
  let last: number | null = null;
  for (const run of runs) {
    const at = Date.parse(run.started_at);
    const current = groups.at(-1);
    if (current && last !== null && Number.isFinite(at) && Math.abs(last - at) <= gapMs) {
      current.runs.push(run);
      current.startedAt = run.started_at;
    } else {
      groups.push({ key: run.id, startedAt: run.started_at, runs: [run] });
    }
    last = Number.isFinite(at) ? at : null;
  }
  return groups;
}

const TRIGGERS: Record<string, string> = {
  document_threshold: "auto",
  manual: "scheduled",
};

/** Honcho's trigger_reason in words; unknown values pass through readably. */
export function triggerLabel(trigger: string | null | undefined): string | null {
  if (!trigger) return null;
  return TRIGGERS[trigger] ?? trigger.replaceAll("_", " ");
}

// --- Runs that never finish ---------------------------------------------------

export const STUCK_FLOOR_MS = 30 * 60_000;
export const STUCK_CEILING_MS = 6 * 3_600_000;

/**
 * How long a run may stay running before it reads as stuck: three times the
 * longest finished run in view, between 30 minutes and 6 hours. The ceiling
 * keeps one bad finish time from hiding a stuck run. A deriver that dies
 * mid-dream leaves its run `running` with no finish time forever.
 */
export function stuckAfterMs(runs: Pick<DreamRun, "started_at" | "finished_at">[]): number {
  const longest = Math.max(0, ...runs.map((run) => runDurationMs(run) ?? 0));
  return Math.min(STUCK_CEILING_MS, Math.max(STUCK_FLOOR_MS, longest * 3));
}

export function runLooksStuck(run: Pick<DreamRun, "status" | "started_at">, now: number, afterMs: number): boolean {
  if (!runIsActive(run)) return false;
  const started = Date.parse(run.started_at);
  return Number.isFinite(started) && now - started > afterMs;
}

export function runElapsedMs(run: Pick<DreamRun, "started_at">, now: number): number | null {
  const started = Date.parse(run.started_at);
  return Number.isFinite(started) ? Math.max(0, now - started) : null;
}

/** Elapsed time in the largest sensible unit: 45 s, 6 min, 21 h, 3 d. */
export function formatElapsed(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} h`;
  return `${Math.round(ms / 86_400_000)} d`;
}

/** Poll fast while a run is live, slowly while only stuck runs are open, otherwise rarely. */
export function dreamRefreshMs(runs: Pick<DreamRun, "status" | "started_at">[], now: number, afterMs: number): number {
  const active = runs.filter(runIsActive);
  if (active.some((run) => !runLooksStuck(run, now, afterMs))) return 5_000;
  return active.length ? 60_000 : 30_000;
}

// --- Triage -------------------------------------------------------------------

export interface DreamRunFlags {
  failed: boolean;
  stuck: boolean;
  forgotten: boolean;
  card: boolean;
  new: boolean;
}

/**
 * What a run needs attention for. `forgotten` is only known once its removals
 * are split (`counts`); a run started after `seenBefore` is new.
 */
export function runFlags(
  run: Pick<DreamRun, "status" | "started_at" | "peer_card_updated">,
  counts: DreamChangeCounts | null,
  now: number,
  afterMs: number,
  seenBefore: number | null,
): DreamRunFlags {
  const started = Date.parse(run.started_at);
  return {
    failed: run.status === "failed" || run.status === "interrupted",
    stuck: runLooksStuck(run, now, afterMs),
    forgotten: (counts?.forgotten ?? 0) > 0,
    card: run.peer_card_updated,
    new: seenBefore !== null && Number.isFinite(started) && started > seenBefore,
  };
}

export interface DreamSummary {
  runs: number;
  failed: number;
  stuck: number;
  running: number;
  /** Forgotten conclusions across runs whose removals are split. */
  forgotten: number;
  /** Runs with removals not split yet (loading) or ever (pruned, still running). */
  unsplit: number;
  cards: number;
  new: number;
}

export function summarizeRuns(
  runs: Pick<DreamRun, "status" | "started_at" | "peer_card_updated" | "removed_count">[],
  countsOf: (index: number) => DreamChangeCounts | null,
  now: number,
  afterMs: number,
  seenBefore: number | null,
): DreamSummary {
  const summary: DreamSummary = { runs: runs.length, failed: 0, stuck: 0, running: 0, forgotten: 0, unsplit: 0, cards: 0, new: 0 };
  runs.forEach((run, i) => {
    const counts = countsOf(i);
    const flags = runFlags(run, counts, now, afterMs, seenBefore);
    if (flags.failed) summary.failed++;
    if (flags.stuck) summary.stuck++;
    else if (runIsActive(run)) summary.running++;
    if (counts) summary.forgotten += counts.forgotten;
    else if (run.removed_count > 0) summary.unsplit++;
    if (flags.card) summary.cards++;
    if (flags.new) summary.new++;
  });
  return summary;
}
