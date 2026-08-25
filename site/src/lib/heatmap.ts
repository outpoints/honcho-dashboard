export interface HeatmapCell {
  day: string;
  n: number;
}

export const HEATMAP_WEEKS = 52;
export const HEATMAP_DAYS = HEATMAP_WEEKS * 7;

const DAY_MS = 86_400_000;

/** Build exactly 52 UTC weeks, ending with the current UTC day. */
export function buildHeatmapDays(cells: HeatmapCell[], now = new Date()): HeatmapCell[] {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = end - (HEATMAP_DAYS - 1) * DAY_MS;
  const lookup = new Map(cells.map((cell) => [cell.day, cell.n]));

  return Array.from({ length: HEATMAP_DAYS }, (_, index) => {
    const day = new Date(start + index * DAY_MS).toISOString().slice(0, 10);
    return { day, n: lookup.get(day) ?? 0 };
  });
}
