import "server-only";
import { Pool } from "pg";

let pool: Pool | null = null;
let lastUrl: string | null = null;

function getPool(): Pool | null {
  const url = process.env.HONCHO_DATABASE_URL;
  if (!url) return null;
  const normalized = url.replace(/^postgresql\+psycopg:\/\//, "postgresql://");
  if (pool && lastUrl === normalized) return pool;
  pool?.end().catch(() => undefined);
  pool = new Pool({
    connectionString: normalized,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  lastUrl = normalized;
  return pool;
}

/**
 * Cache of table-existence lookups so we don't probe `information_schema` on
 * every request. Honcho's schema evolves across versions — `conclusions` for
 * example exists at the REST layer but isn't a physical table; "observations"
 * live in `documents`. Query writers should call `tableExists()` and degrade
 * gracefully when a table is missing.
 */
const tableCache = new Map<string, boolean>();

async function tableExists(p: Pool, table: string): Promise<boolean> {
  if (tableCache.has(table)) return tableCache.get(table)!;
  try {
    const r = await p.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_schema NOT IN ('pg_catalog','information_schema')
            AND table_name = $1
       ) AS exists`,
      [table],
    );
    const exists = !!r.rows[0]?.exists;
    tableCache.set(table, exists);
    return exists;
  } catch {
    return false;
  }
}

/** First table that exists from the list, or null. Used to pick the right
 * activity source (e.g. conclusions vs documents) across Honcho versions. */
async function firstExistingTable(p: Pool, candidates: string[]): Promise<string | null> {
  for (const t of candidates) {
    if (await tableExists(p, t)) return t;
  }
  return null;
}

export interface DbAvailability {
  available: boolean;
  reason?: string;
}

export async function dbHealth(): Promise<DbAvailability & { detail?: string; timing?: number }> {
  const p = getPool();
  if (!p) return { available: false, reason: "HONCHO_DATABASE_URL not set" };
  const start = Date.now();
  try {
    const r = await p.query<{ now: string; version: string }>(
      "SELECT now()::text AS now, version() AS version",
    );
    return {
      available: true,
      detail: r.rows[0]?.version,
      timing: Date.now() - start,
    };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export interface DbStats {
  available: boolean;
  reason?: string;
  uptime_s?: number;
  db_size_bytes?: number;
  db_size_pretty?: string;
  connections?: number;
  vector_extension?: boolean;
  vector_count?: number;
  tables?: { name: string; rows: number; size_bytes: number }[];
}

export async function dbStats(): Promise<DbStats> {
  const p = getPool();
  if (!p) return { available: false, reason: "HONCHO_DATABASE_URL not set" };
  try {
    const [meta, vecExt, tables] = await Promise.all([
      p.query<{
        uptime_s: string;
        db_size_bytes: string;
        db_size_pretty: string;
        connections: string;
      }>(
        `SELECT
           EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time()))::bigint AS uptime_s,
           pg_database_size(current_database())::bigint AS db_size_bytes,
           pg_size_pretty(pg_database_size(current_database())) AS db_size_pretty,
           (SELECT count(*)::bigint FROM pg_stat_activity WHERE datname = current_database()) AS connections`,
      ),
      p.query<{ extversion: string }>(
        `SELECT extversion FROM pg_extension WHERE extname = 'vector'`,
      ),
      p.query<{ name: string; rows: string; size_bytes: string }>(
        `SELECT
           c.relname AS name,
           c.reltuples::bigint AS rows,
           pg_total_relation_size(c.oid)::bigint AS size_bytes
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
           AND c.relkind = 'r'
         ORDER BY pg_total_relation_size(c.oid) DESC
         LIMIT 20`,
      ),
    ]);
    let vectorCount: number | undefined;
    if (vecExt.rows.length > 0) {
      try {
        const v = await p.query<{ n: string }>(
          `SELECT count(*)::bigint AS n
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           JOIN pg_attribute a ON a.attrelid = c.oid
           JOIN pg_type t ON t.oid = a.atttypid
           WHERE t.typname = 'vector' AND a.attnum > 0 AND NOT a.attisdropped`,
        );
        vectorCount = Number(v.rows[0]?.n ?? 0);
      } catch {
        vectorCount = undefined;
      }
    }
    return {
      available: true,
      uptime_s: Number(meta.rows[0]?.uptime_s ?? 0),
      db_size_bytes: Number(meta.rows[0]?.db_size_bytes ?? 0),
      db_size_pretty: meta.rows[0]?.db_size_pretty ?? undefined,
      connections: Number(meta.rows[0]?.connections ?? 0),
      vector_extension: vecExt.rows.length > 0,
      vector_count: vectorCount,
      tables: tables.rows.map((r) => ({
        name: r.name,
        rows: Number(r.rows),
        size_bytes: Number(r.size_bytes),
      })),
    };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export interface ThroughputBucket {
  ts: string;
  reads: number;
  writes: number;
}

export async function dbThroughput(timeframe: "1H" | "6H" | "24H" | "7D"): Promise<{
  available: boolean;
  reason?: string;
  buckets?: ThroughputBucket[];
}> {
  const p = getPool();
  if (!p) return { available: false, reason: "HONCHO_DATABASE_URL not set" };
  const ranges: Record<typeof timeframe, { interval: string; bucket: string }> = {
    "1H": { interval: "1 hour", bucket: "5 minute" },
    "6H": { interval: "6 hours", bucket: "20 minute" },
    "24H": { interval: "24 hours", bucket: "1 hour" },
    "7D": { interval: "7 days", bucket: "6 hour" },
  };
  const r = ranges[timeframe];
  try {
    if (!(await tableExists(p, "messages"))) {
      return { available: false, reason: "messages table not found in this Honcho schema" };
    }
    // Honcho's REST `conclusions` resource is stored as documents in the DB.
    // We pick whichever activity source exists for the "reads" series.
    const readsTable = await firstExistingTable(p, ["documents", "conclusions"]);
    const writesQ = p.query<{ bucket: string; n: string }>(
      `SELECT date_trunc($2, created_at) AS bucket, count(*)::bigint AS n
         FROM messages
        WHERE created_at > now() - $1::interval
        GROUP BY 1 ORDER BY 1`,
      [r.interval, r.bucket.split(" ")[1]],
    );
    const readsQ = readsTable
      ? p.query<{ bucket: string; n: string }>(
          `SELECT date_trunc($2, created_at) AS bucket, count(*)::bigint AS n
             FROM ${readsTable}
            WHERE created_at > now() - $1::interval
            GROUP BY 1 ORDER BY 1`,
          [r.interval, r.bucket.split(" ")[1]],
        )
      : Promise.resolve({ rows: [] as { bucket: string; n: string }[] });
    const [writes, reads] = await Promise.all([writesQ, readsQ]);
    const map = new Map<string, ThroughputBucket>();
    for (const row of writes.rows) {
      const k = new Date(row.bucket).toISOString();
      map.set(k, { ts: k, reads: 0, writes: Number(row.n) });
    }
    for (const row of reads.rows) {
      const k = new Date(row.bucket).toISOString();
      const existing = map.get(k);
      if (existing) existing.reads = Number(row.n);
      else map.set(k, { ts: k, reads: Number(row.n), writes: 0 });
    }
    const buckets = Array.from(map.values()).sort((a, b) => a.ts.localeCompare(b.ts));
    return { available: true, buckets };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function dbHeatmap(): Promise<{
  available: boolean;
  reason?: string;
  source?: string;
  cells?: { day: string; n: number }[];
}> {
  const p = getPool();
  if (!p) return { available: false, reason: "HONCHO_DATABASE_URL not set" };
  try {
    // Prefer documents (where Honcho stores derived conclusions/observations
    // — the most "reasoning activity"-like signal); fall back to messages
    // if documents isn't part of this Honcho's schema.
    const source = await firstExistingTable(p, ["documents", "conclusions", "messages"]);
    if (!source) {
      return { available: false, reason: "no activity table found in this Honcho schema" };
    }
    const r = await p.query<{ day: string; n: string }>(
      `SELECT date_trunc('day', created_at)::date::text AS day, count(*)::bigint AS n
         FROM ${source}
        WHERE created_at > now() - interval '52 weeks'
        GROUP BY 1 ORDER BY 1`,
    );
    return {
      available: true,
      source,
      cells: r.rows.map((row) => ({ day: row.day, n: Number(row.n) })),
    };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function dbConclusionStats(workspaceId?: string): Promise<{
  available: boolean;
  reason?: string;
  source?: string;
  total?: number;
  by_observer?: { observer_id: string; n: number }[];
}> {
  const p = getPool();
  if (!p) return { available: false, reason: "HONCHO_DATABASE_URL not set" };
  try {
    const source = await firstExistingTable(p, ["conclusions", "documents"]);
    if (!source) {
      return {
        available: false,
        reason: "conclusions/documents table not found in this Honcho schema",
      };
    }
    const hasObserver = await columnExists(p, source, "observer_id");
    const hasWorkspace = await columnExists(p, source, "workspace_id");

    const filter = workspaceId && hasWorkspace ? "WHERE workspace_id = $1" : "";
    const params: string[] = workspaceId && hasWorkspace ? [workspaceId] : [];

    const tot = await p.query<{ n: string }>(
      `SELECT count(*)::bigint AS n FROM ${source} ${filter}`,
      params,
    );
    let byObserver: { observer_id: string; n: number }[] = [];
    if (hasObserver) {
      const byObs = await p.query<{ observer_id: string; n: string }>(
        `SELECT observer_id, count(*)::bigint AS n
           FROM ${source} ${filter}
          GROUP BY observer_id
          ORDER BY 2 DESC
          LIMIT 12`,
        params,
      );
      byObserver = byObs.rows.map((r) => ({ observer_id: r.observer_id, n: Number(r.n) }));
    }
    return {
      available: true,
      source,
      total: Number(tot.rows[0]?.n ?? 0),
      by_observer: byObserver,
    };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

const columnCache = new Map<string, boolean>();

async function columnExists(p: Pool, table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  if (columnCache.has(key)) return columnCache.get(key)!;
  try {
    const r = await p.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema NOT IN ('pg_catalog','information_schema')
            AND table_name = $1 AND column_name = $2
       ) AS exists`,
      [table, column],
    );
    const exists = !!r.rows[0]?.exists;
    columnCache.set(key, exists);
    return exists;
  } catch {
    return false;
  }
}
