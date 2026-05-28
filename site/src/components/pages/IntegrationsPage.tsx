"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Chip, Tabs } from "@/components/atoms";
import { Icon } from "@/components/icons";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { useToast } from "@/components/toast";
import { INTEGRATIONS, QUICK_LINKS, SELF_HOSTED_REQUIREMENTS } from "@/lib/integrations";
import type { AgentKey } from "@/types/honcho";
import { cn } from "@/lib/utils";

const AGENT_LOGOS: Record<string, string | null> = {
  hermes: "/images/hermes_pixel_logo-BV9A8ejn.png",
  openclaw: "/images/openclaw_pixel_logo-DsyNa2AE.png",
  "claude-code": "/images/claude_pixel_logo-BzK2MwSh.png",
  mcp: null,
};

function AgentAvatar({ agentKey, themeText, large = false }: { agentKey: string; themeText: string; large?: boolean }) {
  const logo = AGENT_LOGOS[agentKey];
  const size = large ? 80 : 24;
  if (logo) {
    return (
      <Image
        src={logo}
        alt={agentKey}
        width={size}
        height={size}
        className="object-contain pixelated relative z-10"
        style={{ imageRendering: "pixelated" }}
      />
    );
  }
  return <Icon name="layers" className={themeText} size={large ? 28 : 14} />;
}

type SubTab = "overview" | "tools" | "setup" | "self-hosted";

const THEME: Record<string, { bg: string; border: string; text: string }> = {
  blue: { bg: "bg-blue-500/10", border: "border-blue-400/50", text: "text-blue-400" },
  red: { bg: "bg-red-500/10", border: "border-red-400/50", text: "text-red-400" },
  orange: { bg: "bg-orange-400/10", border: "border-orange-400/50", text: "text-orange-400" },
};

export function IntegrationsPage() {
  const apiOpts = useActiveHonchoOptions();
  const { workspaceId } = useActiveWorkspace();
  const { push } = useToast();
  const [agentKey, setAgentKey] = useState<AgentKey>("hermes");
  const [tab, setTab] = useState<SubTab>("overview");
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);

  const agent = INTEGRATIONS.find((a) => a.key === agentKey)!;
  const theme = THEME[agent.themeColor] || THEME.blue;

  // Inject the live, configured Honcho base URL into the editorial examples
  // (they ship with the http://localhost:8000 placeholder).
  const base = (apiOpts?.baseUrl ?? "http://localhost:8000").replace(/\/+$/, "");
  const liveize = useMemo(
    () => (s: string) => s.replaceAll("http://localhost:8000", base),
    [base],
  );

  const filteredAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return INTEGRATIONS;
    return INTEGRATIONS.filter(
      (a) => a.name.toLowerCase().includes(q) || a.role.toLowerCase().includes(q),
    );
  }, [search]);

  const copyConfig = async () => {
    try {
      await navigator.clipboard.writeText(liveize(agent.selfHosted.configExample));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      push({ type: "error", message: "Clipboard unavailable" });
    }
  };

  return (
    <div className="space-y-3">
      <PageHeader title="INTEGRATIONS" subtitle={undefined} />
      <Panel title="INTEGRATIONS">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            {filteredAgents.map((a) => {
              const t = THEME[a.themeColor] || THEME.blue;
              const active = a.key === agentKey;
              return (
                <button
                  key={a.key}
                  onClick={() => {
                    setAgentKey(a.key);
                    setTab("overview");
                  }}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 border transition-colors duration-150 text-xs",
                    active ? `${t.border} ${t.bg} ${t.text}` : "border-border text-text-muted hover:border-border-light",
                  )}
                >
                  {AGENT_LOGOS[a.key] ? (
                    <Image
                      src={AGENT_LOGOS[a.key]!}
                      alt={a.key}
                      width={16}
                      height={16}
                      className="object-contain"
                      style={{ imageRendering: "pixelated" }}
                    />
                  ) : (
                    <Icon name="layers" size={14} />
                  )}
                  {a.name.replace(" Agent", "")}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 bg-void border border-border px-3 py-1.5 text-xs">
              <Icon name="search" size={12} className="text-text-muted" />
              <input
                placeholder="Search integrations..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-transparent text-xs outline-none placeholder:text-text-muted"
              />
            </div>
            <Button variant="outline" icon="external-link">
              DOCS
            </Button>
          </div>
        </div>

        <motion.div
          key={agentKey}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className={cn("mt-3 p-3 flex items-start gap-4 border", theme.border, theme.bg)}
        >
          <div className={cn("w-20 h-20 border-2 flex items-center justify-center shrink-0 relative overflow-hidden", theme.border)}>
            <AgentAvatar agentKey={agent.key} themeText={theme.text} large />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-pixel text-xl tracking-wider">{agent.name}</h2>
              <Chip tone="muted">{agent.role}</Chip>
              <span className="ml-auto text-text-muted">
                <Icon name="code" size={14} />
              </span>
            </div>
            <p className="mt-1 text-xs text-text-muted">{agent.description}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {agent.features.map((f) => (
                <span key={f} className="text-[10px] px-2 py-0.5 bg-border text-text-primary">
                  {f}
                </span>
              ))}
            </div>
          </div>
        </motion.div>

        <Tabs<SubTab>
          className="mt-3"
          items={[
            { key: "overview", label: "OVERVIEW", icon: "book" },
            { key: "tools", label: "TOOLS", icon: "sparkles" },
            { key: "setup", label: "SETUP", icon: "settings" },
            { key: "self-hosted", label: "SELF-HOSTED", icon: "server" },
          ]}
          current={tab}
          onChange={setTab}
        />

        <div className="mt-3 relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${agentKey}-${tab}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              {tab === "overview" ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <Section icon="message-square" title="PURPOSE">
                      {agent.purpose}
                    </Section>
                    <Section icon="git-branch" title="WHERE HONCHO FITS">
                      {agent.whereHonchoFits}
                    </Section>
                  </div>
                  <div className="space-y-3">
                    <Section icon="layers" title="MCP COMPATIBILITY">
                      {agent.mcpCompatibility}
                    </Section>
                    <div>
                      <SectionTitle icon="settings" title="CONFIGURATION" />
                      <div className="space-y-1 mt-2 text-[11px]">
                        {agent.configuration.map((c) => (
                          <div key={c.key} className="flex items-center gap-2">
                            <span className="text-accent">{c.key}</span>
                            <span className="text-text-muted">→</span>
                            <span className="text-text-primary">{liveize(c.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {tab === "tools" ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {agent.tools.map((t) => (
                    <div key={t.name} className="flex items-center gap-3 p-3 border border-border bg-void/40">
                      <div
                        className={cn(
                          "w-9 h-9 border flex items-center justify-center shrink-0",
                          t.type === "llm"
                            ? "border-purple-400/40 text-purple-400 bg-purple-400/5"
                            : "border-yellow-400/40 text-yellow-400 bg-yellow-400/5",
                        )}
                      >
                        <Icon name={t.type === "llm" ? "brain" : "zap"} size={14} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-text-primary">{t.name}</span>
                          {t.type === "llm" ? <Chip tone="purple">LLM</Chip> : null}
                        </div>
                        <p className="text-[10px] text-text-muted">{t.description}</p>
                      </div>
                    </div>
                  ))}
                  <div className="col-span-full flex items-center gap-4 mt-2 text-[10px] text-text-muted">
                    <span className="flex items-center gap-1">
                      <Icon name="zap" size={10} className="text-yellow-400" /> Fast (no LLM)
                    </span>
                    <span className="flex items-center gap-1">
                      <Icon name="brain" size={10} className="text-purple-400" /> LLM-powered
                    </span>
                  </div>
                </div>
              ) : null}

              {tab === "setup" ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <SectionTitle icon="terminal" title="SETUP STEPS" />
                    <ol className="mt-2 space-y-2 text-[11px]">
                      {agent.setupSteps.map((s, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className="w-6 h-6 border border-border text-accent flex items-center justify-center shrink-0">
                            {i + 1}
                          </span>
                          <span className="text-text-primary">{liveize(s)}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                  <div>
                    <SectionTitle icon="settings" title="CONFIGURATION OPTIONS" />
                    <div className="mt-2 space-y-2">
                      {agent.configOptions.map((o) => (
                        <div
                          key={o.key}
                          className="grid grid-cols-3 gap-3 px-3 py-2 bg-void/40 border border-border text-[11px]"
                        >
                          <span className="text-accent">{o.key}</span>
                          <span className="text-text-primary">{o.current}</span>
                          <span className="text-text-muted">{o.options}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {tab === "self-hosted" ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-[10px] text-text-muted">
                    <span className="w-1.5 h-1.5 bg-accent animate-pulse" />
                    live config — endpoint <span className="text-accent font-mono">{base}</span>
                    {workspaceId ? (
                      <>
                        {" · "}workspace <span className="text-accent font-mono">{workspaceId}</span>
                      </>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <ReqTile icon="server" label="ENDPOINT" value={liveize(agent.selfHosted.endpoint)} highlight />
                    <ReqTile icon="key" label="AUTH" value={agent.selfHosted.auth} />
                    <ReqTile icon="plug" label="PROTOCOL" value={agent.selfHosted.protocol} />
                    <ReqTile icon="key" label="API KEY" value={agent.selfHosted.apiKey} />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <SectionTitle icon="check" title="SETUP NOTES" />
                      <ul className="mt-2 space-y-1 text-[11px]">
                        {agent.selfHosted.setupNotes.map((n, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <Icon name="check" size={10} className="text-accent mt-0.5" />{" "}
                            <span className="text-text-muted">{liveize(n)}</span>
                          </li>
                        ))}
                      </ul>
                      <SectionTitle icon="warning" title="CAVEATS" className="mt-4 text-yellow-400" />
                      <ul className="mt-2 space-y-1 text-[11px]">
                        {agent.selfHosted.caveats.map((c, i) => (
                          <li key={i} className="flex items-start gap-2 text-text-muted">
                            <span className="text-yellow-400">•</span> {c}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <SectionTitle icon="code" title="CONFIG EXAMPLE" />
                        <button
                          onClick={copyConfig}
                          className="text-[10px] text-text-muted hover:text-text-primary flex items-center gap-1"
                        >
                          <Icon name={copied ? "check" : "copy"} size={10} /> {copied ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <pre className="mt-2 p-3 bg-void border border-border text-[11px] text-text-primary overflow-x-auto leading-relaxed">
                        {liveize(agent.selfHosted.configExample)}
                      </pre>
                    </div>
                  </div>
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </Panel>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 lg:col-span-8">
          <Panel title="SELF_HOSTED_REQUIREMENTS">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {SELF_HOSTED_REQUIREMENTS.map((r) => (
                <div key={r.name} className="p-3 bg-void/40 border border-border">
                  <div className="flex items-center gap-2 mb-1 text-xs">
                    <Icon name={r.icon as "server" | "brain" | "database" | "key"} size={14} className="text-text-muted" />
                    <span className="text-text-primary">{r.name}</span>
                  </div>
                  <p className="text-[10px] text-text-muted">{r.detail}</p>
                </div>
              ))}
            </div>
          </Panel>
        </div>
        <div className="col-span-12 lg:col-span-4">
          <Panel title="QUICK_LINKS">
            <div className="space-y-2">
              {QUICK_LINKS.map((l) => (
                <div
                  key={l}
                  className="flex items-center justify-between px-3 py-2 bg-void/40 border border-border text-xs"
                >
                  <span className="text-accent">{l}</span>
                  <Icon name="external-link" size={12} className="text-text-muted" />
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <StatusBar />
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: "message-square" | "git-branch" | "layers";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <SectionTitle icon={icon} title={title} />
      <p className="text-[12px] text-text-primary mt-1 leading-relaxed">{children}</p>
    </div>
  );
}

function SectionTitle({ icon, title, className }: { icon: string; title: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-muted", className)}>
      <Icon
        name={icon as "message-square" | "git-branch" | "layers" | "settings" | "check" | "warning" | "code" | "terminal"}
        size={12}
      />
      {title}
    </div>
  );
}

function ReqTile({ icon, label, value, highlight = false }: { icon: "server" | "key" | "plug"; label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn("p-3 border bg-void/40", highlight ? "border-accent border-l-2" : "border-border")}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-muted mb-1">
        <Icon name={icon} size={11} />
        {label}
      </div>
      <div className="text-xs text-text-primary break-all">{value}</div>
    </div>
  );
}
