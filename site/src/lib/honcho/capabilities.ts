export const HONCHO_31_MIN_VERSION = "3.1.0";

export type HonchoCapabilityState =
  | "checking"
  | "available"
  | "unsupported"
  | "restricted"
  | "unknown";

export function normalizeHonchoVersion(raw: string | undefined): string | null {
  const version = raw?.trim();
  if (!version || ["unknown", "undefined", "null", "n/a"].includes(version.toLowerCase())) {
    return null;
  }
  return version.replace(/^v(?=\d)/i, "");
}

function numericVersion(raw: string | undefined): [number, number, number] | null {
  const version = normalizeHonchoVersion(raw);
  const match = version?.match(/^(\d+)\.(\d+)(?:\.(\d+))?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

/** New optional features fail closed when version metadata is unavailable. */
export function capabilityAtVersion(raw: string | undefined, minimum: [number, number, number]): HonchoCapabilityState {
  const parsed = numericVersion(raw);
  if (!parsed) return "unknown";
  for (let i = 0; i < 3; i++) {
    if (parsed[i] > minimum[i]) return "available";
    if (parsed[i] < minimum[i]) return "unsupported";
  }
  // A prerelease of the minimum version need not include its final API.
  return normalizeHonchoVersion(raw)?.split("+", 1)[0].includes("-") ? "unsupported" : "available";
}

/** Return null when OpenAPI did not provide a comparable semantic version. */
export function honcho31FromVersion(
  raw: string | undefined,
): Extract<HonchoCapabilityState, "available" | "unsupported"> | null {
  const parsed = numericVersion(raw);
  if (!parsed) return null;
  const [major, minor] = parsed;
  return major > 3 || (major === 3 && minor >= 1) ? "available" : "unsupported";
}

export function shouldProbeHoncho31(input: {
  rawVersion?: string;
  openApiResolved: boolean;
  openApiErrorStatus?: number;
  hasWorkspace: boolean;
}): boolean {
  if (!input.hasWorkspace || honcho31FromVersion(input.rawVersion) !== null) return false;
  if (input.openApiResolved) return true;
  return input.openApiErrorStatus === 404 || input.openApiErrorStatus === 405;
}

export function capabilityFromProbe(input: {
  loading: boolean;
  succeeded: boolean;
  errorStatus?: number;
}): HonchoCapabilityState {
  if (input.loading) return "checking";
  if (input.succeeded) return "available";
  if (input.errorStatus === 404 || input.errorStatus === 405) return "unsupported";
  if (input.errorStatus === 401 || input.errorStatus === 403) return "restricted";
  return "unknown";
}

/**
 * Honcho 3.5.0 features, each with the OpenAPI evidence that proves a server
 * has it. A server built from Honcho's main branch reports the last tag in
 * `info.version` while already carrying some of these, so the schema decides
 * first and the version is the fallback. Absent evidence on an older or
 * unknown version fails closed.
 */
export const HONCHO_35_FEATURES = {
  /** `source_message_ids` on conclusions and its `contains` filter (#935). */
  messageCitations: { model: "Conclusion", property: "source_message_ids" },
  /** Session list `include_scopes`, `scope` and `in_no_scope` (#1477). */
  sessionScopes: { model: "WorkspaceSessionGet" },
  /** Scope list `include_session_count` and name filters (#1478). */
  scopeSessionCounts: { model: "Scope", property: "session_count" },
  /** `POST /scopes/{id}/sessions/remove`, up to 100 sessions at once (#1480). */
  scopeBulkRemove: { model: "ScopeSessionsRemove" },
  /** Workspace `PUT` replaces the stored configuration instead of merging (#1458). */
  workspaceConfigReplace: { model: "WorkspaceUpdate", property: "configuration", description: /replaces the entire workspace configuration/i },
} as const;

export type Honcho35Feature = keyof typeof HONCHO_35_FEATURES;

interface SchemaEvidence {
  model: string;
  property?: string;
  description?: RegExp;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** True when `/openapi.json` declares the model (and property, and description). */
export function schemaHas(openapi: unknown, evidence: SchemaEvidence): boolean {
  const model = record(record(record(record(openapi)?.components)?.schemas)?.[evidence.model]);
  if (!model) return false;
  if (!evidence.property) return true;
  const property = record(record(model.properties)?.[evidence.property]);
  if (!property) return false;
  if (!evidence.description) return true;
  return typeof property.description === "string" && evidence.description.test(property.description);
}

export function honcho35Capability(openapi: unknown, rawVersion: string | undefined, feature: Honcho35Feature): HonchoCapabilityState {
  if (schemaHas(openapi, HONCHO_35_FEATURES[feature])) return "available";
  return capabilityAtVersion(rawVersion, [3, 5, 0]);
}
