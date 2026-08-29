import type { Honcho, Scope, Session } from "@honcho-ai/sdk";

export const SCOPE_LIST_PAGE_SIZE = 100;

/** Collect every scope using the SDK's pagination-aware Page wrapper. */
export async function listAllScopes(client: Pick<Honcho, "scopes">): Promise<Scope[]> {
  const firstPage = await client.scopes({
    size: SCOPE_LIST_PAGE_SIZE,
    reverse: true,
  });
  return firstPage.toArray();
}

/** Collect every session currently assigned to a scope. */
export async function listAllScopeSessions(
  scope: Pick<Scope, "sessions">,
): Promise<Session[]> {
  const firstPage = await scope.sessions({ size: SCOPE_LIST_PAGE_SIZE });
  return firstPage.toArray();
}
