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

/**
 * Per-session activity stats sourced directly from the `messages` table (and
 * `session_peers` for membership). One batched query per workspace — far
 * cheaper than N SDK round-trips when a workspace has hundreds of sessions.
 * Honcho's REST list endpoint only returns id/is_active/created_at, so the
 * message/token/peer counts the dashboard renders come from here.
 */
export interface SessionStatRow {
  session_id: string;
  workspace_id: string;
  message_count: number;
  token_sum: number;
  last_message_at: string | null;
  peers: string[];
}

export async function dbSessionStats(workspaceId?: string): Promise<{
  available: boolean;
  reason?: string;
  sessions?: Record<string, SessionStatRow>;
}> {
  const p = getPool();
  if (!p) return { available: false, reason: "HONCHO_DATABASE_URL not set" };
  try {
    if (!(await tableExists(p, "messages"))) {
      return { available: false, reason: "messages table not found in this Honcho schema" };
    }
    // Schema-adaptive: current Honcho uses *_name join columns, older builds
    // used *_id. Resolve whichever exists before composing the query.
    const msgSession = await pickColumn(p, "messages", ["session_name", "session_id"]);
    const msgWs = await pickColumn(p, "messages", ["workspace_name", "workspace_id"]);
    const msgPeer = await pickColumn(p, "messages", ["peer_name", "peer_id"]);
    if (!msgSession || !msgWs) {
      return { available: false, reason: "messages table missing expected session/workspace columns" };
    }
    const hasToken = await columnExists(p, "messages", "token_count");

    const where = workspaceId ? `WHERE ${msgWs} = $1` : "";
    const params = workspaceId ? [workspaceId] : [];
    const agg = await p.query<{
      session_id: string;
      workspace_id: string;
      message_count: string;
      token_sum: string;
      last_message_at: string | null;
      peers: string[] | null;
    }>(
      `SELECT ${msgSession} AS session_id,
              ${msgWs} AS workspace_id,
              count(*)::bigint AS message_count,
              ${hasToken ? "coalesce(sum(token_count), 0)::bigint" : "0::bigint"} AS token_sum,
              max(created_at)::text AS last_message_at,
              ${msgPeer ? `array_remove(array_agg(DISTINCT ${msgPeer}), NULL)` : "ARRAY[]::text[]"} AS peers
         FROM messages
         ${where}
        GROUP BY 1, 2`,
      params,
    );

    const sessions: Record<string, SessionStatRow> = {};
    for (const row of agg.rows) {
      const key = `${row.workspace_id}::${row.session_id}`;
      sessions[key] = {
        session_id: row.session_id,
        workspace_id: row.workspace_id,
        message_count: Number(row.message_count),
        token_sum: Number(row.token_sum),
        last_message_at: row.last_message_at,
        peers: row.peers ?? [],
      };
    }

    // Merge in canonical session membership (a peer can belong to a session
    // without having posted a message). Union with message-derived peers.
    if (await tableExists(p, "session_peers")) {
      const spSession = await pickColumn(p, "session_peers", ["session_name", "session_id"]);
      const spWs = await pickColumn(p, "session_peers", ["workspace_name", "workspace_id"]);
      const spPeer = await pickColumn(p, "session_peers", ["peer_name", "peer_id"]);
      const hasLeftAt = await columnExists(p, "session_peers", "left_at");
      if (spSession && spWs && spPeer) {
        const memWhere = workspaceId ? `${spWs} = $1` : "";
        const leftClause = hasLeftAt ? "left_at IS NULL" : "";
        const clauses = [memWhere, leftClause].filter(Boolean).join(" AND ");
        const mem = await p.query<{ session_id: string; workspace_id: string; peers: string[] | null }>(
          `SELECT ${spSession} AS session_id,
                  ${spWs} AS workspace_id,
                  array_remove(array_agg(DISTINCT ${spPeer}), NULL) AS peers
             FROM session_peers
             ${clauses ? `WHERE ${clauses}` : ""}
            GROUP BY 1, 2`,
          workspaceId ? [workspaceId] : [],
        );
        for (const row of mem.rows) {
          const key = `${row.workspace_id}::${row.session_id}`;
          const peers = row.peers ?? [];
          const existing = sessions[key];
          if (existing) {
            existing.peers = Array.from(new Set([...peers, ...existing.peers]));
          } else {
            sessions[key] = {
              session_id: row.session_id,
              workspace_id: row.workspace_id,
              message_count: 0,
              token_sum: 0,
              last_message_at: null,
              peers,
            };
          }
        }
      }
    }

    return { available: true, sessions };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

const columnCache = new Map<string, boolean>();

/** Return the first column from `candidates` that exists on `table`, else null. */
async function pickColumn(p: Pool, table: string, candidates: string[]): Promise<string | null> {
  for (const c of candidates) {
    if (await columnExists(p, table, c)) return c;
  }
  return null;
}

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
