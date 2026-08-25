export type SearchOrder = "relevance" | "newest" | "oldest";

interface SearchResultWithDate {
  created_at: string;
}

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Preserve Honcho's native ranking or apply a stable chronological order to
 * the result window returned by Honcho. Invalid timestamps always sort last.
 */
export function orderSearchResults<T extends SearchResultWithDate>(
  items: readonly T[],
  order: SearchOrder,
): T[] {
  if (order === "relevance") return [...items];

  return items
    .map((item, index) => ({ item, index, timestamp: timestamp(item.created_at) }))
    .sort((a, b) => {
      if (a.timestamp === null && b.timestamp === null) return a.index - b.index;
      if (a.timestamp === null) return 1;
      if (b.timestamp === null) return -1;

      const byDate = order === "newest" ? b.timestamp - a.timestamp : a.timestamp - b.timestamp;
      return byDate || a.index - b.index;
    })
    .map(({ item }) => item);
}
