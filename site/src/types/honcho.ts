export type RouteKey =
  | "overview"
  | "workspaces"
  | "peers"
  | "sessions"
  | "messages"
  | "reasoning"
  | "context"
  | "webhooks"
  | "instance"
  | "diagnostics"
  | "integrations"
  | "config";

export interface NavItem {
  key: RouteKey;
  label: string;
  icon: string;
  badge?: number;
}

export interface Workspace {
  id: string;
  name: string;
  peers: number;
  sessions: number;
  messages: number;
  conclusions: number;
  reasoning: boolean;
  peerCard: "use+create" | "off";
  summary: string;
  dream: boolean;
  llmProvider: "openai" | "anthropic" | "gemini";
  llmModel: string;
  createdAt: string;
}

export interface Peer {
  id: string;
  name: string;
  workspace: string;
  type: "user" | "agent";
  reasoning: boolean;
  sessions: number;
  messages: number;
  conclusions: number;
  lastActive: string;
}

export type SessionStatus = "active" | "idle" | "archived";

export interface Session {
  id: string;
  workspace: string;
  status: SessionStatus;
  hasSummary: boolean;
  peers: string[];
  messageCount: number;
  tokens: number;
  lastMessage: string;
  config: {
    reasoning: boolean;
    peerCard: string;
    summary: string;
    dream: boolean;
  };
  createdAt: string;
}

export type MessageStatus = "completed" | "skipped" | "processing";

export interface Message {
  id: string;
  peer: string;
  peerType: "user" | "agent";
  session: string;
  timestamp: string;
  body: string;
  status: MessageStatus;
  tokens: number;
}

export type ReasoningType =
  | "deductive"
  | "explicit"
  | "summary"
  | "peer_card"
  | "inductive"
  | "abductive"
  | "consolidation";

export type ReasoningStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export interface ReasoningTask {
  id: string;
  type: ReasoningType;
  peer: string;
  messageCount: number;
  tokens?: number;
  timestamp: string;
  status: ReasoningStatus;
  error?: string;
}

export interface ContextLayer {
  id: "peer_card" | "conclusions" | "summaries" | "messages";
  label: string;
  description: string;
  tokens: number;
  items: number;
  enabled: boolean;
  color: string;
}

export type WebhookEvent =
  | "message.created"
  | "message.updated"
  | "session.created"
  | "session.updated"
  | "peer.created"
  | "peer.updated"
  | "reasoning.completed"
  | "reasoning.failed";

export interface Webhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  failures: number;
  lastDelivery: string;
  createdAt: string;
}

export type HealthStatus = "healthy" | "warning" | "error";

export interface ServiceStatus {
  id: string;
  name: string;
  icon: string;
  status: HealthStatus;
  detail: string;
}

export interface HealthCheck {
  id: string;
  name: string;
  category: "database" | "api" | "deriver" | "llm" | "cache" | "general" | "auth";
  status: HealthStatus;
  description: string;
  detail?: string;
  timing?: string;
  timestamp: string;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
}

export interface TroubleshootingItem {
  id: string;
  title: string;
  category: "startup" | "runtime" | "database" | "llm" | "docker" | "cache";
  severity: "error" | "warning";
  description: string;
  details?: string[];
}

export type AgentKey = "hermes" | "openclaw" | "claude-code" | "mcp";

export interface IntegrationAgent {
  key: AgentKey;
  name: string;
  role: string;
  description: string;
  features: string[];
  themeColor: string;
  avatar: string;
  purpose: string;
  whereHonchoFits: string;
  mcpCompatibility: string;
  configuration: { key: string; value: string }[];
  tools: { name: string; description: string; type: "fast" | "llm" }[];
  setupSteps: string[];
  configOptions: { key: string; current: string; options: string }[];
  selfHosted: {
    endpoint: string;
    auth: string;
    protocol: string;
    apiKey: string;
    setupNotes: string[];
    caveats: string[];
    configExample: string;
  };
}
