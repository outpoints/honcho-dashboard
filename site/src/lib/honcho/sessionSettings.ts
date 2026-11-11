/**
 * Session learning settings: what Honcho learns from new messages in one session.
 *
 * Honcho resolves each setting per message: message, then session, then
 * workspace, then the server's own defaults (`get_configuration()` in
 * `src/utils/config_helpers.py`). The API does not report the server's
 * defaults, so a setting no level sets is shown as "server default" without a
 * value. These settings gate what the deriver, summarizer and dreamer write
 * from new messages. They never hide stored conclusions or messages.
 *
 * Writing them has three traps, all handled here:
 *
 *   - `PUT /sessions/{id}` merges top-level keys and replaces each section it is
 *     sent (Honcho 3.1 through 3.5). A patch therefore carries only the
 *     sections that changed, each rebuilt from the stored section, so fields
 *     the form does not show (and legacy keys) survive.
 *   - That merge cannot remove a top-level key, so a session's shared
 *     `custom_instructions` never returns to "inherit" once set; "" means
 *     "none" there and blocks the workspace's text.
 *   - The same `PUT` get-or-creates the session. A save re-reads the session
 *     through the non-creating list read first and sends nothing if it is
 *     gone or being deleted.
 *
 * Per-member flags (`observe_me`, `observe_others`) live on the session-peer
 * row. `PUT .../peers/{peer}/config` merges the fields it is sent, but adds the
 * peer to the session if it is not a member, and cannot clear a flag back to
 * unset. Only current members are offered, and only on or off.
 */
import { INSTRUCTION_MODULES, normalizeInstructions, type InstructionKey, type InstructionModule, type Instructions } from "./workspaceConfig.ts";

type Config = Record<string, unknown>;

export type Choice = "inherit" | "on" | "off";
export type SwitchKey = "reasoning" | "summary" | "dream" | "peer_card_use" | "peer_card_create";
/** Where an in-effect value comes from. `unknown`: the workspace could not be read. */
export type SettingSource = "session" | "workspace" | "server" | "unknown";

export interface SwitchSpec {
  key: SwitchKey;
  section: "reasoning" | "summary" | "dream" | "peer_card";
  field: "enabled" | "use" | "create";
  label: string;
  hint: string;
}

export const SESSION_SWITCHES: readonly SwitchSpec[] = [
  { key: "reasoning", section: "reasoning", field: "enabled", label: "CONCLUSIONS", hint: "Honcho reads new messages and writes conclusions about the peers. Off also stops peer card updates from them." },
  { key: "summary", section: "summary", field: "enabled", label: "SUMMARIES", hint: "Short and long summaries of the conversation." },
  { key: "dream", section: "dream", field: "enabled", label: "DREAMS", hint: "Background passes over a peer's conclusions. Honcho checks the session holding the newest one." },
  { key: "peer_card_use", section: "peer_card", field: "use", label: "USE_PEER_CARD", hint: "Give the peer card to the deriver, and to chat that names this session." },
  { key: "peer_card_create", section: "peer_card", field: "create", label: "UPDATE_PEER_CARD", hint: "Let Honcho write peer card entries from this session." },
];

/** Honcho's shipped summary intervals. A server's own config can change them. */
export const SHIPPED_SUMMARY_INTERVALS = { short: 20, long: 60 } as const;

function plainObject(value: unknown): Config | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Config) : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function choiceOf(value: boolean | null): Choice {
  return value === null ? "inherit" : value ? "on" : "off";
}

/** The value each switch has on one level, as stored (explicit keys only). */
function explicitSwitch(config: Config, spec: SwitchSpec): boolean | null {
  return bool(plainObject(config[spec.section])?.[spec.field]);
}

/**
 * One level's switch as Honcho reads it. Mirrors `normalize_configuration_dict()`:
 * an explicit `reasoning.enabled` wins, then the legacy `deriver.enabled`, then
 * a legacy `skip_deriver` of true.
 */
function levelSwitch(config: Config, spec: SwitchSpec): { value: boolean | null; legacy: boolean } {
  const explicit = explicitSwitch(config, spec);
  if (explicit !== null || spec.key !== "reasoning") return { value: explicit, legacy: false };
  const legacy = bool(plainObject(config.deriver)?.enabled);
  if (legacy !== null) return { value: legacy, legacy: true };
  if (config.skip_deriver === true) return { value: false, legacy: true };
  return { value: null, legacy: false };
}

export interface ResolvedSwitch {
  key: SwitchKey;
  /** What the session itself stores. */
  choice: Choice;
  /** The value in effect, or null when it is the server's unreported default. */
  effective: boolean | null;
  source: SettingSource;
  /** A legacy key (`deriver.enabled`, `skip_deriver`) decides the value. */
  legacy: boolean;
}

/** `workspace` is the workspace's stored configuration, or undefined if it could not be read. */
export function resolveSwitches(session: unknown, workspace: unknown | undefined): ResolvedSwitch[] {
  const s = plainObject(session) ?? {};
  const w = workspace === undefined ? null : plainObject(workspace) ?? {};
  return SESSION_SWITCHES.map((spec) => {
    const own = levelSwitch(s, spec);
    const base = { key: spec.key, choice: choiceOf(explicitSwitch(s, spec)) };
    if (own.value !== null) return { ...base, effective: own.value, source: "session", legacy: own.legacy };
    if (!w) return { ...base, effective: null, source: "unknown", legacy: false };
    const inherited = levelSwitch(w, spec);
    if (inherited.value !== null) return { ...base, effective: inherited.value, source: "workspace", legacy: inherited.legacy };
    return { ...base, effective: null, source: "server", legacy: false };
  });
}

/** Conclusions are off for this session's new messages (session or workspace says so). */
export function learningOff(session: unknown, workspace: unknown | undefined): ResolvedSwitch | null {
  const reasoning = resolveSwitches(session, workspace).find((row) => row.key === "reasoning")!;
  return reasoning.effective === false ? reasoning : null;
}

/** The session stores at least one setting of its own. Empty sections (`{"dream": {}}`) inherit. */
export function hasSessionOverrides(session: unknown): boolean {
  const hasValue = (value: unknown): boolean => {
    const object = plainObject(value);
    if (object) return Object.values(object).some(hasValue);
    return value !== undefined && value !== null;
  };
  return hasValue(plainObject(session) ?? {});
}

export interface ResolvedInterval {
  stored: number | null;
  effective: number | null;
  source: SettingSource;
}

function intervalAt(config: Config | null, field: string): number | null {
  const value = plainObject(config?.summary)?.[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function resolveIntervals(session: unknown, workspace: unknown | undefined): { short: ResolvedInterval; long: ResolvedInterval } {
  const s = plainObject(session) ?? {};
  const w = workspace === undefined ? null : plainObject(workspace) ?? {};
  const one = (field: string): ResolvedInterval => {
    const stored = intervalAt(s, field);
    if (stored !== null) return { stored, effective: stored, source: "session" };
    if (!w) return { stored, effective: null, source: "unknown" };
    const inherited = intervalAt(w, field);
    return inherited !== null ? { stored, effective: inherited, source: "workspace" } : { stored, effective: null, source: "server" };
  };
  return { short: one("messages_per_short_summary"), long: one("messages_per_long_summary") };
}

export interface ResolvedInstruction {
  key: InstructionKey;
  /** What the session stores: null = inherit, "" = none, text = custom. */
  stored: Instructions;
  /** Text in effect, or null for none. */
  effective: string | null;
  /** Honcho's `custom_instructions_source` (`session.shared`, `workspace.summary`, …), or null when no level sets one. */
  source: string | null;
}

function textAt(config: Config, key: InstructionModule | "shared"): string | null {
  const value = key === "shared" ? config.custom_instructions : plainObject(config[key])?.custom_instructions;
  return typeof value === "string" ? value : null;
}

/**
 * Mirrors `resolve_custom_instructions()`: the most specific level that sets a
 * value wins; inside a level the section's own text beats the shared one; ""
 * stops the fallback. Peer card instructions never fall back to the shared text.
 * Before Honcho 3.3 there is no shared text: pass `shared: false`.
 */
export function resolveInstructions(session: unknown, workspace: unknown | undefined, { shared = true }: { shared?: boolean } = {}): ResolvedInstruction[] {
  const levels: [string, Config][] = [["session", plainObject(session) ?? {}]];
  if (workspace !== undefined) levels.push(["workspace", plainObject(workspace) ?? {}]);
  const rows: ResolvedInstruction[] = [];
  if (shared) {
    let found: ResolvedInstruction | null = null;
    for (const [name, level] of levels) {
      const value = textAt(level, "shared");
      if (value !== null) {
        found = { key: "shared", stored: textAt(levels[0][1], "shared"), effective: value.trim() || null, source: `${name}.shared` };
        break;
      }
    }
    rows.push(found ?? { key: "shared", stored: textAt(levels[0][1], "shared"), effective: null, source: null });
  }
  for (const agent of shared ? INSTRUCTION_MODULES : (["reasoning"] as const)) {
    const fallback = shared && agent !== "peer_card";
    let row: ResolvedInstruction = { key: agent, stored: textAt(levels[0][1], agent), effective: null, source: null };
    for (const [name, level] of levels) {
      let value = textAt(level, agent);
      let source = `${name}.${agent}`;
      if (value === null && fallback) {
        value = textAt(level, "shared");
        source = `${name}.shared`;
      }
      if (value !== null) {
        row = { ...row, effective: value.trim() || null, source };
        break;
      }
    }
    rows.push(row);
  }
  return rows;
}

// --- Form -------------------------------------------------------------------

export interface SessionSettingsForm {
  switches: Record<SwitchKey, Choice>;
  /** "" = inherit. */
  shortInterval: string;
  longInterval: string;
  /** Top-level `custom_instructions`: null = inherit (absent), "" = none, text. */
  sharedInstructions: Instructions;
  instructions: Record<InstructionModule, Instructions>;
}

export interface SessionSettingsOptions {
  /** Manage 3.3 shared and per-agent instructions. When false they are preserved untouched. */
  customInstructions: boolean;
}

export function seedSessionSettingsForm(configuration: unknown): SessionSettingsForm {
  const config = plainObject(configuration) ?? {};
  const switches = {} as Record<SwitchKey, Choice>;
  for (const spec of SESSION_SWITCHES) switches[spec.key] = choiceOf(explicitSwitch(config, spec));
  const instructions = {} as Record<InstructionModule, Instructions>;
  for (const agent of INSTRUCTION_MODULES) instructions[agent] = textAt(config, agent);
  const interval = (field: string) => {
    const value = intervalAt(config, field);
    return value === null ? "" : String(value);
  };
  return {
    switches,
    shortInterval: interval("messages_per_short_summary"),
    longInterval: interval("messages_per_long_summary"),
    sharedInstructions: textAt(config, "shared"),
    instructions,
  };
}

function intervalValue(raw: string): number | null {
  return raw.trim() ? Number(raw) : null;
}

function sameJson(a: unknown, b: unknown): boolean {
  return stableStringify(a ?? {}) === stableStringify(b ?? {});
}

/** JSON with object keys sorted, so equal settings compare equal. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const object = plainObject(value);
  if (object) {
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * The `configuration` body for `PUT /sessions/{id}`: only the sections the form
 * changed, each rebuilt from the stored section. Throws if the form asks for
 * something the merge cannot do (shared instructions back to inherit).
 */
export function sessionConfigurationPatch(stored: unknown, form: SessionSettingsForm, { customInstructions }: SessionSettingsOptions): Config {
  const config = plainObject(stored) ?? {};
  const patch: Config = {};
  const section = (key: string, fields: Record<string, unknown>) => {
    const previous = plainObject(config[key]);
    const next: Config = { ...(previous ?? {}) };
    for (const [field, value] of Object.entries(fields)) {
      if (value === null || value === undefined) delete next[field];
      else next[field] = value;
    }
    if (!sameJson(previous, next)) patch[key] = next;
  };
  const bools = (key: SwitchKey) => {
    const choice = form.switches[key];
    return choice === "inherit" ? null : choice === "on";
  };
  const instructions = (agent: InstructionModule) =>
    customInstructions ? { custom_instructions: normalizeInstructions(form.instructions[agent]) } : {};

  // reasoning.custom_instructions predates 3.3 and is always managed.
  section("reasoning", { enabled: bools("reasoning"), custom_instructions: normalizeInstructions(form.instructions.reasoning) });
  section("summary", {
    enabled: bools("summary"),
    messages_per_short_summary: intervalValue(form.shortInterval),
    messages_per_long_summary: intervalValue(form.longInterval),
    ...instructions("summary"),
  });
  section("dream", { enabled: bools("dream"), ...instructions("dream") });
  section("peer_card", { use: bools("peer_card_use"), create: bools("peer_card_create"), ...instructions("peer_card") });
  if (customInstructions) {
    section("dialectic", instructions("dialectic"));
    const next = normalizeInstructions(form.sharedInstructions);
    const current = typeof config.custom_instructions === "string" ? config.custom_instructions : null;
    if (next === null && current !== null) {
      throw new Error("Honcho can't return a session's shared instructions to inherit once set. Choose none or enter text.");
    }
    if (next !== null && next !== current) patch.custom_instructions = next;
  }
  return patch;
}

/** Reject values the server refuses, and a short/long pair that cannot both hold. */
export function validateSessionSettings(form: SessionSettingsForm, workspace: unknown | undefined): string | null {
  const parse = (raw: string, label: string, min: number) => {
    const value = intervalValue(raw);
    if (value === null) return { value: null as number | null };
    if (!Number.isInteger(value) || value < min) return { error: `${label} summary interval must be a whole number of at least ${min}` };
    return { value };
  };
  const short = parse(form.shortInterval, "Short", 10);
  if ("error" in short) return short.error ?? null;
  const long = parse(form.longInterval, "Long", 20);
  if ("error" in long) return long.error ?? null;
  const w = workspace === undefined ? null : plainObject(workspace) ?? {};
  const effectiveShort = short.value ?? intervalAt(w, "messages_per_short_summary");
  const effectiveLong = long.value ?? intervalAt(w, "messages_per_long_summary");
  if (effectiveShort !== null && effectiveLong !== null && effectiveShort >= effectiveLong) {
    return "The short summary interval must be less than the long one";
  }
  return null;
}

// --- Members ----------------------------------------------------------------

export type FlagChoice = "unset" | "on" | "off";
export type MemberField = "observe_me" | "observe_others";
const SCOPE_PEER_PREFIX = "scope.";

export interface SessionMember {
  id: string;
  /** The peer's own `observe_me`, for every session. */
  peerObserveMe: boolean | null;
  /** Session-level values. */
  observeMe: boolean | null;
  observeOthers: boolean | null;
}

export function isScopeMember(id: string): boolean {
  return id.startsWith(SCOPE_PEER_PREFIX);
}

export function flagChoice(value: boolean | null): FlagChoice {
  return value === null ? "unset" : value ? "on" : "off";
}

export interface ResolvedMember {
  id: string;
  scope: boolean;
  /** `get_effective_observe_me()`: the session's value, then the peer's own, then on. */
  observeMe: { effective: boolean; source: "session" | "peer" | "default" };
  /** Honcho adds a peer as an observer only when its session value is true. */
  observeOthers: { effective: boolean; source: "session" | "unset" };
}

export function resolveMember(member: SessionMember): ResolvedMember {
  return {
    id: member.id,
    scope: isScopeMember(member.id),
    observeMe: member.observeMe !== null
      ? { effective: member.observeMe, source: "session" }
      : member.peerObserveMe !== null
        ? { effective: member.peerObserveMe, source: "peer" }
        : { effective: true, source: "default" },
    observeOthers: { effective: member.observeOthers === true, source: member.observeOthers === null ? "unset" : "session" },
  };
}

/**
 * Who builds a view of each member from this session's new messages (when
 * conclusions are on): the member itself and every other member that observes
 * others. A member Honcho does not observe gets nobody, not even observers.
 */
export function learnersAbout(members: SessionMember[]): Record<string, string[]> {
  const resolved = members.map(resolveMember);
  const out: Record<string, string[]> = {};
  for (const member of resolved) {
    out[member.id] = member.observeMe.effective
      ? [member.id, ...resolved.filter((other) => other.id !== member.id && other.observeOthers.effective).map((other) => other.id)]
      : [];
  }
  return out;
}

export type MemberEdits = Record<string, Partial<Record<MemberField, FlagChoice>>>;

// --- Changes, revision, save ------------------------------------------------

export interface SettingChange {
  id: string;
  kind: "session" | "member";
  label: string;
  from: string;
  to: string;
  peerId?: string;
  field?: MemberField;
}

const SWITCH_LABEL = Object.fromEntries(SESSION_SWITCHES.map((spec) => [spec.key, spec.label])) as Record<SwitchKey, string>;
const INSTRUCTION_LABEL: Record<InstructionKey, string> = {
  shared: "SHARED_INSTRUCTIONS",
  reasoning: "CONCLUSIONS_INSTRUCTIONS",
  summary: "SUMMARIES_INSTRUCTIONS",
  dream: "DREAMS_INSTRUCTIONS",
  dialectic: "CHAT_INSTRUCTIONS",
  peer_card: "PEER_CARD_INSTRUCTIONS",
};

/** "030" and "30" are the same interval. */
function intervalText(raw: string): string {
  const value = intervalValue(raw);
  return value === null ? "inherit" : Number.isFinite(value) ? String(value) : raw.trim();
}

function instructionValue(value: Instructions): string {
  const normalized = normalizeInstructions(value);
  return normalized === null ? "inherit" : normalized === "" ? "none" : normalized;
}

/** Comparable values for every session field the form manages, keyed by change id. */
export function sessionFormValues(form: SessionSettingsForm, { customInstructions }: SessionSettingsOptions): Record<string, { label: string; value: string }> {
  const out: Record<string, { label: string; value: string }> = {};
  for (const spec of SESSION_SWITCHES) out[`switch.${spec.key}`] = { label: SWITCH_LABEL[spec.key], value: form.switches[spec.key] };
  out["interval.short"] = { label: "SHORT_SUMMARY_INTERVAL", value: intervalText(form.shortInterval) };
  out["interval.long"] = { label: "LONG_SUMMARY_INTERVAL", value: intervalText(form.longInterval) };
  out["instructions.reasoning"] = { label: INSTRUCTION_LABEL.reasoning, value: instructionValue(form.instructions.reasoning) };
  if (customInstructions) {
    out["instructions.shared"] = { label: INSTRUCTION_LABEL.shared, value: instructionValue(form.sharedInstructions) };
    for (const agent of INSTRUCTION_MODULES) {
      if (agent !== "reasoning") out[`instructions.${agent}`] = { label: INSTRUCTION_LABEL[agent], value: instructionValue(form.instructions[agent]) };
    }
  }
  return out;
}

export function planSessionChanges(stored: unknown, form: SessionSettingsForm, options: SessionSettingsOptions): SettingChange[] {
  const before = sessionFormValues(seedSessionSettingsForm(stored), options);
  const after = sessionFormValues(form, options);
  return Object.entries(after)
    .filter(([id, next]) => before[id]?.value !== next.value)
    .map(([id, next]) => ({ id, kind: "session" as const, label: next.label, from: before[id]?.value ?? "inherit", to: next.value }));
}

const FIELD_LABEL: Record<MemberField, string> = { observe_me: "OBSERVED", observe_others: "OBSERVES_OTHERS" };

/** Changes to members' session flags. Throws on a non-member or an attempt to clear a flag. */
export function planMemberChanges(members: SessionMember[], edits: MemberEdits): SettingChange[] {
  const byId = new Map(members.map((member) => [member.id, member]));
  const changes: SettingChange[] = [];
  for (const [peerId, fields] of Object.entries(edits)) {
    const member = byId.get(peerId);
    if (!member) throw new Error(`${peerId} isn't a member of this session any more.`);
    if (isScopeMember(peerId)) throw new Error(`${peerId} is managed by its scope.`);
    for (const field of ["observe_me", "observe_others"] as const) {
      const to = fields[field];
      if (to === undefined) continue;
      const from = flagChoice(field === "observe_me" ? member.observeMe : member.observeOthers);
      if (to === from) continue;
      if (to === "unset") throw new Error("Honcho can't clear a session flag back to unset.");
      changes.push({ id: `member.${peerId}.${field}`, kind: "member", label: `${peerId} · ${FIELD_LABEL[field]}`, from, to, peerId, field });
    }
  }
  return changes;
}

/** Fingerprint of everything a save could overwrite. */
export function settingsRevision(configuration: unknown, members: SessionMember[] | null): string {
  return stableStringify({
    session: configuration ?? {},
    members: members === null ? null : [...members].sort((a, b) => a.id.localeCompare(b.id)).map((m) => [m.id, m.observeMe, m.observeOthers]),
  });
}

export interface SessionSettingsState {
  configuration: Config;
  /** Null when the member read failed. */
  members: SessionMember[] | null;
  membersTruncated: boolean;
  membersError: string | null;
  revision: string;
}

export interface SessionSettingsIO {
  /** Non-creating read. Null when Honcho has no active session by that id. */
  readSession(): Promise<{ is_active: boolean; configuration?: unknown } | null>;
  readMembers(): Promise<{ members: SessionMember[]; truncated: boolean }>;
  writeSession(configuration: Config): Promise<unknown>;
  writeMember(peerId: string, body: Partial<Record<MemberField, boolean>>): Promise<unknown>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Null when the session is gone or being deleted. */
export async function loadSessionSettings(io: SessionSettingsIO): Promise<SessionSettingsState | null> {
  const session = await io.readSession();
  if (!session || !session.is_active) return null;
  const configuration = plainObject(session.configuration) ?? {};
  let members: SessionMember[] | null = null;
  let membersTruncated = false;
  let membersError: string | null = null;
  try {
    const read = await io.readMembers();
    members = read.members;
    membersTruncated = read.truncated;
  } catch (error) {
    membersError = message(error);
  }
  return { configuration, members, membersTruncated, membersError, revision: settingsRevision(configuration, members) };
}

export type ChangeStatus = "saved" | "not_saved" | "not_sent" | "unknown";
export type SaveOutcome = "saved" | "partial" | "unknown" | "failed" | "stale" | "missing" | "rejected";

export interface SaveResult {
  outcome: SaveOutcome;
  message: string | null;
  changes: (SettingChange & { status: ChangeStatus })[];
  /** The settings as read back after the save (or as found when it was refused). */
  state: SessionSettingsState | null;
}

function currentValue(state: SessionSettingsState, change: SettingChange, options: SessionSettingsOptions): string | null {
  if (change.kind === "session") return sessionFormValues(seedSessionSettingsForm(state.configuration), options)[change.id]?.value ?? null;
  const member = state.members?.find((m) => m.id === change.peerId);
  if (!member) return null;
  return flagChoice(change.field === "observe_me" ? member.observeMe : member.observeOthers);
}

/**
 * Save reviewed changes: re-read, refuse if the session is gone or anything
 * changed since `revision`, write each change once (no retry, later writes
 * skipped after a failure), then read every value back.
 */
export async function saveSessionSettings(
  io: SessionSettingsIO,
  input: { revision: string; form: SessionSettingsForm; memberEdits: MemberEdits; options: SessionSettingsOptions },
): Promise<SaveResult> {
  const refused = (outcome: SaveOutcome, text: string, state: SessionSettingsState | null = null): SaveResult =>
    ({ outcome, message: text, changes: [], state });

  let state: SessionSettingsState | null;
  try {
    state = await loadSessionSettings(io);
  } catch (error) {
    return refused("failed", `Couldn't read the current settings: ${message(error)} Nothing was saved.`);
  }
  if (!state) return refused("missing", "This session no longer exists or is being deleted. Nothing was saved.");
  if (state.revision !== input.revision) {
    return refused("stale", "These settings changed after you opened them. Nothing was saved. Review the current values, then save again.", state);
  }

  let sessionPatch: Config;
  let changes: SettingChange[];
  try {
    sessionPatch = sessionConfigurationPatch(state.configuration, input.form, input.options);
    const hasMemberEdits = Object.values(input.memberEdits).some((fields) => Object.keys(fields).length > 0);
    if (hasMemberEdits && !state.members) throw new Error(`Couldn't read this session's members${state.membersError ? `: ${state.membersError}` : ""}.`);
    changes = [
      ...planSessionChanges(state.configuration, input.form, input.options),
      ...planMemberChanges(state.members ?? [], input.memberEdits),
    ];
  } catch (error) {
    return refused("rejected", `${message(error)} Nothing was saved.`, state);
  }
  if (!changes.length) return refused("rejected", "Nothing to save. These settings already have the values you chose.", state);

  const sent = new Set<string>();
  let writeError: string | null = null;
  try {
    const sessionChanges = changes.filter((change) => change.kind === "session");
    if (sessionChanges.length && Object.keys(sessionPatch).length) {
      sessionChanges.forEach((change) => sent.add(change.id));
      await io.writeSession(sessionPatch);
    }
    const byPeer = new Map<string, SettingChange[]>();
    for (const change of changes) {
      if (change.kind === "member") byPeer.set(change.peerId!, [...(byPeer.get(change.peerId!) ?? []), change]);
    }
    for (const [peerId, peerChanges] of byPeer) {
      peerChanges.forEach((change) => sent.add(change.id));
      await io.writeMember(peerId, Object.fromEntries(peerChanges.map((change) => [change.field!, change.to === "on"])));
    }
  } catch (error) {
    writeError = message(error);
  }

  let readback: SessionSettingsState | null = null;
  let readbackError: string | null = null;
  try {
    readback = await loadSessionSettings(io);
    if (!readback) readbackError = "The session disappeared during the save.";
  } catch (error) {
    readbackError = message(error);
  }

  const results = changes.map((change) => {
    const readable = readback && (change.kind === "session" || readback.members);
    const value = readable ? currentValue(readback!, change, input.options) : null;
    const status: ChangeStatus = value === change.to
      ? "saved"
      : !readable
        ? sent.has(change.id) ? "unknown" : "not_sent"
        : sent.has(change.id) ? "not_saved" : "not_sent";
    return { ...change, status };
  });
  const statuses = new Set(results.map((change) => change.status));
  const outcome: SaveOutcome = statuses.size === 1 && statuses.has("saved")
    ? "saved"
    : statuses.has("unknown") ? "unknown" : statuses.has("saved") ? "partial" : "failed";
  const text = outcome === "saved"
    ? null
    : [writeError, readbackError, outcome === "unknown" ? "Couldn't read the settings back, so some results are unknown." : null]
      .filter(Boolean).join(" ") || "Honcho didn't return the new values.";
  return { outcome, message: text, changes: results, state: readback };
}
