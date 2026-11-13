"use client";

import { useHonchoCapabilities } from "./useCapabilities";
import { formatListTotal, formatPageCount, totalIsLowerBound, totalsMayBeCapped } from "./listTotals";

/** Format and test REST list totals for the active server (see `listTotals.ts`). */
export function useListTotal() {
  const capped = totalsMayBeCapped(useHonchoCapabilities().cappedListTotals);
  return {
    format: (total: number) => formatListTotal(total, capped),
    isLowerBound: (total: number) => totalIsLowerBound(total, capped),
    pages: (page: number, pages: number, total: number) => formatPageCount(page, pages, total, capped),
  };
}
