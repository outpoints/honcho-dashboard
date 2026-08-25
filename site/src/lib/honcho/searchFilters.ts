import { parseOptionalJsonObject } from "../json.ts";

export interface SearchFilterInput {
  fromDate?: string;
  toDate?: string;
  metadataJson?: string;
}

export type SearchFilterResult =
  | { ok: true; filters: Record<string, unknown> }
  | { ok: false; error: string };

function utcBoundary(date: string, endOfDay: boolean): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
  const parsed = new Date(`${date}${suffix}`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  return parsed.toISOString();
}

/** Build the filter shape accepted by Honcho's native message search endpoints. */
export function buildSearchFilters(input: SearchFilterInput): SearchFilterResult {
  const filters: Record<string, unknown> = {};
  const createdAt: Record<string, string> = {};

  if (input.fromDate) {
    const from = utcBoundary(input.fromDate, false);
    if (!from) return { ok: false, error: "From date is invalid." };
    createdAt.gte = from;
  }
  if (input.toDate) {
    const to = utcBoundary(input.toDate, true);
    if (!to) return { ok: false, error: "To date is invalid." };
    createdAt.lte = to;
  }
  if (createdAt.gte && createdAt.lte && createdAt.gte > createdAt.lte) {
    return { ok: false, error: "From date must be on or before the to date." };
  }
  if (Object.keys(createdAt).length) filters.created_at = createdAt;

  const metadata = parseOptionalJsonObject(input.metadataJson ?? "", "Metadata filter");
  if (!metadata.ok) return metadata;
  if (metadata.value) filters.metadata = metadata.value;

  return { ok: true, filters };
}
