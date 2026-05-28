import type {
  Workspace,
  Peer,
  Session,
  Message,
  ReasoningTask,
  ContextLayer,
  Webhook,
  ServiceStatus,
  HealthCheck,
  LogEntry,
  TroubleshootingItem,
  IntegrationAgent,
  NavItem,
} from "@/types/honcho";

export const NAV_ITEMS: NavItem[] = [
  { key: "overview", label: "OVERVIEW", icon: "activity" },
  { key: "workspaces", label: "WORKSPACES", icon: "layers" },
  { key: "peers", label: "PEERS", icon: "users" },
  { key: "sessions", label: "SESSIONS", icon: "git-branch" },
  { key: "messages", label: "MESSAGES", icon: "message-square" },
  { key: "reasoning", label: "REASONING", icon: "brain", badge: 4 },
  { key: "context", label: "CONTEXT", icon: "file-search" },
  { key: "webhooks", label: "WEBHOOKS", icon: "webhook" },
  { key: "instance", label: "INSTANCE", icon: "server" },
  { key: "diagnostics", label: "DIAGNOSTICS", icon: "stethoscope" },
  { key: "integrations", label: "INTEGRATIONS", icon: "plug" },
  { key: "config", label: "CONFIG", icon: "settings" },
];

export const WORKSPACES: Workspace[] = [
  {
    id: "ws_prod_001",
    name: "production",
    peers: 1247,
    sessions: 8934,
    messages: 245678,
    conclusions: 89234,
    reasoning: true,
    peerCard: "use+create",
    summary: "every 20",
    dream: true,
    llmProvider: "openai",
    llmModel: "gpt-5.4",
    createdAt: "1/15/2026",
  },
  {
    id: "ws_stag_002",
    name: "staging",
    peers: 45,
    sessions: 234,
    messages: 5678,
    conclusions: 1234,
    reasoning: true,
    peerCard: "use+create",
    summary: "every 20",
    dream: true,
    llmProvider: "anthropic",
    llmModel: "sonnet-4.6",
    createdAt: "2/1/2026",
  },
  {
    id: "ws_dev_003",
    name: "development",
    peers: 12,
    sessions: 89,
    messages: 1234,
    conclusions: 0,
    reasoning: false,
    peerCard: "off",
    summary: "off",
    dream: false,
    llmProvider: "openai",
    llmModel: "gpt-5.4-mini",
    createdAt: "3/10/2026",
  },
];

export const PEERS: Peer[] = [
  {
    id: "p_alice",
    name: "alice",
    workspace: "production",
    type: "user",
    reasoning: true,
    sessions: 12,
    messages: 347,
    conclusions: 89,
    lastActive: "1/20/2026, 6:32:00 AM",
  },
  {
    id: "p_bob",
    name: "bob",
    workspace: "production",
    type: "user",
    reasoning: true,
    sessions: 8,
    messages: 156,
    conclusions: 34,
    lastActive: "1/20/2026, 5:45:00 AM",
  },
  {
    id: "p_support_bot",
    name: "support_bot",
    workspace: "production",
    type: "agent",
    reasoning: false,
    sessions: 156,
    messages: 2341,
    conclusions: 0,
    lastActive: "1/20/2026, 6:35:00 AM",
  },
  {
    id: "p_charlie",
    name: "charlie",
    workspace: "staging",
    type: "user",
    reasoning: true,
    sessions: 5,
    messages: 78,
    conclusions: 23,
    lastActive: "1/20/2026, 4:00:00 AM",
  },
  {
    id: "p_assistant",
    name: "assistant",
    workspace: "production",
    type: "agent",
    reasoning: false,
    sessions: 234,
    messages: 4567,
    conclusions: 0,
    lastActive: "1/20/2026, 6:36:00 AM",
  },
];

export const SESSIONS: Session[] = [
  {
    id: "sess_7f3a2b01",
    workspace: "production",
    status: "active",
    hasSummary: true,
    peers: ["alice", "support_bot"],
    messageCount: 47,
    tokens: 12400,
    lastMessage: "1/20/2026, 6:32:00 AM",
    config: {
      reasoning: true,
      peerCard: "use+create",
      summary: "every 20 msgs",
      dream: true,
    },
    createdAt: "1/20/2026",
  },
  {
    id: "sess_8e4c1d02",
    workspace: "production",
    status: "active",
    hasSummary: false,
    peers: ["bob", "assistant"],
    messageCount: 23,
    tokens: 8200,
    lastMessage: "1/20/2026, 6:28:00 AM",
    config: {
      reasoning: true,
      peerCard: "use+create",
      summary: "every 20 msgs",
      dream: true,
    },
    createdAt: "1/20/2026",
  },
  {
    id: "sess_9d5b2e03",
    workspace: "staging",
    status: "idle",
    hasSummary: true,
    peers: ["charlie"],
    messageCount: 156,
    tokens: 45100,
    lastMessage: "1/20/2026, 4:00:00 AM",
    config: {
      reasoning: true,
      peerCard: "use+create",
      summary: "every 20 msgs",
      dream: true,
    },
    createdAt: "1/19/2026",
  },
  {
    id: "sess_0c6a3f04",
    workspace: "production",
    status: "active",
    hasSummary: true,
    peers: ["alice", "bob", "assistant"],
    messageCount: 89,
    tokens: 28700,
    lastMessage: "1/20/2026, 6:20:00 AM",
    config: {
      reasoning: true,
      peerCard: "use+create",
      summary: "every 20 msgs",
      dream: true,
    },
    createdAt: "1/20/2026",
  },
  {
    id: "sess_1b7d4g05",
    workspace: "development",
    status: "archived",
    hasSummary: false,
    peers: ["dev_user"],
    messageCount: 12,
    tokens: 3800,
    lastMessage: "1/15/2026, 2:00:00 AM",
    config: {
      reasoning: false,
      peerCard: "off",
      summary: "off",
      dream: false,
    },
    createdAt: "1/15/2026",
  },
];

export const MESSAGES: Message[] = [
  {
    id: "msg_004",
    peer: "support_bot",
    peerType: "agent",
    session: "sess_7f3a2b01",
    timestamp: "1/20/2026, 6:31:30 AM",
    body: "I see a few optimization opportunities. First, make sure you have an index on orders.created_at and orders.customer_id. Second, avoid SELECT * - only select the columns you need.",
    status: "skipped",
    tokens: 45,
  },
  {
    id: "msg_003",
    peer: "alice",
    peerType: "user",
    session: "sess_7f3a2b01",
    timestamp: "1/20/2026, 6:31:00 AM",
    body: "I'm using PostgreSQL. Here's the query: SELECT * FROM orders JOIN customers ON orders.customer_id = customers.id WHERE orders.created_at > NOW() - INTERVAL '30 days' ORDER BY orders.total DESC LIMIT 100;",
    status: "completed",
    tokens: 52,
  },
  {
    id: "msg_002",
    peer: "support_bot",
    peerType: "agent",
    session: "sess_7f3a2b01",
    timestamp: "1/20/2026, 6:30:15 AM",
    body: "I'd be happy to help! Could you share the query and the table schema? Also, what database are you using?",
    status: "skipped",
    tokens: 24,
  },
  {
    id: "msg_001",
    peer: "alice",
    peerType: "user",
    session: "sess_7f3a2b01",
    timestamp: "1/20/2026, 6:30:00 AM",
    body: "Can you help me optimize this database query? It's taking too long to execute.",
    status: "completed",
    tokens: 18,
  },
  {
    id: "msg_b001",
    peer: "bob",
    peerType: "user",
    session: "sess_8e4c1d02",
    timestamp: "1/20/2026, 6:28:00 AM",
    body: "What's the best practice for handling rate limits in our API?",
    status: "processing",
    tokens: 14,
  },
  {
    id: "msg_b002",
    peer: "assistant",
    peerType: "agent",
    session: "sess_8e4c1d02",
    timestamp: "1/20/2026, 6:27:30 AM",
    body: "Use token-bucket per IP, exponential backoff on retries, and surface a Retry-After header on 429 responses.",
    status: "completed",
    tokens: 28,
  },
];

export const REASONING_QUEUE: ReasoningTask[] = [
  {
    id: "r_001",
    type: "deductive",
    peer: "alice",
    messageCount: 3,
    tokens: 1247,
    timestamp: "6:32:05 AM",
    status: "processing",
  },
  {
    id: "r_002",
    type: "explicit",
    peer: "bob",
    messageCount: 2,
    tokens: 892,
    timestamp: "6:31:58 AM",
    status: "queued",
  },
  {
    id: "r_003",
    type: "summary",
    peer: "alice",
    messageCount: 15,
    tokens: 2103,
    timestamp: "6:31:45 AM",
    status: "queued",
  },
  {
    id: "r_004",
    type: "peer_card",
    peer: "charlie",
    messageCount: 5,
    timestamp: "6:31:42 AM",
    status: "completed",
  },
  {
    id: "r_005",
    type: "inductive",
    peer: "bob",
    messageCount: 8,
    timestamp: "6:31:28 AM",
    status: "completed",
  },
  {
    id: "r_006",
    type: "abductive",
    peer: "alice",
    messageCount: 4,
    tokens: 1560,
    timestamp: "6:30:57 AM",
    status: "failed",
    error: "LLM timeout after 30s",
  },
  {
    id: "r_007",
    type: "consolidation",
    peer: "charlie",
    messageCount: 25,
    tokens: 3200,
    timestamp: "6:30:30 AM",
    status: "queued",
  },
];

export const REASONING_TYPES = [
  { code: "EXP", label: "explicit", description: "Extracts explicitly stated information from messages", color: "purple" },
  { code: "DED", label: "deductive", description: "Draws certain conclusions from explicit premises", color: "blue" },
  { code: "IND", label: "inductive", description: "Identifies patterns across multiple conclusions", color: "yellow" },
  { code: "ABD", label: "abductive", description: "Infers simplest explanations for behavior", color: "orange" },
  { code: "SUM", label: "summary", description: "Generates condensed session summaries", color: "cyan" },
  { code: "PCD", label: "peer_card", description: "Updates key biographical peer information", color: "pink" },
  { code: "CON", label: "consolidation", description: "Removes redundant/contradictory conclusions", color: "yellow" },
];

export const CONCLUSIONS_STATS = {
  total: 6,
  explicit: 1,
  deductive: 2,
  inductive: 2,
  abductive: 1,
};

export const CONTEXT_LAYERS: ContextLayer[] = [
  {
    id: "peer_card",
    label: "Peer Card",
    description: "Key biographical info about a peer",
    tokens: 150,
    items: 3,
    enabled: true,
    color: "blue",
  },
  {
    id: "conclusions",
    label: "Conclusions",
    description: "Reasoning insights derived through formal logic",
    tokens: 800,
    items: 12,
    enabled: true,
    color: "purple",
  },
  {
    id: "summaries",
    label: "Summaries",
    description: "Compressed conversation history",
    tokens: 1200,
    items: 4,
    enabled: true,
    color: "cyan",
  },
  {
    id: "messages",
    label: "Messages",
    description: "Recent message history for conversational context",
    tokens: 2500,
    items: 47,
    enabled: true,
    color: "muted",
  },
];

export const WEBHOOKS: Webhook[] = [
  {
    id: "wh_001",
    url: "http://localhost:3000/api/webhook",
    events: ["message.created", "session.created"],
    active: true,
    failures: 0,
    lastDelivery: "1/20/2026 06:32 AM",
    createdAt: "1/18/2026 01:00 AM",
  },
  {
    id: "wh_002",
    url: "http://localhost:8080/honcho/events",
    events: ["reasoning.completed", "reasoning.failed"],
    active: true,
    failures: 2,
    lastDelivery: "1/20/2026 05:15 AM",
    createdAt: "1/15/2026 03:30 AM",
  },
  {
    id: "wh_003",
    url: "http://192.168.1.100:5000/hooks",
    events: ["peer.created", "peer.updated"],
    active: false,
    failures: 5,
    lastDelivery: "1/19/2026 08:45 AM",
    createdAt: "1/10/2026 12:00 AM",
  },
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

export const SERVICE_STATUSES: ServiceStatus[] = [
  { id: "api", name: "api_server", icon: "server", status: "healthy", detail: "12ms" },
  { id: "pg", name: "postgres", icon: "database", status: "healthy", detail: "3ms · 48 connections" },
  { id: "rw", name: "reasoning_workers", icon: "brain", status: "healthy", detail: "145ms · 4 active" },
  { id: "vs", name: "vector_store", icon: "layers", status: "healthy", detail: "8ms · 2.4M embeddings" },
  { id: "bq", name: "background_queue", icon: "clock", status: "healthy", detail: "23 pending" },
  { id: "st", name: "storage", icon: "hard-drive", status: "healthy", detail: "67% used" },
];

export const HEALTH_CHECKS: HealthCheck[] = [
  { id: "h1", name: "PostgreSQL Connection", category: "database", status: "healthy", description: "Connected to database", detail: "postgresql+psycopg://localhost:5432/honcho", timing: "3ms", timestamp: "1:45:04 AM" },
  { id: "h2", name: "Database Migrations", category: "database", status: "healthy", description: "All migrations applied", detail: "Current revision: a1b2c3d4e5f6", timestamp: "1:45:04 AM" },
  { id: "h3", name: "pgvector Extension", category: "database", status: "healthy", description: "Extension installed and enabled", timestamp: "1:45:04 AM" },
  { id: "h4", name: "API Server", category: "api", status: "healthy", description: "Server responding on port 8000", detail: "GET /health returned 200 OK", timing: "12ms", timestamp: "1:45:04 AM" },
  { id: "h5", name: "API Functionality", category: "api", status: "healthy", description: "Workspace creation successful", detail: "POST /v3/workspaces test passed", timing: "45ms", timestamp: "1:45:04 AM" },
  { id: "h6", name: "Deriver Process", category: "deriver", status: "healthy", description: "Deriver running with 4 workers", detail: "Processing queue: 23 pending tasks", timestamp: "1:45:04 AM" },
  { id: "h7", name: "Google Gemini API", category: "llm", status: "healthy", description: "API key valid and responding", detail: "Used by: deriver, summary, dialectic (minimal/low)", timing: "145ms", timestamp: "1:45:04 AM" },
  { id: "h8", name: "Anthropic API", category: "llm", status: "warning", description: "API key not configured", detail: "Required for: dialectic (medium/high/max), dream", timestamp: "1:45:04 AM" },
  { id: "h9", name: "OpenAI API", category: "llm", status: "healthy", description: "API key valid (embeddings)", detail: "Used when EMBED_MESSAGES=true", timing: "89ms", timestamp: "1:45:04 AM" },
  { id: "h10", name: "Redis Cache", category: "cache", status: "warning", description: "Redis not connected (optional)", detail: "Falling back to in-memory cache", timestamp: "1:45:04 AM" },
  { id: "h11", name: "Authentication Config", category: "auth", status: "healthy", description: "AUTH_USE_AUTH=false (local dev mode)", timestamp: "1:45:04 AM" },
  { id: "h12", name: "Database Config", category: "database", status: "healthy", description: "Connection string format valid", detail: "Using postgresql+psycopg:// prefix", timestamp: "1:45:04 AM" },
];

export const LOG_ENTRIES: LogEntry[] = [
  { id: "l1", timestamp: "1:45:42 AM", level: "info", source: "api", message: "Health check passed" },
  { id: "l2", timestamp: "1:45:38 AM", level: "info", source: "deriver", message: "Processing batch of 3 messages" },
  { id: "l3", timestamp: "1:45:35 AM", level: "debug", source: "database", message: "Query executed" },
  { id: "l4", timestamp: "1:45:31 AM", level: "warn", source: "cache", message: "Redis connection failed, using in-memory fallback" },
  { id: "l5", timestamp: "1:45:28 AM", level: "info", source: "deriver", message: "Deductive reasoning completed" },
  { id: "l6", timestamp: "1:45:23 AM", level: "info", source: "api", message: "Workspace created" },
  { id: "l7", timestamp: "1:45:18 AM", level: "error", source: "deriver", message: "LLM API timeout" },
  { id: "l8", timestamp: "1:45:13 AM", level: "info", source: "system", message: "Server started" },
  { id: "l9", timestamp: "1:45:08 AM", level: "info", source: "database", message: "Database connection established" },
  { id: "l10", timestamp: "1:45:03 AM", level: "info", source: "deriver", message: "Deriver workers started" },
];

export const CONFIG_VALIDATIONS = [
  { key: "DB_CONNECTION_URI", required: true, category: "database", status: "healthy" as const, description: "Connection string format is correct", value: "postgresql+psycopg://postgres:***@localhost:5432/honcho" },
  { key: "AUTH_USE_AUTH", required: false, category: "auth", status: "warning" as const, description: "Authentication disabled (OK for local dev)", value: "false" },
  { key: "AUTH_JWT_SECRET", required: false, category: "auth", status: "healthy" as const, description: "Not required when AUTH_USE_AUTH=false", value: "(not set)" },
  { key: "LLM_GEMINI_API_KEY", required: true, category: "llm", status: "healthy" as const, description: "API key configured", value: "AIza***" },
  { key: "LLM_ANTHROPIC_API_KEY", required: false, category: "llm", status: "warning" as const, description: "Not set - required for dialectic medium/high/max, dream", value: "(not set)" },
  { key: "LLM_OPENAI_API_KEY", required: false, category: "llm", status: "healthy" as const, description: "API key configured (used for embeddings)", value: "sk-***" },
  { key: "DERIVER_WORKERS", required: false, category: "deriver", status: "healthy" as const, description: "4 workers configured", value: "4" },
  { key: "REPRESENTATION_BATCH_MAX_TOKENS", required: false, category: "deriver", status: "healthy" as const, description: "Default batch threshold", value: "1000" },
  { key: "CACHE_ENABLED", required: false, category: "cache", status: "healthy" as const, description: "Caching disabled (Redis optional)", value: "false" },
  { key: "EMBED_MESSAGES", required: false, category: "general", status: "healthy" as const, description: "Message embedding enabled", value: "true" },
];

export const TROUBLESHOOTING_ITEMS: TroubleshootingItem[] = [
  { id: "t1", title: 'Server won\'t start: "Missing client for ..."', category: "startup", severity: "error", description: "The server validates at startup that all configured LLM providers have API keys.", details: ["Check that all keys referenced in LLM_PROVIDERS are set in .env", "Disable unused providers with LLM_PROVIDERS=openai", "Restart the server after fixing keys"] },
  { id: "t2", title: 'Server won\'t start: "JWT_SECRET must be set"', category: "startup", severity: "error", description: "Authentication is enabled but no JWT secret was provided.", details: ["Set AUTH_JWT_SECRET=<random 32+ char string>", "Or disable auth with AUTH_USE_AUTH=false for local dev"] },
  { id: "t3", title: 'API returns "An unexpected error occurred"', category: "runtime", severity: "error", description: "This is almost always a database issue. The health endpoint returns ok even when database is unreachable.", details: ["Check DB_CONNECTION_URI uses postgresql+psycopg prefix", "Verify the database is reachable from the server", "Check Docker network if running in container"] },
  { id: "t4", title: "Deriver not processing messages", category: "runtime", severity: "warning", description: "Messages are stored but no observations, summaries, or representations are being generated.", details: ["Confirm deriver process is running (separate worker)", "Check LLM API keys are valid", "Inspect logs for rate limits or timeouts"] },
  { id: "t5", title: "Database connection string format error", category: "database", severity: "error", description: "The connection URI must use the postgresql+psycopg prefix.", details: ["Replace postgresql:// with postgresql+psycopg://", "psycopg is the required SQLAlchemy driver"] },
  { id: "t6", title: "Thinking budget errors with non-Anthropic providers", category: "llm", severity: "warning", description: 'Errors like "thinking budget not supported" or silent failures with no agent output.', details: ["Lower dialectic reasoning level to low/minimal for non-Anthropic providers", "Use Claude for high/max reasoning"] },
  { id: "t7", title: "Docker build fails with syntax errors", category: "docker", severity: "warning", description: "Python build failing in the container.", details: ["Ensure Python 3.12+ in the base image", "Clear Docker build cache: docker builder prune"] },
];

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
    whereHonchoFits: "Long-term memory layer alongside built-in memory files. Provides prompt-time context injection, cross-session continuity, and durable writeback.",
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
    whereHonchoFits: "Plugin observing messages after every AI turn, building user/agent representations, providing tool-based context access.",
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
    whereHonchoFits: "Plugin providing persistent memory, git awareness (branches, commits), flexible session mapping, and AI self-awareness.",
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
    whereHonchoFits: "Hosted MCP server exposing full Honcho API as MCP tools. Any compatible client gains memory capabilities.",
    mcpCompatibility: "Native MCP server. HTTP direct (Cursor, Windsurf, VS Code, Cline, Zed) or stdio via mcp-remote (Claude Desktop, Codex).",
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

export const QUICK_LINKS = [
  "Self-Hosting Guide",
  "Troubleshooting",
  "Architecture",
  "API Reference",
];

export const FEATURE_FLAGS = [
  { key: "webhooks_enabled", description: "Enable webhook notifications for events", enabled: true },
  { key: "embed_messages", description: "Generate embeddings for messages on creation", enabled: true },
  { key: "dialectic_enabled", description: "Allow dialectic context synthesis", enabled: true },
  { key: "dream_enabled", description: "Run dream reasoning when sessions are idle", enabled: false },
  { key: "cache_enabled", description: "Use Redis cache when available", enabled: false },
];

export const ENV_VARS = [
  { key: "DB_CONNECTION_URI", value: "postgresql+psycopg://localhost:5432/honcho" },
  { key: "LLM_PROVIDERS", value: "openai,gemini" },
  { key: "DERIVER_WORKERS", value: "4" },
  { key: "REPRESENTATION_BATCH_MAX_TOKENS", value: "1000" },
  { key: "MAX_CONTEXT_TOKENS", value: "4000" },
  { key: "AUTH_USE_AUTH", value: "false" },
  { key: "EMBED_MESSAGES", value: "true" },
];

export function genHeatmapCells(weeks = 52, days = 7): number[] {
  const cells: number[] = [];
  let seed = 1;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < days; d++) {
      const dow = d;
      const base = dow === 0 || dow === 6 ? 0.2 : 0.55;
      const noise = rnd();
      const burst = w > 40 && w < 50 ? 0.25 : 0;
      const val = Math.min(1, base * noise * 2 + burst * rnd());
      cells.push(val);
    }
  }
  return cells;
}

export function genThroughputSeries(timeframe: "1H" | "6H" | "24H" | "7D") {
  const buckets = timeframe === "1H" ? 12 : timeframe === "6H" ? 18 : timeframe === "24H" ? 24 : 28;
  const factor = timeframe === "1H" ? 0.4 : timeframe === "6H" ? 0.7 : timeframe === "24H" ? 1 : 1.6;
  let seed = timeframe.charCodeAt(0) * 7 + buckets;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const reads: number[] = [];
  const writes: number[] = [];
  for (let i = 0; i < buckets; i++) {
    const r = 80 + Math.round(rnd() * 100 * factor);
    const w = 30 + Math.round(rnd() * 70 * factor);
    reads.push(r);
    writes.push(w);
  }
  return { reads, writes };
}
