/**
 * Workspace configuration form <-> Honcho request body.
 *
 * `PUT /v3/workspaces/{id}` merges top-level keys into the stored configuration
 * and drops `null` values. A section the request sends replaces the stored
 * section, and a section it omits is kept. So the form must:
 *   - overlay its fields onto the stored section instead of rebuilding it, or
 *     keys the form does not show are erased (for example Honcho 3.3's
 *     `summary.custom_instructions` when the server version is unknown);
 *   - clear a section by sending `{}`, and a top-level string by sending `""`.
 */

export type Tri = boolean | null;

/** `null` = unset (inherit), `""` = explicitly no instructions, text = custom. */
export type Instructions = string | null;

export const INSTRUCTION_MODULES = ["reasoning", "summary", "dialectic", "dream", "peer_card"] as const;
export type InstructionModule = (typeof INSTRUCTION_MODULES)[number];
/** Every instruction field the form can show: the shared one plus each agent's. */
export type InstructionKey = InstructionModule | "shared";

/**
 * What a collapsed instruction field reports about itself. `inherits` applies only
 * to sections that fall back to the shared text, `unset` to the rest.
 */
export type InstructionState = "custom" | "none" | "inherits" | "unset";

export function instructionState(value: Instructions, inheritsShared: boolean): InstructionState {
  const normalized = normalizeInstructions(value);
  if (normalized === "") return "none";
  if (normalized === null) return inheritsShared ? "inherits" : "unset";
  return "custom";
}

/**
 * Instruction fields named by a FastAPI 422 body. Honcho reports each rejected
 * value as `["body", "configuration", <section>?, "custom_instructions"]`.
 */
export function instructionFieldsInError(body: unknown): InstructionKey[] {
  const detail = plainObject(body)?.detail;
  if (!Array.isArray(detail)) return [];
  const found = new Set<InstructionKey>();
  for (const entry of detail) {
    const loc = plainObject(entry)?.loc;
    if (!Array.isArray(loc)) continue;
    const at = loc.indexOf("configuration");
    if (at < 0) continue;
    const [first, second] = [loc[at + 1], loc[at + 2]];
    if (first === "custom_instructions" && second === undefined) found.add("shared");
    else if (second === "custom_instructions" && (INSTRUCTION_MODULES as readonly unknown[]).includes(first)) {
      found.add(first as InstructionModule);
    }
  }
  return [...found];
}

export interface WorkspaceConfigForm {
  reasoning: Tri;
  peerCardUse: Tri;
  peerCardCreate: Tri;
  summary: Tri;
  shortInterval: string;
  longInterval: string;
  dream: Tri;
  /** Top-level `custom_instructions` (Honcho 3.3+). */
  sharedInstructions: Instructions;
  instructions: Record<InstructionModule, Instructions>;
}

export interface WorkspaceConfigOptions {
  /** Manage 3.3 shared and per-agent instructions. When false they are preserved untouched. */
  customInstructions: boolean;
}

type Config = Record<string, unknown>;

function plainObject(value: unknown): Config | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Config) : null;
}

function bool(section: Config | null, key: string): Tri {
  const value = section?.[key];
  return typeof value === "boolean" ? value : null;
}

function text(section: Config | null, key: string): Instructions {
  const value = section?.[key];
  return typeof value === "string" ? value : null;
}

function interval(section: Config | null, key: string): string {
  const value = section?.[key];
  return typeof value === "number" ? String(value) : "";
}

export function seedWorkspaceConfigForm(configuration: unknown): WorkspaceConfigForm {
  const config = plainObject(configuration) ?? {};
  const section = (key: string) => plainObject(config[key]);
  const instructions = {} as Record<InstructionModule, Instructions>;
  for (const agent of INSTRUCTION_MODULES) instructions[agent] = text(section(agent), "custom_instructions");
  return {
    reasoning: bool(section("reasoning"), "enabled"),
    peerCardUse: bool(section("peer_card"), "use"),
    peerCardCreate: bool(section("peer_card"), "create"),
    summary: bool(section("summary"), "enabled"),
    shortInterval: interval(section("summary"), "messages_per_short_summary"),
    longInterval: interval(section("summary"), "messages_per_long_summary"),
    dream: bool(section("dream"), "enabled"),
    sharedInstructions: text(config, "custom_instructions"),
    instructions,
  };
}

/** Whitespace-only text means unset; `""` stays an explicit "no instructions". */
export function normalizeInstructions(value: Instructions): Instructions {
  if (value === null || value === "") return value;
  return value.trim() || null;
}

function intervalValue(raw: string): number | null {
  return raw.trim() ? Number(raw) : null;
}

/** Overlay the form onto `base`, keeping every key the form does not manage. */
export function buildWorkspaceConfiguration(
  base: unknown,
  form: WorkspaceConfigForm,
  { customInstructions }: WorkspaceConfigOptions,
): Config {
  const stored = plainObject(base) ?? {};
  const out: Config = { ...stored };

  const section = (key: string, fields: Record<string, unknown>) => {
    const previous = plainObject(stored[key]);
    const next: Config = { ...(previous ?? {}) };
    for (const [field, value] of Object.entries(fields)) {
      if (value === null || value === undefined) delete next[field];
      else next[field] = value;
    }
    if (Object.keys(next).length) out[key] = next;
    else if (previous && Object.keys(previous).length) out[key] = {};
    else delete out[key];
  };
  const instructions = (agent: InstructionModule) =>
    customInstructions ? { custom_instructions: normalizeInstructions(form.instructions[agent]) } : {};

  // reasoning.custom_instructions predates 3.3 and is always part of the form.
  section("reasoning", {
    enabled: form.reasoning,
    custom_instructions: normalizeInstructions(form.instructions.reasoning),
  });
  section("peer_card", { use: form.peerCardUse, create: form.peerCardCreate, ...instructions("peer_card") });
  section("summary", {
    enabled: form.summary,
    messages_per_short_summary: intervalValue(form.shortInterval),
    messages_per_long_summary: intervalValue(form.longInterval),
    ...instructions("summary"),
  });
  section("dream", { enabled: form.dream, ...instructions("dream") });

  if (customInstructions) {
    section("dialectic", instructions("dialectic"));
    const shared = normalizeInstructions(form.sharedInstructions);
    if (shared !== null) out.custom_instructions = shared;
    // At the workspace level "" and unset both mean no shared instructions.
    else if (typeof stored.custom_instructions === "string" && stored.custom_instructions) out.custom_instructions = "";
    else delete out.custom_instructions;
  }
  return out;
}

/**
 * Make a saved configuration replace the stored one. The server keeps keys the
 * request omits, so removed objects are sent as `{}` and removed strings as `""`.
 * Other value types cannot be cleared through the API and are left alone.
 */
export function withClearedKeys(stored: unknown, next: Config): Config {
  const out: Config = { ...next };
  for (const [key, value] of Object.entries(plainObject(stored) ?? {})) {
    if (Object.hasOwn(next, key)) continue;
    const object = plainObject(value);
    if (object && Object.keys(object).length) out[key] = {};
    else if (typeof value === "string" && value) out[key] = "";
  }
  return out;
}

/** Reject summary intervals that violate the server's constraints up front. */
export function validateWorkspaceConfiguration(config: Config): string | null {
  const summary = plainObject(config.summary);
  const s = summary?.messages_per_short_summary;
  const l = summary?.messages_per_long_summary;
  const short = typeof s === "number" ? s : s == null ? null : NaN;
  const long = typeof l === "number" ? l : l == null ? null : NaN;
  if (short !== null && (!Number.isFinite(short) || short < 10)) return "Short summary interval must be ≥ 10";
  if (long !== null && (!Number.isFinite(long) || long < 20)) return "Long summary interval must be ≥ 20";
  if (short !== null && long !== null && short >= long) {
    return "Short summary interval must be less than the long interval";
  }
  return null;
}
