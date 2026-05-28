"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Field } from "@/components/atoms";
import { Select } from "@/components/Select";
import { Icon } from "@/components/icons";
import { CONTEXT_LAYERS } from "@/lib/data";
import { cn } from "@/lib/utils";

const LAYER_TONE: Record<string, string> = {
  peer_card: "bg-blue-400 text-blue-400 border-blue-400/40",
  conclusions: "bg-purple-400 text-purple-400 border-purple-400/40",
  summaries: "bg-cyan-400 text-cyan-400 border-cyan-400/40",
  messages: "bg-text-muted text-text-muted border-border-light",
};

const ICONS: Record<string, "user" | "brain" | "book" | "message-square"> = {
  peer_card: "user",
  conclusions: "brain",
  summaries: "book",
  messages: "message-square",
};

export function ContextPage() {
  const [tokenLimit, setTokenLimit] = useState(4000);
  const [layers, setLayers] = useState(CONTEXT_LAYERS);
  const total = useMemo(() => layers.filter((l) => l.enabled).reduce((s, l) => s + l.tokens, 0), [layers]);
  const overLimit = total > tokenLimit;

  return (
    <div className="space-y-3">
      <PageHeader
        title="CONTEXT"
        subtitle="assemble LLM-ready context from peer representations, conclusions, summaries, and messages"
        actions={
          <div className="flex items-center gap-2 text-xs">
            <Icon name="layers" size={12} className="text-text-muted" />
            <span className={cn("font-pixel text-lg", overLimit ? "text-red-400" : "text-accent")}>{total.toLocaleString()}</span>
            <span className="text-text-muted">/ {tokenLimit.toLocaleString()} tokens</span>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <Field label="SESSION">
          <Select value="all_sessions" onChange={() => undefined} options={[{ value: "all_sessions", label: "all sessions" }]} />
        </Field>
        <Field label="PEER">
          <Select value="all_peers" onChange={() => undefined} options={[{ value: "all_peers", label: "all peers" }]} />
        </Field>
        <Field label="TOKEN_LIMIT" hint={<span className="tabular-nums">{tokenLimit}</span>}>
          <input
            type="range"
            min={500}
            max={10000}
            step={250}
            value={tokenLimit}
            onChange={(e) => setTokenLimit(parseInt(e.target.value))}
            className="w-full accent-accent"
          />
        </Field>
        <Button variant="primary" icon="sparkles" className="self-end">GENERATE_CONTEXT</Button>
      </div>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 lg:col-span-7 space-y-3">
          <Panel title="CONTEXT_LAYERS">
            <div className="space-y-3">
              {layers.map((layer) => {
                const tones = LAYER_TONE[layer.id].split(" ");
                const bg = tones[0];
                const text = tones[1];
                const border = tones[2];
                return (
                  <div key={layer.id} className={cn("p-3 border bg-void/30", border)}>
                    <div className="flex items-center gap-2 mb-2">
                      <Icon name={ICONS[layer.id]} className={text} size={14} />
                      <span className={cn("text-sm uppercase tracking-wider", text)}>{layer.label}</span>
                      <span className="text-[10px] text-text-muted">({layer.id})</span>
                      <span className="ml-auto text-[10px] text-text-muted">{layer.tokens.toLocaleString()} tokens · {layer.items} items</span>
                      <button onClick={() => setLayers((curr) => curr.map((l) => l.id === layer.id ? { ...l, enabled: !l.enabled } : l))} className={cn("ml-2 w-7 h-5 border flex items-center justify-center", layer.enabled ? "border-accent text-accent" : "border-border text-text-muted")}><Icon name="eye" size={10} /></button>
                    </div>
                    <div className="relative h-2 bg-border mb-2">
                      <div className={cn("absolute inset-y-0 left-0", bg)} style={{ width: `${Math.min(100, (layer.tokens / 3000) * 100)}%`, opacity: layer.enabled ? 0.7 : 0.2 }} />
                    </div>
                    <p className="text-[11px] text-text-muted">{layer.description}</p>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-3 border-t border-border">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-text-muted uppercase tracking-wider">total_enabled</span>
                <span className={overLimit ? "text-red-400" : "text-accent"}>
                  {total.toLocaleString()} / {tokenLimit.toLocaleString()} tokens
                </span>
              </div>
              <div className="relative h-1 bg-border mt-1.5">
                <div className={cn("absolute inset-y-0 left-0", overLimit ? "bg-red-500" : "bg-accent")} style={{ width: `${Math.min(100, (total / tokenLimit) * 100)}%` }} />
              </div>
              {overLimit ? (
                <p className="mt-2 text-[10px] text-yellow-400 flex items-center gap-1">
                  <Icon name="warning" size={10} /> exceeds token limit — lower-priority layers will be truncated
                </p>
              ) : null}
            </div>
          </Panel>
        </div>

        <div className="col-span-12 lg:col-span-5 space-y-3">
          <Panel title="CONTEXT_PREVIEW">
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Icon name="eye" className="text-text-muted" size={28} />
              <p className="text-sm text-text-muted">No context generated yet</p>
              <p className="text-[10px] text-text-muted">Select session &amp; peer, then click GENERATE_CONTEXT</p>
            </div>
          </Panel>

          <Panel title="HOW_CONTEXT_WORKS">
            <div className="space-y-2 text-[11px]">
              <Line code="PCD" label="Peer cards cache basic biographical info about a peer — name, traits, preferences" />
              <Line code="CON" label="Conclusions are derived through formal logic reasoning — deductive, inductive, abductive" />
              <Line code="SUM" label="Summaries compress conversation history into digestible overviews" />
              <Line code="MSG" label="Messages provide recent conversational context for continuity" />
              <p className="text-text-muted leading-snug pt-2 border-t border-border">
                Layers are assembled in priority order: peer_card → conclusions → summaries → messages. If total tokens exceed the limit, lower-priority layers are truncated first.
              </p>
            </div>
          </Panel>

          <Panel title="LAYER_STATS">
            <div className="space-y-1.5 text-[11px]">
              {layers.map((l) => (
                <div key={l.id} className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span className={cn("w-2 h-2", LAYER_TONE[l.id].split(" ")[0])} />
                    <span className="text-text-muted">{l.id}</span>
                  </span>
                  <span className="text-text-primary tabular-nums">{l.tokens.toLocaleString()} tok / {l.items} items</span>
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

function Line({ code, label }: { code: string; label: string }) {
  const tone = code === "PCD" ? "blue" : code === "CON" ? "purple" : code === "SUM" ? "cyan" : "muted";
  const cls: Record<string, string> = {
    blue: "bg-blue-400/10 text-blue-400 border-blue-400/40",
    purple: "bg-purple-400/10 text-purple-400 border-purple-400/40",
    cyan: "bg-cyan-400/10 text-cyan-400 border-cyan-400/40",
    muted: "bg-border text-text-muted border-border-light",
  };
  return (
    <div className="flex items-start gap-2">
      <span className={cn("px-1.5 py-0.5 text-[9px] uppercase tracking-wider border", cls[tone])}>{code}</span>
      <p className="text-text-muted leading-snug flex-1">{label}</p>
    </div>
  );
}
