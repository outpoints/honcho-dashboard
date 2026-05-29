import type { NavItem } from "@/types/honcho";

export const NAV_ITEMS: NavItem[] = [
  { key: "fleet", label: "FLEET", icon: "monitor" },
  { key: "overview", label: "OVERVIEW", icon: "activity" },
  { key: "workspaces", label: "WORKSPACES", icon: "layers" },
  { key: "peers", label: "PEERS", icon: "users" },
  { key: "sessions", label: "SESSIONS", icon: "git-branch" },
  { key: "messages", label: "MESSAGES", icon: "message-square" },
  { key: "reasoning", label: "REASONING", icon: "brain" },
  { key: "context", label: "CONTEXT", icon: "file-search" },
  { key: "webhooks", label: "WEBHOOKS", icon: "webhook" },
  { key: "instance", label: "INSTANCE", icon: "server" },
  { key: "diagnostics", label: "DIAGNOSTICS", icon: "stethoscope" },
  { key: "integrations", label: "INTEGRATIONS", icon: "plug" },
  { key: "config", label: "CONFIG", icon: "settings" },
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
