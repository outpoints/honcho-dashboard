"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Chip } from "@/components/atoms";
import { Select } from "@/components/Select";
import { Icon } from "@/components/icons";
import { MESSAGES } from "@/lib/data";
import { cn } from "@/lib/utils";

export function MessagesPage() {
  const [query, setQuery] = useState("");
  return (
    <div className="space-y-3">
      <PageHeader title="MESSAGES" subtitle="view and create messages within sessions" />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] flex items-center gap-2 bg-void border border-border px-3 py-2">
          <Icon name="search" className="text-text-muted" size={12} />
          <input
            placeholder="search message content..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="bg-transparent text-xs flex-1 outline-none placeholder:text-text-muted"
          />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-text-muted">session:</span>
          <Select
            value="all_sessions"
            onChange={() => undefined}
            options={[
              { value: "all_sessions", label: "all sessions" },
              { value: "sess_7f3a2b01", label: "sess_7f3a2b01" },
              { value: "sess_8e4c1d02", label: "sess_8e4c1d02" },
            ]}
            className="min-w-[150px]"
          />
          <Icon name="filter" size={10} className="text-text-muted" />
          <Select
            value="all_reasoning"
            onChange={() => undefined}
            options={[
              { value: "all_reasoning", label: "all reasoning" },
              { value: "pending", label: "pending" },
              { value: "processing", label: "processing" },
              { value: "completed", label: "completed" },
              { value: "skipped", label: "skipped" },
            ]}
            className="min-w-[150px]"
          />
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 lg:col-span-8">
          <Panel title="MESSAGE_STREAM" bodyClassName="p-0">
            <div className="max-h-[600px] overflow-y-auto">
              {MESSAGES.filter((m) => !query || m.body.toLowerCase().includes(query.toLowerCase())).map((m, i) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.2 }}
                  className={cn("flex gap-3 px-3 py-3 border-b border-border hover:bg-border/20 transition-colors duration-150", m.peerType === "user" ? "border-l-2 border-l-blue-400/60" : "border-l-2 border-l-purple-400/60")}
                >
                  <div className={cn("w-8 h-8 border flex items-center justify-center shrink-0", m.peerType === "user" ? "border-blue-400/40 text-blue-400 bg-blue-400/5" : "border-purple-400/40 text-purple-400 bg-purple-400/5")}>
                    <Icon name={m.peerType === "user" ? "user" : "bot"} size={12} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[10px] mb-1">
                      <span className="text-text-primary text-xs">{m.peer}</span>
                      <span className="text-text-muted">in {m.session}</span>
                      <span className="flex items-center gap-1 text-text-muted"><Icon name="clock" size={10} /> {m.timestamp}</span>
                    </div>
                    <p className="text-sm text-text-primary leading-relaxed break-words">{m.body}</p>
                    <div className="flex items-center gap-2 mt-2 text-[10px]">
                      <Chip tone={m.status === "completed" ? "accent" : m.status === "skipped" ? "muted" : "yellow"} icon={m.status === "completed" ? "check" : m.status === "skipped" ? "x" : "loader"}>
                        {m.status}
                      </Chip>
                      <span className="text-text-muted">{m.tokens} tokens</span>
                      <span className="text-text-muted">#{m.id}</span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-3">
          <Panel title="COMPOSE_MESSAGE">
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Icon name="message-square" className="text-text-muted" size={24} />
              <p className="text-xs text-text-muted text-center">Select a session to compose messages</p>
            </div>
          </Panel>
          <Panel title="MESSAGE_STATS">
            <div className="space-y-2 text-xs">
              {[
                ["total_displayed", "6", "primary"],
                ["pending_reasoning", "0", "primary"],
                ["processing", "1", "accent"],
                ["completed", "2", "primary"],
              ].map(([k, v, tone]) => (
                <div key={k} className="flex justify-between py-1.5 border-b border-border last:border-0">
                  <span className="text-text-muted">{k}</span>
                  <span className={cn("text-text-primary tabular-nums", tone === "accent" && "text-accent")}>{v}</span>
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
