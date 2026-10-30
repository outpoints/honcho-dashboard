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
 */

export interface SchemaFacts {
  /** `alembic_version.version_num`, or null when the table is absent. */
  revision: string | null;
  invalidIndexes: string[];
  presentQueueIndexes: string[];
  btreeGin: boolean;
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
] as const;

/**
 * Revisions no release ends on: a server built from Honcho's main branch can
 * sit on one. Named so the probe can say where it falls instead of skipping.
 */
const BETWEEN_RELEASES: Record<string, { after: string; before: string }> = {
  d8c4f6a2b901: { after: "3.4.1", before: "3.5.0" },
};

/** migrations/compat.toml: oldest release whose image runs against that head. */
const COMPAT_FLOOR: Record<string, string> = { a5f8da8f6d23: "3.2.2", c4d8e2f6a1b3: "3.2.2" };

export const QUEUE_PENDING_INDEXES = [
  "ix_queue_pending_observers",
  "ix_queue_pending_observed",
  "ix_queue_pending_observer",
  "ix_queue_pending_scope_peer",
  "ix_queue_pending_session_name",
] as const;

const QUEUE_INDEX_HEAD = HEADS.findIndex((head) => head.revision === "a5f8da8f6d23");

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
  const dbIndex = HEADS.findIndex((head) => head.revision === facts.revision);
  const between = BETWEEN_RELEASES[facts.revision];
  if (between) {
    return {
      ...base,
      status: "ok",
      message: `${facts.revision} · between the Honcho ${between.after} and ${between.before} schemas (a build from Honcho's main branch)`,
    };
  }
  if (dbIndex < 0) {
    return { ...base, status: "skip", message: `${facts.revision} · not a release head this dashboard knows` };
  }
  const head = HEADS[dbIndex];
  const schema = head.release === head.through ? head.release : `${head.release}–${head.through}`;
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
  const server = parseVersion(serverVersion);
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
  const dbIndex = facts.revision && BETWEEN_RELEASES[facts.revision]
    ? QUEUE_INDEX_HEAD
    : HEADS.findIndex((head) => head.revision === facts.revision);
  if (dbIndex < QUEUE_INDEX_HEAD) return null;
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

export function schemaProbes(facts: SchemaFacts, serverVersion: string | null | undefined): SchemaProbe[] {
  const queue = queueIndexProbe(facts);
  return [revisionProbe(facts, serverVersion), invalidIndexProbe(facts), ...(queue ? [queue] : [])];
}
