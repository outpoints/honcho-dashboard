/**
 * Read-only checks for Honcho's migration state. Pure so it can be tested
 * without a database; `db.ts` collects the catalog facts.
 *
 * Release heads come from each tag's `migrations/versions` (the revision no
 * other revision names as `down_revision`). Honcho 3.3.0 and 3.4.0 build
 * indexes CONCURRENTLY with a 60-minute timeout and leave an INVALID index when
 * a build fails; 3.4.0 skips `ix_queue_pending_observers` when `btree_gin` is
 * unavailable. Both are invisible from the REST API. 3.5.0's two migrations
 * are DDL-only (nullable `deleted_at` columns, the citation edge table).
 *
 * 3.6.0 runs 14 migrations. `e5fe7f8bcf62` adds `tenant_id` to every
 * tenant-scoped table and rebuilds their keys; from 3.6.1 it commits after
 * each step, so a run that stops leaves the tables changed while
 * `alembic_version` still names the 3.5.0 head. `b7d2f4a81c39` adds the
 * deriver's `queue_item_batches` table and the three triggers on `queue` that
 * keep it current; 3.6 refuses to start without them. `d4b8e2f7a913` swaps the
 * message search indexes for tenant-scoped ones, but keeps the old ones when
 * `btree_gin` is missing.
 *
 * Honcho's main branch moves past the newest release before the next tag
 * (`0e32bf9d5a22`, webhook event types, after 3.6.1) while still reporting
 * that release's version. Such a revision maps onto the head it builds on, so
 * the checks for that head keep running.
 */

export interface SchemaFacts {
  /** `alembic_version.version_num`, or null when the table is absent. */
  revision: string | null;
  invalidIndexes: string[];
  presentQueueIndexes: string[];
  btreeGin: boolean;
  /** 3.6 facts. Absent from older collectors and tests: the probes that need them skip. */
  /** `workspaces.tenant_id` exists (added by 3.6's e5fe7f8bcf62). */
  tenantIdColumn?: boolean;
  /** Which of MESSAGE_SEARCH_INDEXES exist. */
  presentMessageSearchIndexes?: string[];
  pgTrgm?: boolean;
  queueBatchTable?: boolean;
  /** Which of QUEUE_BATCH_TRIGGERS exist on `queue`. */
  queueBatchTriggers?: string[];
  /** Distinct `workspaces.tenant_id` values this role can see; null without the column. */
  tenantCount?: number | null;
  /** Row-level security is on for `workspaces` and this role does not bypass it. */
  rowSecurityHidesRows?: boolean;
}

export interface SchemaProbe {
  id: string;
  category: "database";
  label: string;
  status: "ok" | "warn" | "err" | "skip";
  message: string;
}

const HEADS = [
  { revision: "e4eba9cfaa6f", release: "3.0.12", through: "3.1.2" },
  { revision: "a7c3e9f1b2d4", release: "3.2.0", through: "3.2.1" },
  { revision: "b8d2f4a6c9e1", release: "3.2.2", through: "3.2.2" },
  { revision: "3e7a1c9d5b20", release: "3.3.0", through: "3.3.0" },
  { revision: "a5f8da8f6d23", release: "3.4.0", through: "3.4.1" },
  { revision: "c4d8e2f6a1b3", release: "3.5.0", through: "3.5.0" },
  { revision: "4f9c2a7e8d31", release: "3.6.0", through: "3.6.1" },
] as const;

const BETWEEN_35_AND_36 = { after: "3.5.0", before: "3.6.0", head: "c4d8e2f6a1b3" } as const;

/**
 * Revisions no release ends on: a server built from Honcho's main branch can
 * sit on one, and so can an upgrade that stopped part-way. Named so the probe
 * can say where it falls instead of skipping. `head` is the release head the
 * revision builds on. `before` is null while no release carries the revision.
 */
const BETWEEN_RELEASES: Record<string, { after: string; before: string | null; head: string }> = {
  d8c4f6a2b901: { after: "3.4.1", before: "3.5.0", head: "a5f8da8f6d23" },
  // 3.6.0's chain, in order after c4d8e2f6a1b3.
  e5fe7f8bcf62: BETWEEN_35_AND_36,
  b7d2f4a81c39: BETWEEN_35_AND_36,
  c4e8a2b91d57: BETWEEN_35_AND_36,
  "43d77d0c5846": BETWEEN_35_AND_36,
  "647b773f05ac": BETWEEN_35_AND_36,
  a3f9c2e81d47: BETWEEN_35_AND_36,
  "0c67be41049b": BETWEEN_35_AND_36,
  b3c890d417d1: BETWEEN_35_AND_36,
  b7d2e4f19c03: BETWEEN_35_AND_36,
  a1e7ce5396d5: BETWEEN_35_AND_36,
  c7d3e9a1f5b2: BETWEEN_35_AND_36,
  d4b8e2f7a913: BETWEEN_35_AND_36,
  a7e3c1d9f2b4: BETWEEN_35_AND_36,
  // On main after 3.6.1, in no release yet. Adds a nullable column 3.6.1 never reads.
  "0e32bf9d5a22": { after: "3.6.1", before: null, head: "4f9c2a7e8d31" },
};

/** migrations/compat.toml: oldest release whose image runs against that head. */
const COMPAT_FLOOR: Record<string, string> = { a5f8da8f6d23: "3.2.2", c4d8e2f6a1b3: "3.2.2", "4f9c2a7e8d31": "3.2.2" };

export const QUEUE_PENDING_INDEXES = [
  "ix_queue_pending_observers",
  "ix_queue_pending_observed",
  "ix_queue_pending_observer",
  "ix_queue_pending_scope_peer",
  "ix_queue_pending_session_name",
] as const;

/** 3.6's tenant-scoped message search indexes and the ones they replace. */
export const MESSAGE_SEARCH_INDEXES = {
  fts: { current: "ix_messages_tenant_content_fts", previous: "ix_messages_content_gin" },
  trgm: { current: "ix_messages_tenant_content_trgm", previous: "ix_messages_content_trgm" },
} as const;

export const MESSAGE_SEARCH_INDEX_NAMES: readonly string[] = Object.values(MESSAGE_SEARCH_INDEXES).flatMap((pair) => [pair.current, pair.previous]);

export const QUEUE_BATCH_TRIGGERS = [
  "trg_queue_item_batches_insert",
  "trg_queue_item_batches_update",
  "trg_queue_item_batches_delete",
] as const;

const headIndexOf = (revision: string) => HEADS.findIndex((head) => head.revision === revision);
const QUEUE_INDEX_HEAD = headIndexOf("a5f8da8f6d23");
const TENANT_HEAD = headIndexOf("4f9c2a7e8d31");
const HEAD_35 = headIndexOf("c4d8e2f6a1b3");

type Triple = [number, number, number];

function parseVersion(raw: string | null | undefined): Triple | null {
  const match = raw?.trim().replace(/^v(?=\d)/i, "").match(/^(\d+)\.(\d+)(?:\.(\d+))?(?:[-+].*)?$/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : null;
}

function compare(a: Triple, b: Triple): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * Index into HEADS of the newest release head the database has reached: the
 * head itself, or the head an in-between revision builds on. -1 when unknown.
 */
function reachedHeadIndex(revision: string | null): number {
  if (!revision) return -1;
  const between = BETWEEN_RELEASES[revision];
  return headIndexOf(between ? between.head : revision);
}

/**
 * Index into HEADS for the schema a server version expects, or null when the
 * version is unknown or newer than the last release this dashboard maps.
 */
export function expectedHeadIndex(serverVersion: string | null | undefined): number | null {
  const version = parseVersion(serverVersion);
  if (!version) return null;
  const last = parseVersion(HEADS.at(-1)!.through)!;
  // A later minor or major may ship a migration this map does not know.
  if (version[0] !== last[0] || version[1] > last[1]) return null;
  let index: number | null = null;
  HEADS.forEach((head, i) => {
    if (compare(version, parseVersion(head.release)!) >= 0) index = i;
  });
  return index;
}

export function revisionProbe(facts: SchemaFacts, serverVersion: string | null | undefined): SchemaProbe {
  const base = { id: "db.schema_revision", category: "database" as const, label: "schema revision" };
  if (!facts.revision) {
    return { ...base, status: "skip", message: "alembic_version not found in this database" };
  }
  const dbIndex = headIndexOf(facts.revision);
  const server = parseVersion(serverVersion);
  const between = BETWEEN_RELEASES[facts.revision];
  if (between) {
    if (between.before === null) {
      return {
        ...base,
        status: "ok",
        message: `${facts.revision} · past ${between.after}: a build from Honcho's main branch`,
      };
    }
    // A server that already reports the next release expects its head: the upgrade stopped.
    if (server && compare(server, parseVersion(between.before)!) >= 0) {
      const expected = expectedHeadIndex(serverVersion);
      return {
        ...base,
        status: "warn",
        message: `${facts.revision} is between the Honcho ${between.after} and ${between.before} schemas, but server ${serverVersion} expects ${expected !== null ? HEADS[expected].revision : `the ${between.before} schema or later`}. The upgrade stopped part-way: run Honcho's migration step again.`,
      };
    }
    return {
      ...base,
      status: "ok",
      message: `${facts.revision} · between the Honcho ${between.after} and ${between.before} schemas (a build from Honcho's main branch)`,
    };
  }
  if (dbIndex < 0) {
    const last = parseVersion(HEADS.at(-1)!.through)!;
    const message =
      server && compare(server, last) >= 0
        ? `${facts.revision} · not a revision this dashboard knows. Server ${serverVersion} is probably a build from Honcho's main branch with a newer migration, so the checks that depend on the schema are skipped.`
        : `${facts.revision} · not a release head this dashboard knows`;
    return { ...base, status: "skip", message };
  }
  const head = HEADS[dbIndex];
  const schema = head.release === head.through ? head.release : `${head.release}–${head.through}`;
  // 3.6.1 commits e5fe7f8bcf62 step by step: tenant_id on the 3.5.0 head means it stopped.
  if (dbIndex === HEAD_35 && facts.tenantIdColumn === true) {
    return {
      ...base,
      status: "warn",
      message: `${facts.revision} is the Honcho 3.5.0 schema, but tables already carry tenant_id: the 3.6 tenant migration (e5fe7f8bcf62) stopped part-way. Run Honcho's migration step again; from 3.6.1 each step skips what is already done.`,
    };
  }
  const expected = expectedHeadIndex(serverVersion);
  if (expected === null) {
    return { ...base, status: "ok", message: `${facts.revision} · Honcho ${schema} schema` };
  }
  if (dbIndex === expected) {
    return { ...base, status: "ok", message: `${facts.revision} · matches server ${serverVersion}` };
  }
  if (dbIndex < expected) {
    return {
      ...base,
      status: "warn",
      message: `${facts.revision} is the Honcho ${schema} schema; server ${serverVersion} expects ${HEADS[expected].revision}. Run Honcho's migration step.`,
    };
  }
  const floor = COMPAT_FLOOR[facts.revision];
  if (floor && server && compare(server, parseVersion(floor)!) >= 0) {
    return {
      ...base,
      status: "ok",
      message: `${facts.revision} · Honcho ${schema} schema, ahead of server ${serverVersion}; compatible back to ${floor}`,
    };
  }
  return {
    ...base,
    status: "warn",
    message: `${facts.revision} is the Honcho ${schema} schema, newer than server ${serverVersion}. Confirm this rollback is supported.`,
  };
}

export function invalidIndexProbe(facts: SchemaFacts): SchemaProbe {
  const base = { id: "db.invalid_indexes", category: "database" as const, label: "index validity" };
  if (facts.invalidIndexes.length === 0) return { ...base, status: "ok", message: "no invalid indexes" };
  const names = facts.invalidIndexes.slice(0, 6).join(", ");
  const more = facts.invalidIndexes.length > 6 ? ` +${facts.invalidIndexes.length - 6} more` : "";
  return {
    ...base,
    status: "warn",
    message: `INVALID: ${names}${more}. A concurrent build failed or timed out; Honcho's next migration run drops and rebuilds its own indexes.`,
  };
}

/** Only meaningful once the 3.4.0 migration has been applied. */
export function queueIndexProbe(facts: SchemaFacts): SchemaProbe | null {
  if (reachedHeadIndex(facts.revision) < QUEUE_INDEX_HEAD) return null;
  const base = { id: "db.queue_pending_indexes", category: "database" as const, label: "3.4 queue indexes" };
  const present = new Set(facts.presentQueueIndexes);
  const missing = QUEUE_PENDING_INDEXES.filter((name) => !present.has(name));
  const total = QUEUE_PENDING_INDEXES.length;
  if (missing.length === 0) return { ...base, status: "ok", message: `${total}/${total} present` };
  if (missing.length === 1 && missing[0] === "ix_queue_pending_observers" && !facts.btreeGin) {
    return {
      ...base,
      status: "warn",
      message: `${total - 1}/${total} present. ix_queue_pending_observers was skipped because btree_gin is not installed. Install it as a privileged role, then build the index with the statement in Honcho's migration log.`,
    };
  }
  return { ...base, status: "warn", message: `${total - missing.length}/${total} present · missing ${missing.join(", ")}` };
}

/** From the 3.6 head on: the deriver's claim table and its triggers, without which 3.6 refuses to start. */
export function queueBatchProbe(facts: SchemaFacts): SchemaProbe | null {
  if (reachedHeadIndex(facts.revision) < TENANT_HEAD || facts.queueBatchTable === undefined) return null;
  const base = { id: "db.queue_item_batches", category: "database" as const, label: "3.6 deriver claim table" };
  const present = new Set(facts.queueBatchTriggers ?? []);
  const missing = QUEUE_BATCH_TRIGGERS.filter((name) => !present.has(name));
  if (facts.queueBatchTable && missing.length === 0) {
    return { ...base, status: "ok", message: `queue_item_batches and its ${QUEUE_BATCH_TRIGGERS.length} triggers on queue are present` };
  }
  const gone = [...(facts.queueBatchTable ? [] : ["queue_item_batches"]), ...missing];
  return {
    ...base,
    status: "err",
    message: `Missing ${gone.join(", ")}. Honcho 3.6 refuses to start its deriver without them. Run Honcho's migration step.`,
  };
}

/** From the 3.6 head on: whether message search moved to the tenant-scoped indexes. */
export function messageSearchIndexProbe(facts: SchemaFacts): SchemaProbe | null {
  if (reachedHeadIndex(facts.revision) < TENANT_HEAD || facts.presentMessageSearchIndexes === undefined) return null;
  const base = { id: "db.message_search_indexes", category: "database" as const, label: "3.6 message search indexes" };
  const present = new Set(facts.presentMessageSearchIndexes);
  const pairs = Object.values(MESSAGE_SEARCH_INDEXES);
  const current = pairs.filter((pair) => present.has(pair.current)).length;
  if (current === pairs.length) return { ...base, status: "ok", message: `${current}/${pairs.length} tenant-scoped indexes present` };
  if (!facts.btreeGin) {
    const kept = pairs.filter((pair) => present.has(pair.previous)).map((pair) => pair.previous);
    return {
      ...base,
      status: "warn",
      message: `btree_gin is not installed, so Honcho kept ${kept.length ? kept.join(", ") : "no message search index"} and search works as before. Install btree_gin as a privileged role, then build the new indexes with the steps in Honcho's migration log.`,
    };
  }
  const { trgm } = MESSAGE_SEARCH_INDEXES;
  if (current === pairs.length - 1 && !present.has(trgm.current) && facts.pgTrgm === false) {
    return {
      ...base,
      status: "warn",
      message: `pg_trgm is not installed, so only full-text search has an index; substring matches scan. Install pg_trgm as a privileged role, then build ${trgm.current} with the steps in Honcho's migration log.`,
    };
  }
  const missing = pairs.filter((pair) => !present.has(pair.current)).map((pair) => pair.current);
  return { ...base, status: "warn", message: `${current}/${pairs.length} present · missing ${missing.join(", ")}` };
}

/**
 * Operator SQL filters by workspace name only. That is exact on a
 * single-tenant database (3.6 stamps every row with one tenant), not when
 * several tenants share it, and nothing at all under row-level security.
 */
export function tenancyProbe(facts: SchemaFacts): SchemaProbe | null {
  if (!facts.tenantIdColumn) return null;
  const base = { id: "db.tenancy", category: "database" as const, label: "tenants" };
  if (facts.rowSecurityHidesRows) {
    return {
      ...base,
      status: "warn",
      message: "Row-level security is on and this database role does not bypass it, so operator panels see no rows. Point HONCHO_DATABASE_URL at a role that bypasses RLS, such as the one in Honcho's DB_SERVICE_CONNECTION_URI.",
    };
  }
  const count = facts.tenantCount ?? 0;
  if (count <= 1) return { ...base, status: "ok", message: count === 1 ? "one tenant" : "no workspaces yet" };
  return {
    ...base,
    status: "warn",
    message: `${count} tenants share this database. Operator panels filter by workspace name only, so tenants that reuse a workspace name are counted together.`,
  };
}

export function schemaProbes(facts: SchemaFacts, serverVersion: string | null | undefined): SchemaProbe[] {
  const optional = [queueIndexProbe(facts), queueBatchProbe(facts), messageSearchIndexProbe(facts), tenancyProbe(facts)];
  return [revisionProbe(facts, serverVersion), invalidIndexProbe(facts), ...optional.filter((probe): probe is SchemaProbe => probe !== null)];
}
