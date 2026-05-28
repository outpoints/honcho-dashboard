import type {
  Peer,
  Session,
  Message,
  SessionContext,
  PeerContext,
  QueueStatus,
  SessionQueueStatus,
} from "@honcho-ai/sdk";
import type {
  ApiPeer,
  ApiSession,
  ApiMessage,
  ApiSessionContext,
  ApiPeerContext,
  ApiQueueStatus,
  ApiSessionQueueStatus,
} from "./types";

export function toApiPeer(p: Peer): ApiPeer {
  return {
    id: p.id,
    workspace_id: p.workspaceId,
    metadata: p.metadata ?? {},
    configuration: (p.configuration as Record<string, unknown> | undefined) ?? {},
    created_at: p.createdAt ?? "",
  };
}

export function toApiSession(s: Session): ApiSession {
  return {
    id: s.id,
    workspace_id: s.workspaceId,
    metadata: s.metadata ?? {},
    configuration: (s.configuration as Record<string, unknown> | undefined) ?? {},
    is_active: s.isActive ?? true,
    created_at: s.createdAt ?? "",
  };
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
