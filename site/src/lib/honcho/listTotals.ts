/**
 * List totals from Honcho's offset pages. From 3.6.0 (#1500) the server counts
 * a list only up to `PAGINATION_COUNT_LIMIT` (default 100,000) and reports the
 * limit plus one when there are more; on later pages past the limit, `total`
 * is raised just past the current page so `pages` still reaches the end. So a
 * total above the default limit is a lower bound, not a count.
 *
 * The server does not publish its configured limit. Formatting anything above
 * the default limit as "100,000+" stays true for the default and any larger
 * limit. A smaller configured limit shows its limit plus one as an exact
 * number (documented as a known limitation).
 *
 * Only a server known to predate the cap (`unsupported`) keeps exact totals
 * past the limit; an unknown or still-loading version gets the lower bound,
 * which is true on every server.
 */

import type { HonchoCapabilityState } from "./capabilities";

export const DEFAULT_PAGINATION_COUNT_LIMIT = 100_000;

export function totalsMayBeCapped(state: HonchoCapabilityState): boolean {
  return state !== "unsupported";
}

export function totalIsLowerBound(total: number, capped: boolean): boolean {
  return capped && total > DEFAULT_PAGINATION_COUNT_LIMIT;
}

export function formatListTotal(total: number, capped: boolean): string {
  return totalIsLowerBound(total, capped)
    ? `${DEFAULT_PAGINATION_COUNT_LIMIT.toLocaleString()}+`
    : total.toLocaleString();
}

/**
 * `pages` comes from the same total, so it is a lower bound too while a next
 * page exists. On the last page the server's total covers every row walked,
 * so the count is exact there.
 */
export function formatPageCount(page: number, pages: number, total: number, capped: boolean): string {
  return totalIsLowerBound(total, capped) && page < pages ? `${pages.toLocaleString()}+` : pages.toLocaleString();
}
