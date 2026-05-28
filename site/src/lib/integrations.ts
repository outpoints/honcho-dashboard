import type { IntegrationAgent } from "@/types/honcho";

/**
 * Editorial reference content for the Integrations page — preserved verbatim
 * from the original scaffold (credit: nodaylight). This is static documentation
 * about each agent integration, not API data. Live values (the configured
 * Honcho base URL) are injected at render time in IntegrationsPage.
 */
export const INTEGRATIONS: IntegrationAgent[] = [
  {
    key: "hermes",
    name: "Hermes Agent",
    role: "NOUS RESEARCH AI AGENT",
    description: "Open-source AI agent with tool-calling, terminal access, and multi-platform deployment.",
    features: ["Dual-peer architecture", "Multi-platform", "Tool calling", "Skills system"],
    themeColor: "blue",
    avatar: "/images/avatar-hermes.svg",
    purpose: "Persistent cross-session memory and user modeling across Telegram, Discord, Slack, and WhatsApp.",
    whereHonchoFits:
      "Long-term memory layer alongside built-in memory files. Provides prompt-time context injection, cross-session continuity, and durable writeback.",
    mcpCompatibility: "Native plugin system, not MCP. Tools exposed directly to agent.",
    configuration: [
      { key: "recallMode", value: "hybrid" },
      { key: "writeFrequency", value: "async" },
      { key: "sessionStrategy", value: "per-directory" },
    ],
    tools: [
      { name: "honcho_profile", description: "Fast peer card retrieval (no LLM)", type: "fast" },
      { name: "honcho_search", description: "Semantic search over memory", type: "fast" },
      { name: "honcho_context", description: "Dialectic Q&A synthesis", type: "llm" },
      { name: "honcho_conclude", description: "Write durable facts to memory", type: "fast" },
    ],
    setupSteps: [
      "Run Honcho locally (Self-Hosting Guide)",
      'hermes memory setup → select "honcho"',
      "Enter http://localhost:8000 as base URL",
      "Verify: hermes memory status",
    ],
    configOptions: [
      { key: "recallMode", current: "hybrid", options: "hybrid | context | tools" },
      { key: "writeFrequency", current: "async", options: "async | turn | session | N" },
      { key: "sessionStrategy", current: "per-directory", options: "per-directory | per-repo | global" },
      { key: "dialecticReasoningLevel", current: "low", options: "minimal → max" },
    ],
    selfHosted: {
      endpoint: "http://localhost:8000",
      auth: "Optional",
      protocol: "Native Plugin",
      apiKey: "Not needed",
      setupNotes: [
        "Config: ~/.hermes/honcho.json or ~/.honcho/config.json",
        "Set baseUrl, workspace, aiPeer, peerName",
        "Community: elkimek/honcho-self-hosted for quick setup",
      ],
      caveats: [
        "Dual-peer: both user and AI have representations",
        "Both injected into system prompt",
        "Deriver must be running for reasoning",
      ],
      configExample: `{
  "baseUrl": "http://localhost:8000",
  "hosts": {
    "hermes": {
      "enabled": true,
      "aiPeer": "hermes",
      "peerName": "your-name",
      "workspace": "hermes"
    }
  }
}`,
    },
  },
  {
    key: "openclaw",
    name: "OpenClaw",
    role: "MULTI-CHANNEL AI AGENT",
    description: "General AI agent performing actions across WhatsApp, Telegram, Discord, Slack, and more.",
    features: ["Multi-agent support", "Legacy migration", "QMD integration", "Platform metadata stripping"],
    themeColor: "red",
    avatar: "/images/avatar-openclaw.svg",
    purpose: "AI-native memory across every channel with persistent user modeling and cross-session context.",
    whereHonchoFits:
      "Plugin observing messages after every AI turn, building user/agent representations, providing tool-based context access.",
    mcpCompatibility: "Plugin system with QMD integration for local file search alongside Honcho.",
    configuration: [
      { key: "apiKey", value: "—" },
      { key: "workspaceId", value: "openclaw" },
      { key: "baseUrl", value: "https://api.honcho.dev" },
    ],
    tools: [
      { name: "memory_recall", description: "Retrieve relevant prior memories", type: "fast" },
      { name: "user_profile", description: "Cross-channel user profile", type: "fast" },
      { name: "channel_history", description: "Per-channel conversation history", type: "fast" },
      { name: "infer_intent", description: "Detect user intent from context", type: "llm" },
    ],
    setupSteps: [
      "Install OpenClaw from registry",
      "Add honcho plugin: openclaw plugins add honcho",
      "Configure baseUrl + workspace",
      "Restart all channel adapters",
    ],
    configOptions: [
      { key: "platforms", current: "all", options: "whatsapp | telegram | discord | slack | all" },
      { key: "stripMetadata", current: "true", options: "true | false" },
      { key: "qmdIntegration", current: "enabled", options: "enabled | disabled" },
    ],
    selfHosted: {
      endpoint: "http://localhost:8000",
      auth: "API Key (optional)",
      protocol: "HTTP REST",
      apiKey: "Optional",
      setupNotes: [
        "Edit openclaw.yaml: add honcho block",
        "Set workspace per channel for isolation",
        "Use QMD for local file search alongside Honcho",
      ],
      caveats: [
        "Each channel can have its own workspace",
        "QMD and Honcho run in parallel for hybrid recall",
        "Restart per channel after config changes",
      ],
      configExample: `honcho:
  baseUrl: http://localhost:8000
  workspace: openclaw
  channels:
    whatsapp: { workspace: whatsapp }
    telegram: { workspace: telegram }`,
    },
  },
  {
    key: "claude-code",
    name: "Claude Code",
    role: "ANTHROPIC CODING ASSISTANT",
    description: "Claude in a coding environment with persistent memory surviving context wipes and restarts.",
    features: ["Git awareness", "Cross-tool linking", "Team support", "Interview skill"],
    themeColor: "orange",
    avatar: "/images/avatar-claude.svg",
    purpose: "Long-term memory across projects, preferences, and working context persisting across all sessions.",
    whereHonchoFits:
      "Plugin providing persistent memory, git awareness (branches, commits), flexible session mapping, and AI self-awareness.",
    mcpCompatibility: "Full MCP support. Can also use standalone MCP server. Plugin provides deeper git integration.",
    configuration: [
      { key: "sessionStrategy", value: "per-directory" },
      { key: "saveMessages", value: "true" },
      { key: "contextRefresh.messageThreshold", value: "30" },
    ],
    tools: [
      { name: "recall_project", description: "Recall facts about current repo", type: "fast" },
      { name: "recall_preferences", description: "User coding style and preferences", type: "fast" },
      { name: "git_context", description: "Branches, commits, blame integration", type: "fast" },
      { name: "summarize_session", description: "Persist session takeaways", type: "llm" },
    ],
    setupSteps: [
      "Install plugin: claude code plugins install honcho",
      "Set HONCHO_BASE_URL=http://localhost:8000",
      "Choose session strategy in settings.json",
      "Verify: /honcho status",
    ],
    configOptions: [
      { key: "sessionStrategy", current: "per-directory", options: "per-directory | per-repo | global" },
      { key: "saveMessages", current: "true", options: "true | false" },
      { key: "contextRefresh.messageThreshold", current: "30", options: "1..N (default 30)" },
      { key: "gitAwareness", current: "enabled", options: "enabled | disabled" },
    ],
    selfHosted: {
      endpoint: "http://localhost:8000",
      auth: "Optional",
      protocol: "MCP + Plugin",
      apiKey: "Not needed",
      setupNotes: [
        "Plugin path: ~/.config/claude-code/plugins/honcho/",
        "Configure session strategy per workspace",
        "Git hooks installed automatically on first run",
      ],
      caveats: [
        "Plugin can coexist with MCP server",
        "Per-directory sessions are recommended for monorepos",
        "Context refresh consumes background reasoning queue",
      ],
      configExample: `{
  "plugins": {
    "honcho": {
      "baseUrl": "http://localhost:8000",
      "sessionStrategy": "per-directory",
      "saveMessages": true,
      "contextRefresh": { "messageThreshold": 30 }
    }
  }
}`,
    },
  },
  {
    key: "mcp",
    name: "MCP Server",
    role: "UNIVERSAL PROTOCOL",
    description: "Model Context Protocol server giving any MCP-compatible tool persistent memory.",
    features: ["Universal compatibility", "HTTP & stdio", "All Honcho tools", "Header-based config"],
    themeColor: "blue",
    avatar: "/images/avatar-mcp.svg",
    purpose: "Persistent memory and personalization for Claude Desktop, Cursor, Windsurf, VS Code, Cline, Zed, Codex.",
    whereHonchoFits:
      "Hosted MCP server exposing full Honcho API as MCP tools. Any compatible client gains memory capabilities.",
    mcpCompatibility:
      "Native MCP server. HTTP direct (Cursor, Windsurf, VS Code, Cline, Zed) or stdio via mcp-remote (Claude Desktop, Codex).",
    configuration: [
      { key: "Authorization", value: "required" },
      { key: "X-Honcho-User-Name", value: "required" },
      { key: "X-Honcho-Assistant-Name", value: "Assistant" },
    ],
    tools: [
      { name: "honcho_remember", description: "Store new facts", type: "fast" },
      { name: "honcho_recall", description: "Recall relevant facts", type: "fast" },
      { name: "honcho_search", description: "Semantic search", type: "fast" },
      { name: "honcho_synthesize", description: "Dialectic context synthesis", type: "llm" },
    ],
    setupSteps: [
      "Add MCP server URL to client config",
      "Set required headers (Authorization, user, assistant)",
      "For stdio clients, install mcp-remote",
      "Verify via tool list in client",
    ],
    configOptions: [
      { key: "Transport", current: "HTTP", options: "HTTP | stdio (via mcp-remote)" },
      { key: "Reasoning level", current: "low", options: "minimal → max" },
      { key: "X-Honcho-User-Name", current: "required", options: "string" },
      { key: "X-Honcho-Assistant-Name", current: "Assistant", options: "string" },
    ],
    selfHosted: {
      endpoint: "http://localhost:8000/mcp",
      auth: "Bearer token (Authorization)",
      protocol: "MCP HTTP / stdio",
      apiKey: "Per client",
      setupNotes: [
        "MCP HTTP endpoint: /mcp",
        "Stdio: install mcp-remote and proxy to /mcp",
        "Use unique X-Honcho-User-Name per real user",
      ],
      caveats: [
        "Auth tokens are required even in self-hosted mode",
        "Claude Desktop only supports stdio (use mcp-remote)",
        "Be sure to set assistant name for proper peer pairing",
      ],
      configExample: `{
  "mcpServers": {
    "honcho": {
      "url": "http://localhost:8000/mcp",
      "headers": {
        "Authorization": "Bearer dev-token",
        "X-Honcho-User-Name": "your-name",
        "X-Honcho-Assistant-Name": "Assistant"
      }
    }
  }
}`,
    },
  },
];

export const SELF_HOSTED_REQUIREMENTS = [
  { name: "Honcho API Server", detail: "Port 8000", icon: "server" },
  { name: "Deriver Process", detail: "Background reasoning", icon: "brain" },
  { name: "PostgreSQL + pgvector", detail: "Data & embeddings", icon: "database" },
  { name: "LLM API Keys", detail: "Gemini, Anthropic, OpenAI", icon: "key" },
];

export const QUICK_LINKS = ["Self-Hosting Guide", "Troubleshooting", "Architecture", "API Reference"];
