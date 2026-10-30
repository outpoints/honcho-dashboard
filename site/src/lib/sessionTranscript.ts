/**
 * Inline session transcript helpers (Sessions page, expanded row). Pure, so
 * Node tests can cover them.
 *
 * Pages are read newest first (`reverse: true`) and shown that way, so the row
 * opens on the latest turns; each LOAD_MORE fetch appends an older page below.
 * The list keeps the server's own order for messages that share a timestamp
 * instead of re-sorting them.
 */

export const TRANSCRIPT_PAGE = 25;

/** Append an older page to a newest-first list, skipping ids already shown. */
export function appendOlder<T extends { id: string }>(newestFirst: T[], olderPage: T[]): T[] {
  if (olderPage.length === 0) return newestFirst;
  const seen = new Set(newestFirst.map((item) => item.id));
  const fresh = olderPage.filter((item) => !seen.has(item.id));
  return fresh.length ? [...newestFirst, ...fresh] : newestFirst;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Compact local timestamp for a transcript line: time only for today, month and
 * day plus time this year, the full date otherwise. The full timestamp goes in
 * the line's title.
 */
export function shortStamp(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.getFullYear() !== now.getFullYear()) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) return time;
  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${time}`;
}
