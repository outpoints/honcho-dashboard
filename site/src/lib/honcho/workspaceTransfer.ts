/**
 * Workspace export, import, and merge.
 *
 * Honcho has no export API, so an export is a paged read of the workspace's
 * peers, sessions (with per-peer session config and messages), conclusions,
 * and scopes. Import replays that snapshot into a target workspace on the
 * active instance. Merging is an import whose source is a live workspace.
 *
 * Rules the engine keeps:
 * - Reads never create. Peers that already exist in the target are reused and
 *   never modified; existing sessions are skipped or the import copy renamed.
 * - Message and conclusion writes are not idempotent. A rejected batch (4xx)
 *   was not written; an ambiguous failure (network, 5xx) stops the import,
 *   because retrying could duplicate data.
 * - The plan is re-checked against the target right before writing. If the
 *   target changed since the preview, nothing is written.
 *
 * The parser also reads Hombre (`hombre_export`) files, so its users can move
 * a workspace into this dashboard's instance.
 */

export const SNAPSHOT_FORMAT = "honcho-dashboard.workspace";
export const SNAPSHOT_VERSION = 1;

/** Honcho's RESOURCE_NAME_PATTERN for workspace, peer, session, and scope ids. */
const RESOURCE_ID = /^[A-Za-z0-9_-]{1,512}$/;
export const MESSAGE_BATCH_SIZE = 100;
/** Keep each batch body well under common proxy body limits. */
export const MESSAGE_BATCH_CHARS = 1_000_000;
export const CONCLUSION_BATCH_SIZE = 100;

type Json = Record<string, unknown>;

export interface SnapshotPeer {
  id: string;
  uid?: string;
  metadata: Json;
  configuration: Json;
  created_at?: string;
}

export interface SessionPeerConfig {
  observe_me?: boolean | null;
  observe_others?: boolean | null;
}

export interface SnapshotSessionPeer {
  id: string;
  config?: SessionPeerConfig;
}

export interface SnapshotMessage {
  id?: string;
  peer_id: string;
  content: string;
  metadata: Json;
  created_at?: string;
}

export interface SnapshotSession {
  id: string;
  uid?: string;
  metadata: Json;
  configuration: Json;
  is_active: boolean;
  created_at?: string;
  peers: SnapshotSessionPeer[];
  /** null when the export left messages out. */
  messages: SnapshotMessage[] | null;
}

export interface SnapshotConclusion {
  id?: string;
  content: string;
  observer_id: string;
  observed_id: string;
  session_id?: string | null;
  level?: string;
  source_ids?: string[] | null;
  times_derived?: number;
  created_at?: string;
}

export interface SnapshotScope {
  id: string;
  metadata: Json;
  sessions: string[];
}

export interface WorkspaceSnapshot {
  format: typeof SNAPSHOT_FORMAT;
  version: typeof SNAPSHOT_VERSION;
  exported_at: string;
  source: { kind: "honcho-dashboard" | "hombre"; honcho_version: string | null };
  workspace: { id: string; uid?: string; metadata: Json; configuration: Json; created_at?: string };
  peers: SnapshotPeer[];
  sessions: SnapshotSession[];
  /** null when not exported (an empty list means none exist). */
  conclusions: SnapshotConclusion[] | null;
  scopes: SnapshotScope[] | null;
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotError";
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function obj(value: unknown): Json {
  return isObject(value) ? value : {};
}

function optString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function requireId(value: unknown, what: string): string {
  if (typeof value !== "string" || !RESOURCE_ID.test(value)) {
    throw new SnapshotError(`${what} has an invalid id: ${JSON.stringify(value)?.slice(0, 80)}`);
  }
  return value;
}

/** Scope projection peers (`scope.<name>`) are internal; Honcho rebuilds them. */
export function isInternalPeerId(id: string): boolean {
  return !RESOURCE_ID.test(id);
}

function parsePeer(value: unknown): SnapshotPeer {
  const raw = obj(value);
  return {
    id: requireId(raw.id, "Peer"),
    ...(optString(raw.uid) ? { uid: optString(raw.uid) } : {}),
    metadata: obj(raw.metadata),
    configuration: obj(raw.configuration),
    ...(optString(raw.created_at) ? { created_at: optString(raw.created_at) } : {}),
  };
}

function parseMessage(value: unknown, sessionId: string): SnapshotMessage {
  const raw = obj(value);
  if (typeof raw.content !== "string") throw new SnapshotError(`A message in session ${sessionId} has no text content`);
  return {
    ...(optString(raw.id) ? { id: optString(raw.id) } : {}),
    peer_id: requireId(raw.peer_id, `A message in session ${sessionId}`),
    content: raw.content,
    metadata: obj(raw.metadata),
    ...(optString(raw.created_at) ? { created_at: optString(raw.created_at) } : {}),
  };
}

function parseSessionPeer(value: unknown): SnapshotSessionPeer | null {
  const raw = typeof value === "string" ? { id: value } : obj(value);
  if (typeof raw.id !== "string" || isInternalPeerId(raw.id)) return null;
  const config = obj(raw.config);
  const flags: SessionPeerConfig = {};
  for (const key of ["observe_me", "observe_others"] as const) {
    if (typeof config[key] === "boolean" || config[key] === null) flags[key] = config[key] as boolean | null;
  }
  return Object.keys(flags).length ? { id: raw.id, config: flags } : { id: raw.id };
}

function parseSession(value: unknown, messages: unknown): SnapshotSession {
  const raw = obj(value);
  const id = requireId(raw.id, "Session");
  const peers = Array.isArray(raw.peers)
    ? raw.peers.map(parseSessionPeer).filter((peer): peer is SnapshotSessionPeer => peer !== null)
    : [];
  return {
    id,
    ...(optString(raw.uid) ? { uid: optString(raw.uid) } : {}),
    metadata: obj(raw.metadata),
    configuration: obj(raw.configuration),
    is_active: raw.is_active !== false,
    ...(optString(raw.created_at) ? { created_at: optString(raw.created_at) } : {}),
    peers,
    messages: Array.isArray(messages) ? messages.map((m) => parseMessage(m, id)) : null,
  };
}

function parseConclusion(value: unknown): SnapshotConclusion | null {
  const raw = obj(value);
  if (typeof raw.content !== "string" || !raw.content.trim()) return null;
  if (typeof raw.observer_id !== "string" || typeof raw.observed_id !== "string") return null;
  return {
    ...(optString(raw.id) ? { id: optString(raw.id) } : {}),
    content: raw.content,
    observer_id: raw.observer_id,
    observed_id: raw.observed_id,
    session_id: typeof raw.session_id === "string" ? raw.session_id : null,
    ...(typeof raw.level === "string" ? { level: raw.level } : {}),
    ...(Array.isArray(raw.source_ids) ? { source_ids: raw.source_ids.filter((s): s is string => typeof s === "string") } : {}),
    ...(typeof raw.times_derived === "number" ? { times_derived: raw.times_derived } : {}),
    ...(optString(raw.created_at) ? { created_at: optString(raw.created_at) } : {}),
  };
}

function parseScope(value: unknown): SnapshotScope {
  const raw = obj(value);
  return {
    id: requireId(raw.id, "Scope"),
    metadata: obj(raw.metadata),
    sessions: Array.isArray(raw.sessions)
      ? raw.sessions.filter((id): id is string => typeof id === "string" && RESOURCE_ID.test(id))
      : [],
  };
}

function uniqueById<T extends { id: string }>(items: T[], what: string): T[] {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new SnapshotError(`${what} ${item.id} appears twice`);
    seen.add(item.id);
  }
  return items;
}

/** Accept this dashboard's snapshot or a Hombre export; reject anything else. */
export function parseWorkspaceSnapshot(value: unknown): WorkspaceSnapshot {
  if (!isObject(value)) throw new SnapshotError("The file is not a JSON object.");

  if (value.format === SNAPSHOT_FORMAT) {
    if (value.version !== SNAPSHOT_VERSION) {
      throw new SnapshotError(`Unsupported snapshot version ${String(value.version)}. This dashboard reads version ${SNAPSHOT_VERSION}.`);
    }
    const workspace = obj(value.workspace);
    const source = obj(value.source);
    if (!Array.isArray(value.peers) || !Array.isArray(value.sessions)) {
      throw new SnapshotError("The snapshot is missing its peers or sessions list.");
    }
    return {
      format: SNAPSHOT_FORMAT,
      version: SNAPSHOT_VERSION,
      exported_at: typeof value.exported_at === "string" ? value.exported_at : "",
      source: { kind: "honcho-dashboard", honcho_version: typeof source.honcho_version === "string" ? source.honcho_version : null },
      workspace: {
        id: requireId(workspace.id, "Workspace"),
        ...(optString(workspace.uid) ? { uid: optString(workspace.uid) } : {}),
        metadata: obj(workspace.metadata),
        configuration: obj(workspace.configuration),
        ...(optString(workspace.created_at) ? { created_at: optString(workspace.created_at) } : {}),
      },
      peers: uniqueById(value.peers.filter((p) => !isInternalPeerId(String(obj(p).id))).map(parsePeer), "Peer"),
      sessions: uniqueById(value.sessions.map((s) => parseSession(s, obj(s).messages)), "Session"),
      conclusions: Array.isArray(value.conclusions)
        ? value.conclusions.map(parseConclusion).filter((c): c is SnapshotConclusion => c !== null)
        : null,
      scopes: Array.isArray(value.scopes) ? uniqueById(value.scopes.map(parseScope), "Scope") : null,
    };
  }

  if (value.hombre_export === true) {
    const data = obj(value.data);
    const messages = obj(data.messages);
    if (!Array.isArray(data.peers) || !Array.isArray(data.sessions)) {
      throw new SnapshotError("The Hombre export is missing its peers or sessions list.");
    }
    return {
      format: SNAPSHOT_FORMAT,
      version: SNAPSHOT_VERSION,
      exported_at: typeof value.export_date === "string" ? value.export_date : "",
      source: { kind: "hombre", honcho_version: null },
      workspace: { id: requireId(value.workspace_id, "Workspace"), metadata: {}, configuration: {} },
      peers: uniqueById(data.peers.filter((p) => !isInternalPeerId(String(obj(p).id))).map(parsePeer), "Peer"),
      sessions: uniqueById(data.sessions.map((s) => {
        const id = String(obj(s).id);
        return parseSession(s, Object.hasOwn(messages, id) ? messages[id] : null);
      }), "Session"),
      conclusions: Array.isArray(data.conclusions)
        ? data.conclusions.map(parseConclusion).filter((c): c is SnapshotConclusion => c !== null)
        : null,
      scopes: null,
    };
  }

  throw new SnapshotError("Unrecognized file. Choose a workspace export from this dashboard or from Hombre.");
}

export function snapshotCounts(snapshot: WorkspaceSnapshot) {
  return {
    peers: snapshot.peers.length,
    sessions: snapshot.sessions.length,
    messages: snapshot.sessions.reduce((sum, s) => sum + (s.messages?.length ?? 0), 0),
    conclusions: snapshot.conclusions?.length ?? null,
    scopes: snapshot.scopes?.length ?? null,
  };
}

export function snapshotFileName(snapshot: WorkspaceSnapshot): string {
  const stamp = (snapshot.exported_at || new Date().toISOString()).replace(/[:.]/g, "-").slice(0, 19);
  return `honcho-workspace-${snapshot.workspace.id}-${stamp}.json`;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export type SessionConflict = "skip" | "rename";

export interface ImportOptions {
  sessionConflict: SessionConflict;
  messages: boolean;
  /** When false, messages carry `reasoning.enabled=false` so the deriver skips them. */
  derive: boolean;
  conclusions: boolean;
  scopes: boolean;
}

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  sessionConflict: "skip",
  messages: true,
  derive: true,
  conclusions: false,
  scopes: true,
};

export interface TargetState {
  exists: boolean;
  peers: Set<string>;
  sessions: Set<string>;
  /** null when the target cannot use named scopes (pre-3.1 or restricted key). */
  scopes: Set<string> | null;
}

export interface PlannedSession {
  sourceId: string;
  targetId: string;
  action: "create" | "skip";
  renamed: boolean;
  metadata: Json;
  configuration: Json;
  peers: SnapshotSessionPeer[];
  messages: SnapshotMessage[];
  scopes: string[];
}

export interface ImportPlan {
  workspaceId: string;
  createWorkspace: boolean;
  workspaceMetadata: Json;
  workspaceConfiguration: Json;
  peersToCreate: SnapshotPeer[];
  peersReused: string[];
  sessions: PlannedSession[];
  messageCount: number;
  messageBatches: number;
  derive: boolean;
  conclusions: { content: string; observer_id: string; observed_id: string; session_id: string | null }[];
  conclusionsSkipped: number;
  conclusionsDetached: number;
  scopesToCreate: SnapshotScope[];
  scopesReused: string[];
  warnings: string[];
}

/** Next free `<id>-imported[-n]` within Honcho's 512-character id limit. */
export function renamedSessionId(id: string, taken: Set<string>): string {
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "-imported" : `-imported-${n}`;
    const candidate = `${id.slice(0, 512 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Split by count and total characters; a single oversized message gets its own batch. */
export function batchMessages<T extends { content: string }>(messages: T[]): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let chars = 0;
  for (const message of messages) {
    if (current.length && (current.length >= MESSAGE_BATCH_SIZE || chars + message.content.length > MESSAGE_BATCH_CHARS)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(message);
    chars += message.content.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

export function planImport(
  snapshot: WorkspaceSnapshot,
  targetWorkspaceId: string,
  target: TargetState,
  options: ImportOptions,
): ImportPlan {
  const workspaceId = requireId(targetWorkspaceId.trim(), "Target workspace");
  const warnings: string[] = [];

  // Peers: every peer the snapshot defines or references.
  const peerDefs = new Map(snapshot.peers.map((peer) => [peer.id, peer]));
  const referenced = new Set<string>(snapshot.peers.map((peer) => peer.id));
  for (const session of snapshot.sessions) {
    for (const peer of session.peers) referenced.add(peer.id);
    if (options.messages) for (const message of session.messages ?? []) referenced.add(message.peer_id);
  }
  const peersToCreate: SnapshotPeer[] = [];
  const peersReused: string[] = [];
  for (const id of referenced) {
    if (target.peers.has(id)) peersReused.push(id);
    else peersToCreate.push(peerDefs.get(id) ?? { id, metadata: {}, configuration: {} });
  }
  const finalPeers = new Set([...target.peers, ...referenced]);

  // Sessions: create new ones, skip or rename conflicts.
  const taken = new Set([...target.sessions, ...snapshot.sessions.map((s) => s.id)]);
  const scopeAvailable = options.scopes && target.scopes !== null && snapshot.scopes !== null;
  const membership = new Map<string, string[]>();
  if (scopeAvailable) {
    for (const scope of snapshot.scopes ?? []) {
      for (const sessionId of scope.sessions) membership.set(sessionId, [...(membership.get(sessionId) ?? []), scope.id]);
    }
  }
  const sessions: PlannedSession[] = snapshot.sessions.map((session) => {
    const conflict = target.sessions.has(session.id);
    const action = conflict && options.sessionConflict === "skip" ? "skip" : "create";
    const targetId = conflict && action === "create" ? renamedSessionId(session.id, taken) : session.id;
    taken.add(targetId);
    return {
      sourceId: session.id,
      targetId,
      action,
      renamed: targetId !== session.id,
      metadata: session.metadata,
      configuration: session.configuration,
      peers: session.peers,
      messages: action === "create" && options.messages ? session.messages ?? [] : [],
      scopes: action === "create" ? membership.get(session.id) ?? [] : [],
    };
  });
  const created = sessions.filter((s) => s.action === "create");
  const skipped = sessions.length - created.length;
  if (skipped) warnings.push(`${skipped} session${skipped === 1 ? "" : "s"} already exist in the target and will be left untouched, including their messages.`);
  if (options.messages && snapshot.sessions.some((s) => s.messages === null)) {
    warnings.push("Some sessions were exported without messages; those sessions are created empty.");
  }
  const messageCount = created.reduce((sum, s) => sum + s.messages.length, 0);
  const messageBatches = created.reduce((sum, s) => sum + batchMessages(s.messages).length, 0);
  if (messageCount && options.derive) {
    warnings.push(`Honcho will queue ${messageCount.toLocaleString()} imported messages for reasoning, which calls your LLM provider.`);
  }

  // Conclusions: only between peers that will exist; reattach to created sessions.
  const sessionMap = new Map(sessions.map((s) => [s.sourceId, s]));
  const conclusions: ImportPlan["conclusions"] = [];
  let conclusionsSkipped = 0;
  let conclusionsDetached = 0;
  if (options.conclusions) {
    if (snapshot.conclusions === null) warnings.push("This file has no conclusions to import.");
    for (const conclusion of snapshot.conclusions ?? []) {
      if (!finalPeers.has(conclusion.observer_id) || !finalPeers.has(conclusion.observed_id)) {
        conclusionsSkipped++;
        continue;
      }
      let sessionId: string | null = null;
      if (conclusion.session_id) {
        const planned = sessionMap.get(conclusion.session_id);
        if (planned?.action === "create") sessionId = planned.targetId;
        else conclusionsDetached++;
      }
      conclusions.push({ content: conclusion.content, observer_id: conclusion.observer_id, observed_id: conclusion.observed_id, session_id: sessionId });
    }
    if (conclusions.length) {
      warnings.push("Imported conclusions get new IDs and are stored as explicit; their original level and derivation history are not kept.");
    }
    if (conclusions.length && messageCount && options.derive) {
      warnings.push("Deriving imported messages and importing conclusions will likely duplicate memory. Turn one of them off.");
    }
  }

  // Scopes.
  const scopesToCreate: SnapshotScope[] = [];
  const scopesReused: string[] = [];
  if (options.scopes && snapshot.scopes?.length) {
    if (target.scopes === null) {
      warnings.push(`The target cannot use named scopes, so ${snapshot.scopes.length} scope${snapshot.scopes.length === 1 ? " is" : "s are"} not imported.`);
    } else {
      for (const scope of snapshot.scopes) {
        if (target.scopes.has(scope.id)) scopesReused.push(scope.id);
        else scopesToCreate.push(scope);
      }
    }
  }

  return {
    workspaceId,
    createWorkspace: !target.exists,
    workspaceMetadata: snapshot.workspace.metadata,
    workspaceConfiguration: snapshot.workspace.configuration,
    peersToCreate,
    peersReused,
    sessions,
    messageCount,
    messageBatches,
    derive: options.derive,
    conclusions,
    conclusionsSkipped,
    conclusionsDetached,
    scopesToCreate,
    scopesReused,
    warnings,
  };
}

/** True when nothing in the target collides with what the plan will create. */
export function planStillValid(plan: ImportPlan, target: TargetState): string | null {
  if (plan.createWorkspace && target.exists) return "The target workspace was created since the preview.";
  if (!plan.createWorkspace && !target.exists) return "The target workspace no longer exists.";
  const collision = plan.sessions.find((s) => s.action === "create" && target.sessions.has(s.targetId));
  if (collision) return `Session ${collision.targetId} now exists in the target.`;
  return null;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface ExportSource {
  getWorkspace(): Promise<{ id: string; uid?: string; metadata: Json; configuration: Json; created_at?: string } | null>;
  listPeers(): Promise<{ id: string; uid?: string; metadata?: Json; configuration?: Json; created_at?: string }[]>;
  listSessions(): Promise<{ id: string; uid?: string; metadata?: Json; configuration?: Json; is_active: boolean; created_at?: string }[]>;
  listSessionPeers(sessionId: string): Promise<string[]>;
  sessionPeerConfig(sessionId: string, peerId: string): Promise<SessionPeerConfig | null>;
  listMessages(sessionId: string): Promise<{ id: string; peer_id: string; content: string; metadata?: Json; created_at?: string }[]>;
  listConclusions(): Promise<unknown[]>;
  /** Omit when the server cannot list named scopes. */
  listScopes?: () => Promise<SnapshotScope[]>;
}

export interface ExportOptions {
  messages: boolean;
  conclusions: boolean;
  scopes: boolean;
}

export interface TransferProgress {
  phase: string;
  done: number;
  total: number | null;
  detail?: string;
}

export class TransferAborted extends Error {
  constructor() {
    super("Stopped by the operator.");
    this.name = "TransferAborted";
  }
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new TransferAborted();
}

/** Run `work` over items with bounded concurrency, preserving order. */
async function mapLimit<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      checkAbort(signal);
      const index = next++;
      results[index] = await work(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function exportWorkspace(
  source: ExportSource,
  options: ExportOptions,
  hooks: { onProgress?: (progress: TransferProgress) => void; signal?: AbortSignal; honchoVersion?: string | null; now?: () => Date } = {},
): Promise<WorkspaceSnapshot> {
  const { onProgress, signal } = hooks;
  onProgress?.({ phase: "WORKSPACE", done: 0, total: 1 });
  const workspace = await source.getWorkspace();
  if (!workspace) throw new SnapshotError("The workspace was not found on this instance.");
  checkAbort(signal);

  onProgress?.({ phase: "PEERS", done: 0, total: null });
  const peers = (await source.listPeers())
    .filter((peer) => !isInternalPeerId(peer.id))
    .map((peer) => parsePeer(peer));
  onProgress?.({ phase: "PEERS", done: peers.length, total: peers.length });
  checkAbort(signal);

  const sessionList = await source.listSessions();
  let messageTotal = 0;
  const sessions = await mapLimit(sessionList, 4, async (session, index) => {
    const peerIds = (await source.listSessionPeers(session.id)).filter((id) => !isInternalPeerId(id));
    const sessionPeers = await Promise.all(peerIds.map(async (id) => {
      const config = await source.sessionPeerConfig(session.id, id).catch(() => null);
      return config ? { id, config } : { id };
    }));
    const messages = options.messages ? await source.listMessages(session.id) : null;
    messageTotal += messages?.length ?? 0;
    onProgress?.({ phase: "SESSIONS", done: index + 1, total: sessionList.length, detail: `${messageTotal.toLocaleString()} messages` });
    return parseSession({ ...session, peers: sessionPeers }, messages);
  }, signal);

  let conclusions: SnapshotConclusion[] | null = null;
  if (options.conclusions) {
    checkAbort(signal);
    onProgress?.({ phase: "CONCLUSIONS", done: 0, total: null });
    conclusions = (await source.listConclusions()).map(parseConclusion).filter((c): c is SnapshotConclusion => c !== null);
    onProgress?.({ phase: "CONCLUSIONS", done: conclusions.length, total: conclusions.length });
  }

  let scopes: SnapshotScope[] | null = null;
  if (options.scopes && source.listScopes) {
    checkAbort(signal);
    onProgress?.({ phase: "SCOPES", done: 0, total: null });
    scopes = await source.listScopes();
    onProgress?.({ phase: "SCOPES", done: scopes.length, total: scopes.length });
  }

  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    exported_at: (hooks.now?.() ?? new Date()).toISOString(),
    source: { kind: "honcho-dashboard", honcho_version: hooks.honchoVersion ?? null },
    workspace: {
      id: workspace.id,
      ...(workspace.uid ? { uid: workspace.uid } : {}),
      metadata: obj(workspace.metadata),
      configuration: obj(workspace.configuration),
      ...(workspace.created_at ? { created_at: workspace.created_at } : {}),
    },
    peers,
    sessions,
    conclusions,
    scopes,
  };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportTarget {
  createWorkspace(body: { id: string; metadata: Json; configuration: Json }): Promise<void>;
  createPeer(body: { id: string; metadata: Json; configuration: Json }): Promise<void>;
  createSession(body: { id: string; metadata: Json; configuration: Json; peers: Record<string, SessionPeerConfig> }): Promise<void>;
  createScope?(scopeId: string, metadata: Json): Promise<void>;
  addSessionsToScope?(scopeId: string, sessionIds: string[]): Promise<void>;
  addMessages(sessionId: string, messages: { peer_id: string; content: string; metadata: Json; created_at?: string; configuration?: Json }[]): Promise<number>;
  createConclusions(items: ImportPlan["conclusions"]): Promise<number>;
}

export interface ImportFailure {
  step: string;
  target: string;
  message: string;
}

export interface ImportResult {
  workspaceCreated: boolean;
  peersCreated: number;
  sessionsCreated: number;
  messagesWritten: number;
  conclusionsWritten: number;
  scopesCreated: number;
  failures: ImportFailure[];
  /** Set when the import stopped early: operator abort or an ambiguous write. */
  stopped: string | null;
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

/** A 4xx means Honcho rejected the request and wrote nothing. Anything else is unknown. */
export function isDefiniteRejection(error: unknown): boolean {
  const status = statusOf(error);
  return status !== undefined && status >= 400 && status < 500 && status !== 408;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runImport(
  plan: ImportPlan,
  target: ImportTarget,
  hooks: { onProgress?: (progress: TransferProgress) => void; signal?: AbortSignal } = {},
): Promise<ImportResult> {
  const { onProgress, signal } = hooks;
  const result: ImportResult = {
    workspaceCreated: false, peersCreated: 0, sessionsCreated: 0, messagesWritten: 0,
    conclusionsWritten: 0, scopesCreated: 0, failures: [], stopped: null,
  };
  const fail = (step: string, name: string, error: unknown) => result.failures.push({ step, target: name, message: describe(error) });

  try {
    if (plan.createWorkspace) {
      onProgress?.({ phase: "WORKSPACE", done: 0, total: 1 });
      await target.createWorkspace({ id: plan.workspaceId, metadata: plan.workspaceMetadata, configuration: plan.workspaceConfiguration });
      result.workspaceCreated = true;
    }

    // Get-or-create calls: a failure is recorded, and dependants are skipped.
    const failedPeers = new Set<string>();
    for (const [index, peer] of plan.peersToCreate.entries()) {
      checkAbort(signal);
      onProgress?.({ phase: "PEERS", done: index, total: plan.peersToCreate.length, detail: peer.id });
      try {
        await target.createPeer({ id: peer.id, metadata: peer.metadata, configuration: peer.configuration });
        result.peersCreated++;
      } catch (error) {
        failedPeers.add(peer.id);
        fail("peer", peer.id, error);
      }
    }

    const scopeReady = new Set(plan.scopesReused);
    for (const scope of plan.scopesToCreate) {
      checkAbort(signal);
      if (!target.createScope) break;
      try {
        await target.createScope(scope.id, scope.metadata);
        scopeReady.add(scope.id);
        result.scopesCreated++;
      } catch (error) {
        fail("scope", scope.id, error);
      }
    }

    const toCreate = plan.sessions.filter((s) => s.action === "create");
    let batchesDone = 0;
    for (const [index, session] of toCreate.entries()) {
      checkAbort(signal);
      onProgress?.({ phase: "SESSIONS", done: index, total: toCreate.length, detail: session.targetId });
      const missingPeer = [...session.peers.map((p) => p.id), ...session.messages.map((m) => m.peer_id)].find((id) => failedPeers.has(id));
      if (missingPeer) {
        fail("session", session.targetId, new Error(`Skipped: peer ${missingPeer} could not be created`));
        continue;
      }
      try {
        await target.createSession({
          id: session.targetId,
          metadata: session.metadata,
          configuration: session.configuration,
          peers: Object.fromEntries(session.peers.map((peer) => [peer.id, peer.config ?? {}])),
        });
        result.sessionsCreated++;
      } catch (error) {
        fail("session", session.targetId, error);
        continue;
      }
      // Join scopes before messages arrive so no backfill is needed.
      for (const scopeId of session.scopes) {
        if (!scopeReady.has(scopeId) || !target.addSessionsToScope) continue;
        try {
          await target.addSessionsToScope(scopeId, [session.targetId]);
        } catch (error) {
          fail("scope membership", `${scopeId} ← ${session.targetId}`, error);
        }
      }
      const batches = batchMessages(session.messages);
      for (const [batchIndex, batch] of batches.entries()) {
        checkAbort(signal);
        onProgress?.({ phase: "MESSAGES", done: batchesDone, total: plan.messageBatches, detail: `${session.targetId} · batch ${batchIndex + 1}/${batches.length}` });
        try {
          result.messagesWritten += await target.addMessages(session.targetId, batch.map((message) => ({
            peer_id: message.peer_id,
            content: message.content,
            metadata: message.metadata,
            ...(message.created_at ? { created_at: message.created_at } : {}),
            ...(plan.derive ? {} : { configuration: { reasoning: { enabled: false } } }),
          })));
          batchesDone++;
        } catch (error) {
          if (isDefiniteRejection(error)) {
            fail("messages", `${session.targetId} batch ${batchIndex + 1}`, error);
            // Keep message order: drop this session's remaining batches.
            break;
          }
          fail("messages", `${session.targetId} batch ${batchIndex + 1}`, error);
          result.stopped = `Stopped: the outcome of ${session.targetId} batch ${batchIndex + 1} is unknown. Check that session before running again; a re-run could duplicate messages.`;
          return result;
        }
      }
    }

    const conclusionBatches: ImportPlan["conclusions"][] = [];
    for (let i = 0; i < plan.conclusions.length; i += CONCLUSION_BATCH_SIZE) {
      conclusionBatches.push(plan.conclusions.slice(i, i + CONCLUSION_BATCH_SIZE));
    }
    for (const [index, batch] of conclusionBatches.entries()) {
      checkAbort(signal);
      onProgress?.({ phase: "CONCLUSIONS", done: index, total: conclusionBatches.length });
      try {
        result.conclusionsWritten += await target.createConclusions(batch);
      } catch (error) {
        fail("conclusions", `batch ${index + 1}`, error);
        if (!isDefiniteRejection(error)) {
          result.stopped = `Stopped: the outcome of conclusion batch ${index + 1} is unknown. A re-run could duplicate conclusions.`;
          return result;
        }
      }
    }
    onProgress?.({ phase: "DONE", done: 1, total: 1 });
  } catch (error) {
    if (error instanceof TransferAborted) {
      result.stopped = "Stopped by the operator. Everything listed as written is on the server.";
      return result;
    }
    fail("import", plan.workspaceId, error);
    result.stopped = `Stopped: ${describe(error)}`;
  }
  return result;
}
