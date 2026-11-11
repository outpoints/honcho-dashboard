/**
 * Conclusions tied to one session, for cleanup.
 *
 * `conclusions/list` filters by `session_id`, which finds what Honcho filed
 * under the session. Dreams derive conclusions from those and file them under
 * the session holding the newest premise, or none, so a session's influence
 * can sit outside its own list. `findDerivedElsewhere` finds the first level of
 * those through `source_ids` (Honcho 3.2+): conclusions citing one of the
 * session's conclusions as a premise but filed somewhere else. It never walks
 * further down the tree.
 */
import type { ApiConclusion, Page } from "./types.ts";

export type ConclusionLister = (params: { page: number; size: number; filters: Record<string, unknown> }) => Promise<Page<ApiConclusion>>;

/** Upper bound on conclusions read for one session or one derived search. */
export const SESSION_SCAN_LIMIT = 2000;
const PAGE_SIZE = 100;
/** Premise IDs per `source_ids: {in: [...]}` request. */
export const PREMISE_BATCH = 100;

/** `#/conclusions?session=<id>` */
export function readConclusionsHash(hash: string): { session: string | null } {
  const session = new URLSearchParams(hash.split("?")[1] ?? "").get("session");
  return { session: session ? session : null };
}

export function conclusionsHash(session: string | null): string {
  return session ? `#/conclusions?session=${encodeURIComponent(session)}` : "#/conclusions";
}

/**
 * Add a session to a source filter (see `conclusionSourceFilter`): undefined
 * means no filter and null an empty selection, and both are preserved.
 */
export function withSessionFilter(
  source: Record<string, unknown> | undefined | null,
  session: string | null,
): Record<string, unknown> | undefined | null {
  if (source === null || !session) return source;
  return source ? { AND: [source, { session_id: session }] } : { session_id: session };
}

/** Read every page of a filtered list, up to `limit` items. */
export async function listAllConclusions(
  list: ConclusionLister,
  filters: Record<string, unknown>,
  limit = SESSION_SCAN_LIMIT,
): Promise<{ items: ApiConclusion[]; truncated: boolean }> {
  const items: ApiConclusion[] = [];
  let page = 1;
  let pages = 1;
  while (page <= pages && items.length < limit) {
    const result = await list({ page, size: PAGE_SIZE, filters });
    items.push(...(result.items ?? []));
    pages = Math.max(1, result.pages ?? 1);
    page += 1;
    if (!result.items?.length) break;
  }
  return { items: items.slice(0, limit), truncated: items.length > limit || page <= pages };
}

export interface DerivedElsewhere {
  conclusion: ApiConclusion;
  /** How many of the session's conclusions it cites. */
  cites: number;
}

export async function findDerivedElsewhere(
  list: ConclusionLister,
  sessionId: string,
  { limit = SESSION_SCAN_LIMIT }: { limit?: number } = {},
): Promise<{ items: DerivedElsewhere[]; scanned: number; truncated: boolean }> {
  const own = await listAllConclusions(list, { session_id: sessionId }, limit);
  const ids = own.items.map((item) => item.id);
  const ownIds = new Set(ids);
  const found = new Map<string, ApiConclusion>();
  let truncated = own.truncated;
  // An empty `in` matches everything on Honcho 3.2-3.4, so never send one.
  for (let start = 0; start < ids.length && found.size < limit; start += PREMISE_BATCH) {
    const batch = ids.slice(start, start + PREMISE_BATCH);
    const derived = await listAllConclusions(list, { source_ids: { in: batch } }, limit);
    if (derived.truncated) truncated = true;
    for (const item of derived.items) {
      if (item.session_id !== sessionId && !ownIds.has(item.id)) found.set(item.id, item);
    }
  }
  if (found.size >= limit) truncated = true;
  const items = [...found.values()]
    .slice(0, limit)
    .map((conclusion) => ({ conclusion, cites: (conclusion.source_ids ?? []).filter((id) => ownIds.has(id)).length }));
  return { items, scanned: ids.length, truncated };
}

export type DeleteOutcome = "deleted" | "gone" | "failed";

/**
 * Delete one by one, in order, reporting progress. A 404 means another tab or
 * process already removed it. Never retries.
 */
export async function deleteConclusions(
  items: ApiConclusion[],
  remove: (id: string) => Promise<unknown>,
  onProgress?: (done: number, total: number) => void,
): Promise<{ deleted: ApiConclusion[]; gone: string[]; failed: { id: string; error: string }[] }> {
  const deleted: ApiConclusion[] = [];
  const gone: string[] = [];
  const failed: { id: string; error: string }[] = [];
  let done = 0;
  for (const item of items) {
    try {
      await remove(item.id);
      deleted.push(item);
    } catch (error) {
      const status = (error as { status?: unknown } | null)?.status;
      if (status === 404) gone.push(item.id);
      else failed.push({ id: item.id, error: error instanceof Error ? error.message : String(error) });
    }
    done += 1;
    onProgress?.(done, items.length);
  }
  return { deleted, gone, failed };
}
