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

/**
 * Recent messages across a workspace (optionally narrowed to one session or a
 * content search). Mirrors main's cross-session MESSAGE_STREAM — the SDK only
 * lists messages per-session, so the workspace-wide view comes from here.
 */
export interface RecentMessageRow {
  id: string;
  peer_id: string;
  session_id: string;
  content: string;
  token_count: number;
  created_at: string;
}

export async function dbRecentMessages(
  workspaceId: string,
  opts: { sessionId?: string; q?: string; limit?: number } = {},
): Promise<{ available: boolean; reason?: string; messages?: RecentMessageRow[] }> {
  const p = getPool();
  if (!p) return { available: false, reason: "HONCHO_DATABASE_URL not set" };
  try {
    if (!(await tableExists(p, "messages"))) {
      return { available: false, reason: "messages table not found in this Honcho schema" };
    }
    const msgWs = await pickColumn(p, "messages", ["workspace_name", "workspace_id"]);
    const msgSession = await pickColumn(p, "messages", ["session_name", "session_id"]);
    const msgPeer = await pickColumn(p, "messages", ["peer_name", "peer_id"]);
    const msgId = await pickColumn(p, "messages", ["public_id", "id"]);
    if (!msgWs || !msgSession || !msgPeer || !msgId) {
      return { available: false, reason: "messages table missing expected columns" };
    }
    const hasToken = await columnExists(p, "messages", "token_count");

    const where = [`${msgWs} = $1`];
    const params: string[] = [workspaceId];
    if (opts.sessionId) {
      params.push(opts.sessionId);
      where.push(`${msgSession} = $${params.length}`);
    }
    if (opts.q && opts.q.trim()) {
      params.push(`%${opts.q.trim()}%`);
      where.push(`content ILIKE $${params.length}`);
    }
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);

    const r = await p.query<{
      id: string;
      peer_id: string;
      session_id: string;
      content: string;
      token_count: string;
      created_at: string;
    }>(
      `SELECT ${msgId}::text AS id,
              ${msgPeer} AS peer_id,
              ${msgSession} AS session_id,
              content,
              ${hasToken ? "coalesce(token_count, 0)" : "0"} AS token_count,
              created_at::text AS created_at
         FROM messages
        WHERE ${where.join(" AND ")}
        ORDER BY created_at DESC
        LIMIT ${limit}`,
      params,
    );
    return {
      available: true,
      messages: r.rows.map((row) => ({
        id: row.id,
        peer_id: row.peer_id,
        session_id: row.session_id,
        content: row.content,
        token_count: Number(row.token_count),
        created_at: row.created_at,
      })),
    };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Per-task reasoning records from the `queue` table. Honcho's REST API only
 * exposes aggregate work-unit counters via /queue/status; the individual task
 * list (the deriver's representation/summary/dream/webhook jobs) lives here.
 */
export type ReasoningTaskStatus = "queued" | "completed" | "failed";

export interface ReasoningTaskRow {
  id: string;
  task_type: string;
  peer: string | null;
  session_id: string;
  status: ReasoningTaskStatus;
  error: string | null;
  created_at: string;
  token_count: number;
  work_unit_key: string | null;
  message_id: string | null;
  payload: Record<string, unknown> | null;
}

export interface ReasoningTasksResult {
  available: boolean;
  reason?: string;
  tasks?: ReasoningTaskRow[];
  counts?: { queued: number; completed: number; failed: number; total: number; tokens_pending: number };
  byType?: { type: string; n: number }[];
  config?: Record<string, unknown> | null;
}

export async function dbReasoningTasks(
  workspaceId: string,
  opts: { status?: string; taskType?: string; limit?: number } = {},
): Promise<ReasoningTasksResult> {
  const p = getPool();
  if (!p) return { available: false, reason: "HONCHO_DATABASE_URL not set" };
  try {
    if (!(await tableExists(p, "queue"))) {
      return { available: false, reason: "queue table not found in this Honcho schema" };
    }
    const qWs = await pickColumn(p, "queue", ["workspace_name", "workspace_id"]);
    if (!qWs) return { available: false, reason: "queue table missing workspace column" };
    const hasError = await columnExists(p, "queue", "error");
    const hasProcessed = await columnExists(p, "queue", "processed");
    const hasMsgId = await columnExists(p, "queue", "message_id");
    const hasWorkUnitKey = await columnExists(p, "queue", "work_unit_key");
    const canJoinTokens =
      hasMsgId && (await tableExists(p, "messages")) && (await columnExists(p, "messages", "token_count"));
    const join = canJoinTokens ? "LEFT JOIN messages m ON m.id = q.message_id" : "";
    const tokExpr = canJoinTokens ? "coalesce(m.token_count, 0)" : "0";
    const processedCol = hasProcessed ? "q.processed" : "false";
    const errorCol = hasError ? "q.error" : "NULL::text";

    // Aggregate counters (full workspace, unfiltered).
    const countsQ = p.query<{
      queued: string;
      completed: string;
      failed: string;
      total: string;
      tokens_pending: string;
    }>(
      `SELECT
         count(*) FILTER (WHERE NOT ${processedCol} AND ${errorCol} IS NULL)::bigint AS queued,
         count(*) FILTER (WHERE ${processedCol} AND ${errorCol} IS NULL)::bigint AS completed,
         count(*) FILTER (WHERE ${errorCol} IS NOT NULL)::bigint AS failed,
         count(*)::bigint AS total,
         ${
           canJoinTokens
             ? `coalesce(sum(m.token_count) FILTER (WHERE NOT q.processed AND ${errorCol} IS NULL), 0)::bigint`
             : "0::bigint"
         } AS tokens_pending
       FROM queue q ${join}
       WHERE q.${qWs} = $1`,
      [workspaceId],
    );

    const byTypeQ = p.query<{ type: string; n: string }>(
      `SELECT task_type AS type, count(*)::bigint AS n
         FROM queue WHERE ${qWs} = $1 GROUP BY 1 ORDER BY 2 DESC`,
      [workspaceId],
    );

    const configQ = p.query<{ cfg: Record<string, unknown> | null }>(
      `SELECT payload->'configuration' AS cfg
         FROM queue WHERE ${qWs} = $1 AND payload ? 'configuration'
        ORDER BY id DESC LIMIT 1`,
      [workspaceId],
    );

    // Filtered task list.
    const conds = [`q.${qWs} = $1`];
    const params: string[] = [workspaceId];
    if (opts.status === "queued") conds.push(`NOT ${processedCol} AND ${errorCol} IS NULL`);
    else if (opts.status === "completed") conds.push(`${processedCol} AND ${errorCol} IS NULL`);
    else if (opts.status === "failed") conds.push(`${errorCol} IS NOT NULL`);
    else if (opts.status === "processing") conds.push("1 = 0"); // not represented in the table
    if (opts.taskType && opts.taskType !== "all") {
      params.push(opts.taskType);
      conds.push(`q.task_type = $${params.length}`);
    }
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 300);
    const tasksQ = p.query<{
      id: string;
      task_type: string;
      peer: string | null;
      session_id: string;
      processed: boolean;
      error: string | null;
      created_at: string;
      token_count: string;
      work_unit_key: string | null;
      message_id: string | null;
      payload: Record<string, unknown> | null;
    }>(
      `SELECT q.id::text AS id,
              q.task_type,
              coalesce(q.payload->>'observed', q.payload->'observers'->>0) AS peer,
              coalesce(q.payload->>'session_name', q.session_id::text) AS session_id,
              ${processedCol} AS processed,
              ${errorCol} AS error,
              q.created_at::text AS created_at,
              ${tokExpr} AS token_count,
              ${hasWorkUnitKey ? "q.work_unit_key" : "NULL::text"} AS work_unit_key,
              ${hasMsgId ? "q.message_id::text" : "NULL::text"} AS message_id,
              q.payload AS payload
         FROM queue q ${join}
        WHERE ${conds.join(" AND ")}
        ORDER BY q.id DESC
        LIMIT ${limit}`,
      params,
    );

    const [counts, byType, config, tasks] = await Promise.all([countsQ, byTypeQ, configQ, tasksQ]);

    return {
      available: true,
      counts: {
        queued: Number(counts.rows[0]?.queued ?? 0),
        completed: Number(counts.rows[0]?.completed ?? 0),
        failed: Number(counts.rows[0]?.failed ?? 0),
        total: Number(counts.rows[0]?.total ?? 0),
        tokens_pending: Number(counts.rows[0]?.tokens_pending ?? 0),
      },
      byType: byType.rows.map((r) => ({ type: r.type, n: Number(r.n) })),
      config: config.rows[0]?.cfg ?? null,
      tasks: tasks.rows.map((r) => ({
        id: r.id,
        task_type: r.task_type,
        peer: r.peer,
        session_id: r.session_id,
        status: r.error ? "failed" : r.processed ? "completed" : "queued",
        error: r.error,
        created_at: r.created_at,
        token_count: Number(r.token_count),
        work_unit_key: r.work_unit_key,
        message_id: r.message_id,
        payload: r.payload,
      })),
    };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Re-queue a single failed reasoning task. Honcho's deriver has **no retry of
 * its own**: on failure it marks the row `processed=true, error=<msg>`, and the
 * worker only ever claims rows `WHERE NOT processed`. So "retry" here means
 * clearing the error and flipping `processed` back to false — the deriver then
 * re-claims it on its next poll. Scoped to the workspace AND a row that is
 * currently failed, so it can never disturb in-flight or succeeded work.
 *
 * This re-runs identical work: a deterministic failure (e.g. a model
 * ValidationException) will just fail again until its root cause is fixed.
 */
export async function dbRetryReasoningTask(
  workspaceId: string,
  id: string,
): Promise<{ ok: boolean; reason?: string }> {
  const p = getPool();
  if (!p) return { ok: false, reason: "HONCHO_DATABASE_URL not set" };
  if (!/^\d+$/.test(id)) return { ok: false, reason: "invalid task id" };
  try {
    if (!(await tableExists(p, "queue"))) {
      return { ok: false, reason: "queue table not found in this Honcho schema" };
    }
    const qWs = await pickColumn(p, "queue", ["workspace_name", "workspace_id"]);
    const hasError = await columnExists(p, "queue", "error");
    const hasProcessed = await columnExists(p, "queue", "processed");
    if (!qWs || !hasError || !hasProcessed) {
      return { ok: false, reason: "queue table lacks workspace/error/processed columns; cannot re-queue" };
    }
    const r = await p.query(
      `UPDATE queue SET processed = false, error = NULL
        WHERE ${qWs} = $1 AND id = $2::bigint AND error IS NOT NULL`,
      [workspaceId, id],
    );
    if (!r.rowCount) {
      return { ok: false, reason: "task not found, not failed, or already re-queued" };
    }
    return { ok: true };
  } catch (err) {
    // Honcho keeps a partial unique index on (work_unit_key) WHERE NOT processed
    // for 'reconciler'/'dream' tasks; re-queuing one whose key already has a
    // pending row collides. Surface that as a friendly no-op rather than a 500.
    if (err && typeof err === "object" && (err as { code?: string }).code === "23505") {
      return { ok: false, reason: "a newer task for this work unit is already queued — no retry needed" };
    }
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Bulk re-queue every failed reasoning task in a workspace (same mechanism as
 * {@link dbRetryReasoningTask}: clear error + processed=false). Excludes
 * `dream`/`reconciler` tasks, which carry a partial unique index on
 * `(work_unit_key) WHERE NOT processed` that a bulk reset can collide with —
 * those are retried individually (per-row handles the 23505). Returns the count
 * re-queued and the count skipped so the UI can report both.
 */
export async function dbRetryAllFailedReasoningTasks(
  workspaceId: string,
): Promise<{ ok: boolean; reason?: string; retried?: number; skipped?: number }> {
  const p = getPool();
  if (!p) return { ok: false, reason: "HONCHO_DATABASE_URL not set" };
  try {
    if (!(await tableExists(p, "queue"))) {
      return { ok: false, reason: "queue table not found in this Honcho schema" };
    }
    const qWs = await pickColumn(p, "queue", ["workspace_name", "workspace_id"]);
    const hasError = await columnExists(p, "queue", "error");
    const hasProcessed = await columnExists(p, "queue", "processed");
    const hasTaskType = await columnExists(p, "queue", "task_type");
    if (!qWs || !hasError || !hasProcessed) {
      return { ok: false, reason: "queue table lacks workspace/error/processed columns; cannot re-queue" };
    }
    const exclude = hasTaskType ? "AND task_type NOT IN ('dream','reconciler')" : "";
    let skipped = 0;
    if (hasTaskType) {
      const s = await p.query<{ n: string }>(
        `SELECT count(*)::bigint AS n FROM queue
          WHERE ${qWs} = $1 AND error IS NOT NULL AND task_type IN ('dream','reconciler')`,
        [workspaceId],
      );
      skipped = Number(s.rows[0]?.n ?? 0);
    }
    const r = await p.query(
      `UPDATE queue SET processed = false, error = NULL
        WHERE ${qWs} = $1 AND error IS NOT NULL ${exclude}`,
      [workspaceId],
    );
    return { ok: true, retried: r.rowCount ?? 0, skipped };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Webhook delivery stats from the `queue` table (task_type='webhook'). Honcho's
 * REST API exposes webhook *endpoints* (url only) but no delivery history; the
 * deliver/fail records and event types live in the queue.
 */
export interface WebhookStatsResult {
  available: boolean;
  reason?: string;
  total?: number;
  delivered?: number;
  failed?: number;
  last_delivery?: string | null;
  byEvent?: { event_type: string; n: number }[];
  recent?: { id: string; event_type: string; status: "delivered" | "failed"; created_at: string }[];
}

export async function dbWebhookStats(workspaceId: string): Promise<WebhookStatsResult> {
  const p = getPool();
  if (!p) return { available: false, reason: "HONCHO_DATABASE_URL not set" };
  try {
    if (!(await tableExists(p, "queue"))) {
      return { available: false, reason: "queue table not found in this Honcho schema" };
    }
    const qWs = await pickColumn(p, "queue", ["workspace_name", "workspace_id"]);
    if (!qWs || !(await columnExists(p, "queue", "task_type"))) {
      return { available: false, reason: "queue table missing workspace/task_type columns" };
    }
    const hasError = await columnExists(p, "queue", "error");
    const hasProcessed = await columnExists(p, "queue", "processed");
    const errorCol = hasError ? "error" : "NULL::text";
    const processedCol = hasProcessed ? "processed" : "true";
    const filter = `${qWs} = $1 AND task_type = 'webhook'`;

    const [agg, byEvent, recent] = await Promise.all([
      p.query<{ total: string; delivered: string; failed: string; last: string | null }>(
        `SELECT count(*)::bigint AS total,
                count(*) FILTER (WHERE ${errorCol} IS NULL AND ${processedCol})::bigint AS delivered,
                count(*) FILTER (WHERE ${errorCol} IS NOT NULL)::bigint AS failed,
                max(created_at)::text AS last
           FROM queue WHERE ${filter}`,
        [workspaceId],
      ),
      p.query<{ event_type: string; n: string }>(
        `SELECT coalesce(payload->>'event_type', '(unknown)') AS event_type, count(*)::bigint AS n
           FROM queue WHERE ${filter} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
        [workspaceId],
      ),
      p.query<{ id: string; event_type: string; error: string | null; created_at: string }>(
        `SELECT id::text AS id,
                coalesce(payload->>'event_type', '(unknown)') AS event_type,
                ${errorCol} AS error,
                created_at::text AS created_at
           FROM queue WHERE ${filter} ORDER BY id DESC LIMIT 15`,
        [workspaceId],
      ),
    ]);

    return {
      available: true,
      total: Number(agg.rows[0]?.total ?? 0),
      delivered: Number(agg.rows[0]?.delivered ?? 0),
      failed: Number(agg.rows[0]?.failed ?? 0),
      last_delivery: agg.rows[0]?.last ?? null,
      byEvent: byEvent.rows.map((r) => ({ event_type: r.event_type, n: Number(r.n) })),
      recent: recent.rows.map((r) => ({
        id: r.id,
        event_type: r.event_type,
        status: r.error ? "failed" : "delivered",
        created_at: r.created_at,
      })),
    };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Per-peer detail: message count, conclusion count, and the peer's top
 * conclusions (the deriver's typed observations about the peer). Conclusions
 * live in the `documents` table — `content`, `level` (explicit/deductive/...),
 * `times_derived` (frequency), `observed` (the peer the conclusion is about).
 */
export interface PeerConclusion {
  id: string;
  content: string;
  level: string;
  times_derived: number;
  created_at: string;
}

export interface PeerDetailResult {
  available: boolean;
  reason?: string;
  messages?: number;
  conclusions?: number;
  conclusionsList?: PeerConclusion[];
}

export async function dbPeerDetail(
  workspaceId: string,
  peerId: string,
  limit = 12,
): Promise<PeerDetailResult> {
  const p = getPool();
  if (!p) return { available: false, reason: "HONCHO_DATABASE_URL not set" };
  try {
    const lim = Math.min(Math.max(limit, 1), 50);

    // Message count for this peer.
    let messages = 0;
    if (await tableExists(p, "messages")) {
      const mWs = await pickColumn(p, "messages", ["workspace_name", "workspace_id"]);
      const mPeer = await pickColumn(p, "messages", ["peer_name", "peer_id"]);
      if (mWs && mPeer) {
        const r = await p.query<{ n: string }>(
          `SELECT count(*)::bigint AS n FROM messages WHERE ${mWs} = $1 AND ${mPeer} = $2`,
          [workspaceId, peerId],
        );
        messages = Number(r.rows[0]?.n ?? 0);
      }
    }

    // Conclusions about this peer (documents.observed = peerId).
    const docTable = await firstExistingTable(p, ["documents", "conclusions"]);
    let conclusions = 0;
    let conclusionsList: PeerConclusion[] = [];
    if (docTable) {
      const dWs = await pickColumn(p, docTable, ["workspace_name", "workspace_id"]);
      const dObserved = await pickColumn(p, docTable, ["observed", "observed_id", "observer", "observer_id"]);
      if (dWs && dObserved) {
        const hasDeleted = await columnExists(p, docTable, "deleted_at");
        const hasLevel = await columnExists(p, docTable, "level");
        const hasTimes = await columnExists(p, docTable, "times_derived");
        const notDeleted = hasDeleted ? "AND deleted_at IS NULL" : "";

        const cnt = await p.query<{ n: string }>(
          `SELECT count(*)::bigint AS n FROM ${docTable} WHERE ${dWs} = $1 AND ${dObserved} = $2 ${notDeleted}`,
          [workspaceId, peerId],
        );
        conclusions = Number(cnt.rows[0]?.n ?? 0);

        const list = await p.query<{
          id: string;
          content: string;
          level: string | null;
          times_derived: string | null;
          created_at: string;
        }>(
          `SELECT id::text AS id,
                  content,
                  ${hasLevel ? "level" : "NULL::text"} AS level,
                  ${hasTimes ? "times_derived" : "1"} AS times_derived,
                  created_at::text AS created_at
             FROM ${docTable}
            WHERE ${dWs} = $1 AND ${dObserved} = $2 ${notDeleted}
            ORDER BY ${hasTimes ? "times_derived DESC NULLS LAST, " : ""}created_at DESC
            LIMIT ${lim}`,
          [workspaceId, peerId],
        );
        conclusionsList = list.rows.map((r) => ({
          id: r.id,
          content: r.content,
          level: r.level ?? "",
          times_derived: Number(r.times_derived ?? 1),
          created_at: r.created_at,
        }));
      }
    }

    return { available: true, messages, conclusions, conclusionsList };
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
