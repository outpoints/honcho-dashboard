import type { Honcho, Scope, Session } from "@honcho-ai/sdk";

export const SCOPE_LIST_PAGE_SIZE = 100;

/**
 * Collect every scope using the SDK's pagination-aware Page wrapper.
 * `includeSessionCount` (Honcho 3.5+) sets each scope's `sessionCount` in the
 * same query; only pass it when the server is known to support it.
 */
export async function listAllScopes(
  client: Pick<Honcho, "scopes">,
  { includeSessionCount = false }: { includeSessionCount?: boolean } = {},
): Promise<Scope[]> {
  const firstPage = await client.scopes({
    size: SCOPE_LIST_PAGE_SIZE,
    reverse: true,
    ...(includeSessionCount ? { includeSessionCount: true } : {}),
  });
  return firstPage.toArray();
}

/** Honcho's bulk scope add and remove each take at most 100 sessions per call. */
export const SCOPE_BATCH_LIMIT = 100;

export function scopeBatches(ids: string[]): string[][] {
  const unique = [...new Set(ids)];
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += SCOPE_BATCH_LIMIT) batches.push(unique.slice(i, i + SCOPE_BATCH_LIMIT));
  return batches;
}

/** Collect every session currently assigned to a scope. */
export async function listAllScopeSessions(
  scope: Pick<Scope, "sessions">,
): Promise<Session[]> {
  const firstPage = await scope.sessions({ size: SCOPE_LIST_PAGE_SIZE });
  return firstPage.toArray();
}
