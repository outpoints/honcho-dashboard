/**
 * Scope copies in workspace-wide conclusion lists.
 *
 * When a session joins a named scope (Honcho 3.1+), Honcho copies the
 * session's conclusions into that scope's own collection so scoped recall has
 * evidence. The copies are real records whose observer is the internal peer
 * `scope.<name>`. Listed next to peer memory they look like duplicates, so the
 * dashboard labels them and can filter by source on the server (keeping
 * pagination and totals honest).
 */
export const SCOPE_OBSERVER_PREFIX = "scope.";

export type ConclusionSource = "all" | "peers" | "scopes";

/** The scope name for a scope-projection observer, or null for a normal peer. */
export function scopeOfObserver(observerId: string | null | undefined): string | null {
  if (!observerId || !observerId.startsWith(SCOPE_OBSERVER_PREFIX)) return null;
  const name = observerId.slice(SCOPE_OBSERVER_PREFIX.length);
  return name ? name : null;
}

/**
 * Server-side `filters` for a source. `undefined` means no filter; `null`
 * means the selection is provably empty, so no request is needed.
 */
export function conclusionSourceFilter(
  source: ConclusionSource,
  scopeIds: string[],
): Record<string, unknown> | undefined | null {
  if (source === "all") return undefined;
  const observers = [...new Set(scopeIds)].map((id) => `${SCOPE_OBSERVER_PREFIX}${id}`);
  if (source === "scopes") return observers.length ? { observer_id: { in: observers } } : null;
  return observers.length ? { NOT: [{ observer_id: { in: observers } }] } : undefined;
}
