import type {
  Conclusion,
  Peer,
  Session,
  Message,
  SessionContext,
  PeerContext,
  QueueStatus,
  SessionQueueStatus,
} from "@honcho-ai/sdk";
import type {
  ApiConclusion,
  ApiPeer,
  ApiSession,
  ApiMessage,
  ApiSessionContext,
  ApiPeerContext,
  ApiQueueStatus,
  ApiSessionQueueStatus,
} from "./types";

export function toApiConclusion(c: Conclusion): ApiConclusion {
  return {
    id: c.id,
    content: c.content,
    observer_id: c.observerId,
    observed_id: c.observedId,
    session_id: c.sessionId,
    level: c.level,
    source_ids: c.sourceIds,
    times_derived: c.timesDerived,
    created_at: c.createdAt,
    // SDK 2.8 reports null both when an older server omits the field and when
    // nothing was cited, so only a real list is passed on.
    ...(Array.isArray(c.sourceMessageIds) ? { source_message_ids: c.sourceMessageIds } : {}),
  };
}

/** SDK 2.7 exposes `uid` only when the server returned one (Honcho 3.4+). */
function withUid<T extends object>(value: T, uid: string | undefined): T & { uid?: string } {
  return typeof uid === "string" && uid ? { ...value, uid } : value;
}

export function toApiPeer(p: Peer): ApiPeer {
  return withUid({
    id: p.id,
    workspace_id: p.workspaceId,
    metadata: p.metadata ?? {},
    configuration: (p.configuration as Record<string, unknown> | undefined) ?? {},
    created_at: p.createdAt ?? "",
  }, p.uid);
}

/**
 * The SDK hands back a session's configuration in camelCase, with every known
 * section present (often undefined) and unknown keys dropped. Put it back in
 * the API's snake_case shape without the empty entries, so code that reads
 * stored settings (`sessionSettings.ts`) sees what Honcho stores. Legacy keys
 * (`deriver`, `skip_deriver`) are already gone; read the raw session for those.
 */
export function apiSessionConfiguration(config: unknown): Record<string, unknown> {
  const convert = (value: unknown): unknown => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined || entry === null) continue;
      out[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] = convert(entry);
    }
    return out;
  };
  const converted = convert(config);
  return converted && typeof converted === "object" ? (converted as Record<string, unknown>) : {};
}

export function toApiSession(s: Session): ApiSession {
  return withUid({
    id: s.id,
    workspace_id: s.workspaceId,
    metadata: s.metadata ?? {},
    configuration: apiSessionConfiguration(s.configuration),
    is_active: s.isActive ?? true,
    created_at: s.createdAt ?? "",
    // SDK 2.8 sets `scopes` only on sessions listed with `includeScopes`.
    ...(Array.isArray(s.scopes) ? { scopes: s.scopes } : {}),
  }, s.uid);
}

export function toApiMessage(m: Message): ApiMessage {
  return {
    id: m.id,
    workspace_id: m.workspaceId,
    session_id: m.sessionId,
    peer_id: m.peerId,
    content: m.content,
    token_count: m.tokenCount ?? 0,
    metadata: m.metadata ?? {},
    created_at: m.createdAt ?? "",
  };
}

export function toApiPeerContext(p: PeerContext): ApiPeerContext {
  return {
    peer_id: p.peerId,
    target_id: p.targetId,
    representation: p.representation,
    peer_card: p.peerCard,
  };
}

function toApiSessionQueueStatus(q: SessionQueueStatus): ApiSessionQueueStatus {
  return {
    session_id: q.sessionId,
    total_work_units: q.totalWorkUnits,
    completed_work_units: q.completedWorkUnits,
    in_progress_work_units: q.inProgressWorkUnits,
    pending_work_units: q.pendingWorkUnits,
  };
}

export function toApiQueueStatus(q: QueueStatus): ApiQueueStatus {
  const sessions: Record<string, ApiSessionQueueStatus> | undefined = q.sessions
    ? Object.fromEntries(
        Object.entries(q.sessions).map(([k, v]) => [k, toApiSessionQueueStatus(v)]),
      )
    : undefined;
  return {
    total_work_units: q.totalWorkUnits,
    completed_work_units: q.completedWorkUnits,
    in_progress_work_units: q.inProgressWorkUnits,
    pending_work_units: q.pendingWorkUnits,
    sessions,
  };
}

export function toApiSessionContext(s: SessionContext): ApiSessionContext {
  return {
    id: s.sessionId,
    messages: s.messages.map((m) => toApiMessage(m)),
    summary: s.summary
      ? {
          content: s.summary.content,
          message_id: s.summary.messageId,
          summary_type: s.summary.summaryType,
          created_at: s.summary.createdAt,
          token_count: s.summary.tokenCount,
        }
      : null,
    peer_representation: s.peerRepresentation ?? null,
    peer_card: s.peerCard ?? null,
  };
}
