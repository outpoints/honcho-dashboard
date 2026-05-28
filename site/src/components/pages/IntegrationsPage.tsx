"use client";

import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, PillTabs } from "@/components/atoms";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { useToast } from "@/components/toast";

type Snippet = "curl" | "python" | "typescript" | "mcp";

export function IntegrationsPage() {
  const apiOpts = useActiveHonchoOptions();
  const { workspaceId } = useActiveWorkspace();
  const { push } = useToast();
  const [tab, setTab] = useState<Snippet>("curl");

  const base = apiOpts?.baseUrl ?? "http://localhost:8000";
  const ws = workspaceId ?? "default";
  const token = apiOpts?.token;

  const copy = (text: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      push({ type: "success", message: "Copied to clipboard" });
    }
  };

  const snippet = renderSnippet(tab, base, ws, token);

  return (
    <div className="space-y-3">
      <PageHeader
        title="INTEGRATIONS"
        subtitle="point any client at your live Honcho instance"
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card label="base_url" value={base} mono />
        <Card label="workspace" value={ws} mono />
        <Card label="auth" value={token ? "Bearer token" : "none"} />
      </div>

      <Panel title="QUICK_START">
        <div className="space-y-3">
          <PillTabs
            items={[
              { key: "curl", label: "CURL" },
              { key: "python", label: "PYTHON" },
              { key: "typescript", label: "TYPESCRIPT" },
              { key: "mcp", label: "MCP" },
            ]}
            current={tab}
            onChange={(k) => setTab(k as Snippet)}
          />
          <div className="relative">
            <pre className="bg-void border border-border px-3 py-3 text-[11px] text-text-primary overflow-x-auto leading-relaxed">
              {snippet}
            </pre>
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-2 right-2"
              onClick={() => copy(snippet)}
            >
              COPY
            </Button>
          </div>
        </div>
      </Panel>

      <Panel title="API_REFERENCE">
        <div className="text-[11px] space-y-2">
          <Row k="OpenAPI spec" v={<a href={`${base}/openapi.json`} target="_blank" rel="noreferrer" className="text-accent underline decoration-dotted">{base}/openapi.json</a>} />
          <Row k="Interactive docs" v={<a href={`${base}/docs`} target="_blank" rel="noreferrer" className="text-accent underline decoration-dotted">{base}/docs</a>} />
          <Row k="Health" v={<a href={`${base}/health`} target="_blank" rel="noreferrer" className="text-accent underline decoration-dotted">{base}/health</a>} />
        </div>
      </Panel>

      <Panel title="NOTE">
        <div className="text-[11px] text-text-muted leading-relaxed">
          The Hermes / OpenClaw / Claude Code / MCP marketing copy from the original UI was static
          content, not data from your Honcho instance. It&apos;s been replaced with snippets generated
          from your actual <span className="text-accent">active instance</span> and{" "}
          <span className="text-accent">active workspace</span>, so what you copy will work against
          this server.
        </div>
      </Panel>

      <StatusBar />
    </div>
  );
}

function Card({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-surface border border-border p-3">
      <div className="text-[10px] text-text-muted uppercase tracking-wider">&gt; {label}</div>
      <div className={`mt-1 text-sm truncate text-text-primary ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 py-1.5 border-b border-border last:border-0">
      <span className="text-text-muted">{k}</span>
      <span className="truncate text-right">{v}</span>
    </div>
  );
}

function renderSnippet(kind: Snippet, base: string, ws: string, token?: string): string {
  const auth = token ? ` -H "Authorization: Bearer ${token}"` : "";
  switch (kind) {
    case "curl":
      return `# list workspaces
curl -X POST ${base}/v3/workspaces/list${auth} \\
  -H "Content-Type: application/json" -d '{}'

# chat with a peer (memory-augmented)
curl -X POST ${base}/v3/workspaces/${ws}/peers/PEER_ID/chat${auth} \\
  -H "Content-Type: application/json" \\
  -d '{"queries": "what do you remember about Alice?"}'`;
    case "python":
      return `import httpx

client = httpx.Client(
    base_url="${base}",${token ? `\n    headers={"Authorization": "Bearer ${token}"},` : ""}
)

# list peers in workspace
r = client.post("/v3/workspaces/${ws}/peers/list", json={})
print(r.json())

# chat with a peer
r = client.post(
    "/v3/workspaces/${ws}/peers/PEER_ID/chat",
    json={"queries": "what do you remember about Alice?"},
)
print(r.json()["content"])`;
    case "typescript":
      return `const BASE = "${base}";
const WS = "${ws}";${token ? `\nconst TOKEN = "${token}";` : ""}

const headers = {
  "Content-Type": "application/json",${token ? '\n  "Authorization": `Bearer ${TOKEN}`,' : ""}
};

// list peers
const peers = await fetch(\`\${BASE}/v3/workspaces/\${WS}/peers/list\`, {
  method: "POST",
  headers,
  body: JSON.stringify({}),
}).then((r) => r.json());

// chat with a peer
const reply = await fetch(\`\${BASE}/v3/workspaces/\${WS}/peers/PEER_ID/chat\`, {
  method: "POST",
  headers,
  body: JSON.stringify({ queries: "what do you remember about Alice?" }),
}).then((r) => r.json());`;
    case "mcp":
      return `{
  "mcpServers": {
    "honcho": {
      "url": "${base}/mcp",
      "headers": {${token ? `\n        "Authorization": "Bearer ${token}",` : ""}
        "X-Honcho-User-Name": "your-name",
        "X-Honcho-Assistant-Name": "Assistant"
      }
    }
  }
}

# Note: Honcho's optional MCP server lives at /mcp and is configured
# server-side. If this returns 404 your instance does not have the
# MCP server enabled.`;
  }
}
