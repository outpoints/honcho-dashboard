"use client";

import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Field, TextInput, Toggle } from "@/components/atoms";
import { Select } from "@/components/Select";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { ENV_VARS, FEATURE_FLAGS } from "@/lib/data";

export function ConfigPage() {
  const { push } = useToast();
  const [flags, setFlags] = useState(FEATURE_FLAGS);
  return (
    <div className="space-y-3">
      <PageHeader title="CONFIG" subtitle="instance configuration and settings" />

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 lg:col-span-8 space-y-3">
          <Panel title="LLM_CONFIGURATION">
            <div className="grid grid-cols-2 gap-3">
              <Field label="LLM_PROVIDER">
                <Select
                  value="OpenAI"
                  onChange={(v) => push({ type: "success", message: `LLM provider set to ${v}` })}
                  options={[
                    { value: "OpenAI", label: "OpenAI" },
                    { value: "Anthropic", label: "Anthropic" },
                    { value: "Google Gemini", label: "Google Gemini" },
                  ]}
                />
              </Field>
              <Field label="LLM_MODEL">
                <TextInput defaultValue="gpt-5.4" />
              </Field>
            </div>
            <p className="mt-3 text-[10px] text-text-muted">&gt; The LLM provider and model used for reasoning tasks. Custom models trained for logical reasoning are recommended.</p>
          </Panel>

          <Panel title="REASONING_CONFIGURATION">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Field label="REASONING_WORKERS" hint="Number of concurrent background workers">
                <TextInput defaultValue="4" />
              </Field>
              <Field label="BATCH_THRESHOLD (TOKENS)" hint="Token threshold before batch processing">
                <TextInput defaultValue="1000" />
              </Field>
            </div>
            <Field label="MAX_CONTEXT_TOKENS" hint="Maximum tokens for context retrieval">
              <TextInput defaultValue="4000" />
            </Field>
          </Panel>

          <Panel title="DATABASE_CONFIGURATION">
            <Field label="POSTGRES_URL" hint="PostgreSQL connection string (requires restart)">
              <TextInput defaultValue="postgresql://localhost:5432/honcho" />
            </Field>
          </Panel>

          <Panel title="FEATURE_FLAGS">
            <div className="space-y-2">
              {flags.map((f) => (
                <div key={f.key} className="flex items-start justify-between gap-3 p-3 bg-void/40 border border-border">
                  <div>
                    <div className="text-xs text-text-primary">{f.key}</div>
                    <div className="text-[10px] text-text-muted">{f.description}</div>
                  </div>
                  <Toggle
                    checked={f.enabled}
                    onChange={(next) => {
                      setFlags((curr) => curr.map((x) => (x.key === f.key ? { ...x, enabled: next } : x)));
                      push({ type: "success", message: `${f.key} ${next ? "enabled" : "disabled"}` });
                    }}
                  />
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-3">
          <Panel title="CURRENT_CONFIG">
            <div className="space-y-1.5 text-xs">
              {[
                ["version", "v3.0.5"],
                ["provider", "openai"],
                ["model", "gpt-5.4"],
                ["workers", "4"],
                ["batch", "1000t"],
                ["max_context", "4000t"],
                ["webhooks", "ON"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between py-1.5 border-b border-border last:border-0">
                  <span className="text-text-muted">{k}</span>
                  <span className="text-accent">{v}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="CONFIG_HIERARCHY">
            <div className="text-xs space-y-1">
              <p className="text-text-muted text-[10px] mb-2">Configuration cascades hierarchically:</p>
              <div className="text-accent">1. Instance (global defaults)</div>
              <div className="text-accent ml-3">└ 2. Workspace (overrides instance)</div>
              <div className="text-accent ml-6">└ 3. Session (overrides workspace)</div>
              <div className="text-accent ml-9">└ 4. Message (overrides session)</div>
            </div>
            <p className="mt-3 text-[10px] text-text-muted">Peer <span className="text-accent">observe_me</span> overrides workspace defaults but not session/message config.</p>
            <div className="mt-3">
              <div className="text-[10px] text-text-muted mb-1">Config schema (workspace/session):</div>
              <pre className="px-2 py-2 bg-void border border-border text-[10px] text-text-primary overflow-x-auto leading-snug">{`{
  "reasoning": { "enabled": bool },
  "peer_card": { "use": bool, "create": bool },
  "summary": {
    "enabled": bool,
    "messages_per_short_summary": int,
    "messages_per_long_summary": int
  },
  "dream": { "enabled": bool }
}`}</pre>
            </div>
          </Panel>

          <Panel title="ENVIRONMENT">
            <div className="space-y-1 text-[11px]">
              {ENV_VARS.map((v) => (
                <div key={v.key} className="flex items-center justify-between gap-2 px-2 py-1.5 bg-void/40 border border-border">
                  <span className="text-accent font-mono truncate">{v.key}</span>
                  <span className="text-text-primary font-mono truncate" title={v.value}>{v.value}</span>
                </div>
              ))}
              <div className="pt-2 mt-2 border-t border-border flex items-center gap-1 text-[10px] text-text-muted">
                <Icon name="external-link" size={10} /> see CONFIG_VALIDATION in DIAGNOSTICS
              </div>
            </div>
          </Panel>
        </div>
      </div>

      <StatusBar />
    </div>
  );
}
