"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { StatusBar } from "@/components/StatusBar";
import { Button, Chip, Field, TextInput, Tabs } from "@/components/atoms";
import { Select } from "@/components/Select";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { PEERS, WORKSPACES } from "@/lib/data";
import { cn } from "@/lib/utils";

type Filter = "all" | "user" | "agent";

export function PeersPage() {
  const [query, setQuery] = useState("");
  const [workspace, setWorkspace] = useState("all");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"user" | "agent">("user");

  const filtered = useMemo(() => {
    return PEERS.filter((p) => {
      if (workspace !== "all" && p.workspace !== workspace) return false;
      if (filter !== "all" && p.type !== filter) return false;
      if (query && !(`${p.name} ${p.id}`).toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [query, workspace, filter]);

  return (
    <div className="space-y-3">
      <PageHeader
        title="PEERS"
        subtitle="users and agents that interact within sessions"
        actions={<Button icon="plus" onClick={() => setOpen(true)}>NEW_PEER</Button>}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] flex items-center gap-2 bg-void border border-border px-3 py-2">
          <Icon name="search" className="text-text-muted" size={12} />
          <input
            placeholder="search peers by name or id..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="bg-transparent text-xs flex-1 outline-none placeholder:text-text-muted"
          />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-text-muted">workspace:</span>
          <Select
            value={workspace}
            onChange={setWorkspace}
            options={[{ value: "all", label: "all" }, ...WORKSPACES.map((w) => ({ value: w.name, label: w.name }))]}
            className="min-w-[140px]"
          />
        </div>
        <Tabs<Filter>
          items={[
            { key: "all", label: "ALL" },
            { key: "user", label: "USER" },
            { key: "agent", label: "AGENT" },
          ]}
          current={filter}
          onChange={setFilter}
          className="border-0"
        />
      </div>

      <div className="space-y-2">
        {filtered.map((p, i) => (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.03, duration: 0.2 }}
            whileHover={{ borderColor: "rgba(60, 130, 247, 0.5)" }}
            className="w-full flex items-center gap-3 px-3 py-3 bg-surface border border-border transition-colors duration-150 text-left cursor-pointer"
            role="button"
            tabIndex={0}
          >
            <div className={cn("w-10 h-10 border flex items-center justify-center shrink-0", p.type === "user" ? "border-blue-400/50 text-blue-400 bg-blue-400/5" : "border-purple-400/50 text-purple-400 bg-purple-400/5")}>
              <Icon name={p.type === "user" ? "user" : "bot"} size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-text-primary">{p.name}</span>
                <span className="text-[10px] text-text-muted">@{p.workspace}</span>
                {p.reasoning ? <Chip tone="accent">REASONING</Chip> : null}
              </div>
              <div className="flex items-center gap-3 text-[10px] text-text-muted mt-1">
                <span className="flex items-center gap-1"><Icon name="git-branch" size={10} /> {p.sessions} sessions</span>
                <span className="flex items-center gap-1"><Icon name="message-square" size={10} /> {p.messages.toLocaleString()} msgs</span>
                <span className="flex items-center gap-1"><Icon name="file-search" size={10} /> {p.conclusions} conclusions</span>
              </div>
            </div>
            <div className="text-right text-[10px] text-text-muted">
              <div>last active</div>
              <div className="text-text-primary">{p.lastActive}</div>
            </div>
            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} className="w-8 h-8 border border-border-light text-text-muted hover:text-text-primary flex items-center justify-center"><Icon name="settings" size={12} /></motion.button>
            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} className="w-8 h-8 border border-border-light text-text-muted hover:text-text-primary flex items-center justify-center"><Icon name="chevron-right" size={12} /></motion.button>
          </motion.div>
        ))}
      </div>

      <StatusBar />

      <Modal
        title="CREATE_PEER"
        open={open}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>CANCEL</Button>
            <Button variant="solid" onClick={() => setOpen(false)}>CREATE</Button>
          </>
        }
      >
        <Field label="WORKSPACE">
          <Select
            value=""
            onChange={() => undefined}
            placeholder="Select workspace..."
            options={WORKSPACES.map((w) => ({ value: w.name, label: w.name }))}
          />
        </Field>
        <Field label="PEER_NAME">
          <TextInput placeholder="e.g., alice, support_bot" />
        </Field>
        <Field label="TYPE">
          <div className="grid grid-cols-2 gap-2">
            {(["user", "agent"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={cn(
                  "flex items-center justify-center gap-2 px-3 py-2 border transition-colors text-xs",
                  type === t ? "border-accent text-accent bg-accent/10" : "border-border text-text-muted hover:border-border-light",
                )}
              >
                <Icon name={t === "user" ? "user" : "bot"} size={14} />
                {t}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-text-muted mt-2">Users have reasoning enabled by default</p>
        </Field>
      </Modal>
    </div>
  );
}
