import type { Honcho, Session } from "@honcho-ai/sdk";

export const SESSION_LIST_PAGE_SIZE = 100;

/**
 * List every active session in a workspace.
 *
 * Honcho caps a sessions response at 100 items. The SDK's Page.toArray()
 * follows the page metadata and preserves the original filters and ordering
 * for every subsequent request, so client-side search and sorting can operate
 * on the complete workspace rather than only the first response page.
 */
export async function listAllSessions(
  client: Pick<Honcho, "sessions">,
  { includeScopes = false }: { includeScopes?: boolean } = {},
): Promise<Session[]> {
  // `includeScopes` (Honcho 3.5+) sets each session's `scopes` in one query per
  // page. Older servers ignore unknown query params, but the dashboard only
  // asks when the server is known to answer.
  const firstPage = await client.sessions({
    size: SESSION_LIST_PAGE_SIZE,
    reverse: true,
    ...(includeScopes ? { includeScopes: true } : {}),
  });
  return firstPage.toArray();
}
