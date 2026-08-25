import type { NavItem } from "@/types/honcho";

export const NAV_ITEMS: NavItem[] = [
  // Operator dashboards — instance + queue health at a glance.
  { key: "fleet", label: "FLEET", icon: "monitor", section: "monitor" },
  { key: "overview", label: "OVERVIEW", icon: "activity", section: "monitor" },
  { key: "instance", label: "INSTANCE", icon: "server", section: "monitor" },
  { key: "diagnostics", label: "DIAGNOSTICS", icon: "stethoscope", section: "monitor" },
  // Browse the workspace's entities.
  { key: "workspaces", label: "WORKSPACES", icon: "layers", section: "explore" },
  { key: "peers", label: "PEERS", icon: "users", section: "explore" },
  { key: "sessions", label: "SESSIONS", icon: "git-branch", section: "explore" },
  { key: "messages", label: "MESSAGES", icon: "message-square", section: "explore" },
  { key: "search", label: "SEARCH", icon: "search", section: "explore" },
  { key: "conclusions", label: "CONCLUSIONS", icon: "sparkles", section: "explore" },
  // The memory pipeline: derive → assemble → query.
  { key: "reasoning", label: "REASONING", icon: "brain", section: "memory" },
  { key: "context", label: "CONTEXT", icon: "file-search", section: "memory" },
  { key: "chat", label: "CHAT", icon: "bot", section: "memory" },
  // Configuration & integration.
  { key: "webhooks", label: "WEBHOOKS", icon: "webhook", section: "setup" },
  { key: "integrations", label: "INTEGRATIONS", icon: "plug", section: "setup" },
  { key: "config", label: "CONFIG", icon: "settings", section: "setup" },
];

export const ALL_WEBHOOK_EVENTS = [
  "message.created",
  "message.updated",
  "session.created",
  "session.updated",
  "peer.created",
  "peer.updated",
  "reasoning.completed",
  "reasoning.failed",
] as const;
