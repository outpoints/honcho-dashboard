/**
 * What the dashboard shows about a peer's memory: which conclusions to list,
 * how to filter them through Honcho's list endpoint, and how to fold the same
 * text held by several observers into one row. Pure, so it is tested directly.
 */

export const CONCLUSION_LEVELS = ["inductive", "deductive", "explicit"] as const;
export type ConclusionLevelKey = (typeof CONCLUSION_LEVELS)[number];
export type LevelTab = "all" | ConclusionLevelKey;
/** Whose view: everyone's, the peer's own conclusions about itself, or other peers' conclusions about it. */
export type Perspective = "all" | "own" | "others";

export interface MemoryQuery {
  level: LevelTab;
  perspective: Perspective;
  /** Case-insensitive text match on the conclusion content. */
  text?: string;
  /** ISO timestamp; only conclusions created at or after it. */
  since?: string;
}

/**
 * Filters for `POST /conclusions/list`. Conclusions are stored per
 * (observer → observed) pair; everything here is about `peerId` as the observed peer.
 */
export function conclusionFilters(peerId: string, query: MemoryQuery): Record<string, unknown> {
  const filters: Record<string, unknown> = { observed_id: peerId };
  if (query.level !== "all") filters.level = query.level;
  if (query.perspective === "own") filters.observer_id = peerId;
  if (query.perspective === "others") filters.NOT = [{ observer_id: peerId }];
  const text = query.text?.trim();
  if (text) filters.content = { icontains: text };
  if (query.since) filters.created_at = { gte: query.since };
  return filters;
}

/** Lead with the rarest, most synthesized level that has anything in it. */
export function defaultLevel(counts: Partial<Record<LevelTab, number>>): LevelTab {
  for (const level of ["inductive", "deductive"] as const) {
    if ((counts[level] ?? 0) > 0) return level;
  }
  return "all";
}

export interface MemoryItem {
  id: string;
  content: string;
  observer_id: string;
  observed_id: string;
  level?: string | null;
  times_derived?: number | null;
  source_ids?: string[] | null;
  created_at: string;
}

export interface MemoryRow<T extends MemoryItem = MemoryItem> {
  item: T;
  /** Other observers that hold the same text, in first-seen order. */
  alsoHeldBy: string[];
  /** How many loaded conclusions share this text, including `item`. */
  copies: number;
}

function textKey(content: string): string {
  return content.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Fold conclusions with the same text into one row, keeping the first (newest)
 * as the row and listing the other observers. Order is preserved.
 */
export function foldDuplicates<T extends MemoryItem>(items: T[]): MemoryRow<T>[] {
  const rows: MemoryRow<T>[] = [];
  const byText = new Map<string, MemoryRow<T>>();
  for (const item of items) {
    const key = textKey(item.content);
    const row = byText.get(key);
    if (!row) {
      const created = { item, alsoHeldBy: [], copies: 1 };
      byText.set(key, created);
      rows.push(created);
      continue;
    }
    row.copies += 1;
    if (item.observer_id !== row.item.observer_id && !row.alsoHeldBy.includes(item.observer_id)) {
      row.alsoHeldBy.push(item.observer_id);
    }
  }
  return rows;
}

/** Append a page without repeating IDs already loaded (pages can shift as conclusions arrive). */
export function appendPage<T extends { id: string }>(loaded: T[], page: T[]): T[] {
  const seen = new Set(loaded.map((item) => item.id));
  return [...loaded, ...page.filter((item) => !seen.has(item.id))];
}

/** "2h ago", "3d ago", "May 21" — compact age for list rows. */
export function shortAge(iso: string | null | undefined, now: number): string {
  if (!iso) return "—";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "—";
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: days > 330 ? "numeric" : undefined });
}

/** The peer named by `#/peers?peer=workspace/id`; the workspace keeps ids unique across workspaces. */
export function readSelectedPeer(hash: string): { workspaceId: string; peerId: string } | null {
  const query = hash.split("?")[1] ?? "";
  const value = new URLSearchParams(query).get("peer");
  if (!value) return null;
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return null;
  return { workspaceId: value.slice(0, slash), peerId: value.slice(slash + 1) };
}
