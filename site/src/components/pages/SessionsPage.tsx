"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Chip, Tabs } from "@/components/atoms";
import { Select } from "@/components/Select";
import { Icon } from "@/components/icons";
import { ConfirmModal } from "@/components/ConfirmModal";
import { useToast } from "@/components/toast";
import { SESSIONS, WORKSPACES, MESSAGES } from "@/lib/data";
import { useNav } from "@/lib/nav";
import type { Session, SessionStatus } from "@/types/honcho";
import { cn } from "@/lib/utils";

type Filter = "all" | SessionStatus;

export function SessionsPage() {
  const { navigate } = useNav();
  const { push } = useToast();
  const [sessions, setSessions] = useState<Session[]>(SESSIONS);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [workspace, setWorkspace] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [creating, setCreating] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      if (workspace !== "all" && s.workspace !== workspace) return false;
      if (filter !== "all" && s.status !== filter) return false;
      if (query && !`${s.id} ${s.peers.join(",")}`.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [filter, query, workspace, sessions]);

  const targetSession = removeTarget ? sessions.find((s) => s.id === removeTarget) : null;

  const toggleArchive = (id: string) => {
    setSessions((cur) =>
      cur.map((s) =>
        s.id === id
          ? { ...s, status: s.status === "archived" ? "idle" : "archived" }
          : s,
      ),
    );
    const target = sessions.find((s) => s.id === id);
    if (target) {
      push({
        type: "success",
        message: `Session ${id} ${target.status === "archived" ? "unarchived" : "archived"}`,
      });
    }
  };

  const removeSession = (id: string) => {
    setSessions((cur) => cur.filter((s) => s.id !== id));
    setOpen(null);
    setRemoveTarget(null);
    push({ type: "success", message: `Session ${id} removed` });
  };

  return (
    <div className="space-y-3">
      <PageHeader
        title="SESSIONS"
        subtitle="interaction threads between peers within workspaces"
        actions={<Button icon="plus" onClick={() => { setCreating(true); setStep(1); }}>NEW_SESSION</Button>}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] flex items-center gap-2 bg-void border border-border px-3 py-2">
          <Icon name="search" className="text-text-muted" size={12} />
          <input
            placeholder="search sessions by id or peer name..."
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
            { key: "active", label: "ACTIVE" },
            { key: "idle", label: "IDLE" },
            { key: "archived", label: "ARCHIVED" },
          ]}
          current={filter}
          onChange={setFilter}
          className="border-0"
          layoutId="sessions-filter"
        />
      </div>

      {creating ? (
        <Panel
          title="CREATE_SESSION"
          actions={
            <button onClick={() => setCreating(false)} className="text-[10px] text-text-muted hover:text-text-primary">
              CANCEL
            </button>
          }
        >
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => setStep(1)}
              className={cn(
                "px-3 py-1 text-[10px] border",
                step >= 1 ? "border-accent text-accent bg-accent/10" : "border-border text-text-muted",
              )}
            >
              ■ 1. WORKSPACE
            </button>
            <span className="w-6 h-px bg-border" />
            <button
              onClick={() => setStep(2)}
              className={cn(
                "px-3 py-1 text-[10px] border",
                step === 2 ? "border-accent text-accent bg-accent/10" : "border-border text-text-muted",
              )}
            >
              ■ 2. PEERS
            </button>
          </div>
          {step === 1 ? (
            <>
              <p className="text-[10px] text-text-muted mb-3">&gt; select a workspace for the new session</p>
              <div className="grid grid-cols-3 gap-3">
                {WORKSPACES.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => setStep(2)}
                    className="bg-void border border-border p-4 text-left hover:border-accent transition-colors"
                  >
                    <div className="text-sm mb-2">{w.name}</div>
                    <div className="flex items-center gap-3 text-[10px] text-text-muted mb-3">
                      <span className="flex items-center gap-1">
                        <Icon name="users" size={10} /> {w.peers}
                      </span>
                      <span className="flex items-center gap-1">
                        <Icon name="git-branch" size={10} /> {w.sessions}
                      </span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-text-muted">{w.llmProvider}</span>
                      <span className="text-text-primary">{w.llmModel}</span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="text-[10px] text-text-muted mb-3">&gt; select peers for this session (min 2)</p>
              <div className="grid grid-cols-3 gap-2">
                {["alice", "bob", "support_bot", "charlie", "assistant"].map((n) => (
                  <button
                    key={n}
                    className="px-3 py-2 border border-border hover:border-accent text-xs text-left flex items-center gap-2"
                  >
                    <Icon name="user" size={12} /> {n}
                  </button>
                ))}
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="secondary" onClick={() => setStep(1)}>BACK</Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    setCreating(false);
                    push({ type: "success", message: "Session created (mock)" });
                  }}
                >
                  CREATE
                </Button>
              </div>
            </>
          )}
        </Panel>
      ) : null}

      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {filtered.map((s, i) => (
            <motion.div
              key={s.id}
              layout
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 100, transition: { duration: 0.2 } }}
              transition={{ delay: i * 0.03, duration: 0.2 }}
              whileHover={{ borderColor: "rgba(60, 130, 247, 0.5)" }}
              className="bg-surface border border-border transition-colors duration-150"
            >
              <button
                className="w-full flex items-center gap-3 px-3 py-3 text-left"
                onClick={() => setOpen(open === s.id ? null : s.id)}
              >
                <div className="w-10 h-10 bg-blue-400/10 border border-blue-400/40 text-blue-400 flex items-center justify-center shrink-0">
                  <Icon name="git-branch" size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-text-primary">{s.id}</span>
                    <span className="text-[10px] text-text-muted">@{s.workspace}</span>
                    <Chip
                      tone={
                        s.status === "active" ? "accent" : s.status === "idle" ? "yellow" : "muted"
                      }
                    >
                      {s.status}
                    </Chip>
                    {s.hasSummary ? (
                      <Chip tone="purple" icon="book">SUMMARY</Chip>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-text-muted mt-1">
                    <span className="flex items-center gap-1">
                      <Icon name="users" size={10} /> {s.peers.length} peers
                    </span>
                    <span className="flex items-center gap-1">
                      <Icon name="message-square" size={10} /> {s.messageCount} msgs
                    </span>
                    <span>{(s.tokens / 1000).toFixed(1)}k tokens</span>
                  </div>
                </div>
                <div className="flex -space-x-1.5">
                  {s.peers.slice(0, 3).map((p, idx) => (
                    <div
                      key={idx}
                      className="w-6 h-6 border border-border bg-void flex items-center justify-center text-[9px] text-text-muted"
                    >
                      <Icon name={p.includes("bot") || p === "assistant" ? "bot" : "user"} size={10} />
                    </div>
                  ))}
                </div>
                <div className="text-right text-[10px] text-text-muted">
                  <div>last message</div>
                  <div className="text-text-primary flex items-center gap-1 justify-end">
                    <Icon name="clock" size={10} /> {s.lastMessage}
                  </div>
                </div>
                <Icon
                  name="chevron-right"
                  className={cn("text-text-muted transition-transform", open === s.id && "rotate-90")}
                  size={14}
                />
              </button>

              <AnimatePresence initial={false}>
                {open === s.id ? (
                  <motion.div
                    key="expanded"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
                    className="border-t border-border overflow-hidden bg-void/30"
                  >
                    <div className="p-3 space-y-3">
                      <div>
                        <div className="text-[10px] text-text-muted uppercase tracking-wider mb-2">SESSION_PEERS</div>
                        <div className="flex flex-wrap gap-2">
                          {s.peers.map((p) => (
                            <span
                              key={p}
                              className="inline-flex items-center gap-2 px-2 py-1 bg-surface border border-border text-xs"
                            >
                              <Icon name={p.includes("bot") || p === "assistant" ? "bot" : "user"} size={12} />
                              {p}
                              <button
                                onClick={() =>
                                  push({ type: "info", message: `Removed ${p} from ${s.id}` })
                                }
                                className="text-text-muted hover:text-red-400"
                              >
                                <Icon name="x" size={10} />
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-text-muted uppercase tracking-wider mb-2">
                          RECENT_MESSAGES ({MESSAGES.filter((m) => m.session === s.id).length || 4})
                        </div>
                        <div className="space-y-2">
                          {MESSAGES.filter((m) => m.session === s.id)
                            .slice(0, 4)
                            .map((m) => (
                              <div
                                key={m.id}
                                className="px-3 py-2 bg-surface border-l-2 border-blue-400/50 border-y border-r border-border"
                              >
                                <div className="flex items-center gap-2 mb-1 text-[10px]">
                                  <Icon name={m.peerType === "user" ? "user" : "bot"} size={10} className="text-text-muted" />
                                  <span className="text-text-primary">{m.peer}</span>
                                  <span className="text-text-muted">{m.timestamp}</span>
                                  <Chip
                                    tone={
                                      m.status === "completed"
                                        ? "accent"
                                        : m.status === "skipped"
                                        ? "muted"
                                        : "yellow"
                                    }
                                  >
                                    {m.status}
                                  </Chip>
                                </div>
                                <div className="text-xs text-text-primary">{m.body}</div>
                              </div>
                            ))}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-[10px] text-text-muted pt-2 border-t border-border">
                        <span>
                          reasoning:{" "}
                          <span className={s.config.reasoning ? "text-accent" : "text-text-muted"}>
                            {s.config.reasoning ? "ENABLED" : "DISABLED"}
                          </span>
                        </span>
                        <span>|</span>
                        <span>
                          peer_card: <span className="text-accent">{s.config.peerCard}</span>
                        </span>
                        <span>|</span>
                        <span>
                          summary: <span className="text-accent">{s.config.summary}</span>
                        </span>
                        <span>|</span>
                        <span>
                          dream:{" "}
                          <span className={s.config.dream ? "text-accent" : "text-text-muted"}>
                            {s.config.dream ? "ENABLED" : "DISABLED"}
                          </span>
                        </span>
                        <span>|</span>
                        <span>
                          created: <span className="text-text-primary">{s.createdAt}</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="primary" size="sm" onClick={() => navigate("messages")}>
                          VIEW_MESSAGES
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => toggleArchive(s.id)}>
                          {s.status === "archived" ? "UNARCHIVE" : "ARCHIVE"}
                        </Button>
                        <Button variant="warning" size="sm" icon="trash" onClick={() => setRemoveTarget(s.id)}>
                          REMOVE_SESSION
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <ConfirmModal
        open={!!targetSession}
        title="CONFIRM_REMOVE"
        body={
          <>
            This will remove <span className="text-accent">{targetSession?.id}</span> and all its
            associated messages. This cannot be undone.
          </>
        }
        confirmLabel="REMOVE_SESSION"
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => removeTarget && removeSession(removeTarget)}
      />

      <StatusBar />
    </div>
  );
}
