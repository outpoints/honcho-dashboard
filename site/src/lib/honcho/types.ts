export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

export interface ApiWorkspace {
  id: string;
  metadata: Record<string, unknown>;
  configuration: Record<string, unknown>;
  created_at: string;
}

export interface ApiPeer {
  id: string;
  workspace_id: string;
  metadata?: Record<string, unknown>;
  configuration?: Record<string, unknown>;
  created_at: string;
}

export interface ApiSession {
  id: string;
  workspace_id: string;
  metadata?: Record<string, unknown>;
  configuration?: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

export interface ApiScope {
  id: string;
  metadata?: Record<string, unknown>;
  created_at: string;
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
