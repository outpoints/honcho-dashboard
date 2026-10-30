export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

/**
 * Honcho 3.4+: the immutable identifier the server assigns. `id` stays the
 * client-chosen name. Absent on older servers, so render it only when present.
 */
type ServerUid = { uid?: string };

export interface ApiWorkspace extends ServerUid {
  id: string;
  metadata: Record<string, unknown>;
  configuration: Record<string, unknown>;
  created_at: string;
}

export interface ApiPeer extends ServerUid {
  id: string;
  workspace_id: string;
  metadata?: Record<string, unknown>;
  configuration?: Record<string, unknown>;
  created_at: string;
}

export interface ApiSession extends ServerUid {
  id: string;
  workspace_id: string;
  metadata?: Record<string, unknown>;
  configuration?: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  /** Honcho 3.5+: active scope names, only when listed with `include_scopes`. */
  scopes?: string[];
}

export interface ApiScope {
  id: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  /** Honcho 3.5+: active member sessions, only when listed with `include_session_count`. */
  session_count?: number;
}

export interface ApiMessage {
  id: string;
  workspace_id: string;
  session_id: string;
  peer_id: string;
  content: string;
  token_count: number;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export type ConclusionLevel = "explicit" | "deductive" | "inductive" | "contradiction";

export interface ApiConclusion {
  id: string;
  content: string;
  observer_id: string;
  observed_id: string;
  session_id?: string | null;
  level?: ConclusionLevel;
  /** Honcho 3.2+: parent conclusion IDs, not message IDs. Absent on 3.1. */
  source_ids?: string[] | null;
  /** Honcho 3.2+: number of independent derivations. Absent on 3.1. */
  times_derived?: number;
  /**
   * Honcho 3.5+: messages the deriver cited for an explicit conclusion, in
   * citation order. Null for derived levels and for conclusions written before
   * citations existed; absent on older servers.
   */
  source_message_ids?: string[] | null;
  created_at: string;
}

export interface ApiSessionQueueStatus {
  session_id?: string | null;
  total_work_units: number;
  completed_work_units: number;
  in_progress_work_units: number;
  pending_work_units: number;
}

export interface ApiQueueStatus {
  total_work_units: number;
  completed_work_units: number;
  in_progress_work_units: number;
  pending_work_units: number;
  sessions?: Record<string, ApiSessionQueueStatus> | null;
}

export interface ApiWebhookEndpoint {
  id: string;
  workspace_id?: string | null;
  url: string;
  created_at: string;
}

export interface ApiSummary {
  content: string;
  message_id: string;
  summary_type: string;
  created_at: string;
  token_count: number;
}

export interface ApiSessionSummaries {
  id: string;
  short_summary?: ApiSummary | null;
  long_summary?: ApiSummary | null;
}

export interface ApiSessionContext {
  id: string;
  messages: ApiMessage[];
  summary?: ApiSummary | null;
  peer_representation?: string | null;
  peer_card?: string[] | null;
}

export interface ApiPeerContext {
  peer_id: string;
  target_id: string;
  representation?: string | null;
  peer_card?: string[] | null;
}

export interface ApiPeerCardResponse {
  peer_card?: string[] | null;
}

export interface ChatBody {
  queries: string | string[];
  stream?: boolean;
  target?: string;
  session_id?: string;
}

export interface ChatResponse {
  content: string | null;
}

export class HonchoApiError extends Error {
  public readonly status: number;
  public readonly url: string;
  public readonly body?: unknown;

  constructor(
    status: number,
    url: string,
    message: string,
    body?: unknown,
  ) {
    super(message);
    this.status = status;
    this.url = url;
    this.body = body;
    this.name = "HonchoApiError";
  }
}
