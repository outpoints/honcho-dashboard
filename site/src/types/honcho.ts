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
