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

export type AgentKey = "hermes" | "openclaw" | "claude-code" | "mcp";

/** Editorial reference content describing how an agent integrates with Honcho.
 * Static (not API-backed); live values (baseUrl) are injected at render. */
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
