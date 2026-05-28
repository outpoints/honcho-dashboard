"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Field, TextInput, Toggle } from "@/components/atoms";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { ConfirmModal } from "@/components/ConfirmModal";
import { useToast } from "@/components/toast";
import { WORKSPACES } from "@/lib/data";
import type { Workspace } from "@/types/honcho";
import { useNav } from "@/lib/nav";

export function WorkspacesPage() {
  const { navigate } = useNav();
  const { push } = useToast();
  const [workspaces, setWorkspaces] = useState<Workspace[]>(WORKSPACES);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [reasoning, setReasoning] = useState(true);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const openCreate = () => {
    setEditingId(null);
    setName("");
    setReasoning(true);
    setOpen(true);
  };

  const openEdit = (w: Workspace) => {
    setEditingId(w.id);
    setName(w.name);
    setReasoning(w.reasoning);
    setOpen(true);
  };

  const save = () => {
    if (!name.trim()) {
      push({ type: "error", message: "Workspace name is required" });
      return;
    }
    if (editingId) {
      setWorkspaces((cur) => cur.map((w) => (w.id === editingId ? { ...w, name, reasoning } : w)));
      push({ type: "success", message: "Workspace updated" });
    } else {
      const id = `ws_${name.toLowerCase().replace(/\s+/g, "_")}_${Date.now().toString().slice(-4)}`;
      setWorkspaces((cur) => [
        ...cur,
        {
          id,
          name,
          peers: 0,
          sessions: 0,
          messages: 0,
          conclusions: 0,
          reasoning,
          peerCard: reasoning ? "use+create" : "off",
          summary: reasoning ? "every 20" : "off",
          dream: reasoning,
          llmProvider: "openai",
          llmModel: "gpt-5.4",
          createdAt: new Date().toLocaleDateString(),
        },
      ]);
      push({ type: "success", message: `Workspace ${name} created` });
    }
    setOpen(false);
  };

  const remove = (id: string) => {
    const w = workspaces.find((x) => x.id === id);
    setWorkspaces((cur) => cur.filter((x) => x.id !== id));
    setRemoveTarget(null);
    if (w) push({ type: "success", message: `Workspace ${w.name} removed` });
  };

  return (
    <div className="space-y-3">
      <PageHeader
        title="WORKSPACES"
        subtitle="top-level containers for organizing peers, sessions, and data"
        actions={<Button icon="plus" onClick={openCreate}>NEW_WORKSPACE</Button>}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <AnimatePresence initial={false}>
        {workspaces.map((w) => (
          <motion.div
            key={w.id}
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
          >
          <Panel title={w.name.toUpperCase()}>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <Stat icon="users" label="peers" value={w.peers.toLocaleString()} />
              <Stat icon="git-branch" label="sessions" value={w.sessions.toLocaleString()} />
              <Stat icon="message-square" label="messages" value={w.messages.toLocaleString()} />
              <Stat icon="file-search" label="conclusions" value={w.conclusions.toLocaleString()} />
            </div>
            <div className="space-y-1 text-[11px] mb-3">
              <Row k="reasoning" v={<span className={w.reasoning ? "text-accent" : "text-text-muted"}>{w.reasoning ? "ENABLED" : "DISABLED"}</span>} />
              <Row k="peer_card" v={<span className={w.peerCard === "off" ? "text-text-muted" : "text-accent"}>{w.peerCard}</span>} />
              <Row k="summary" v={<span className={w.summary === "off" ? "text-text-muted" : "text-accent"}>{w.summary}</span>} />
              <Row k="dream" v={<span className={w.dream ? "text-accent" : "text-text-muted"}>{w.dream ? "ENABLED" : "DISABLED"}</span>} />
              <Row k="llm_provider" v={<span className="text-text-primary">{w.llmProvider}</span>} />
              <Row k="model" v={<span className="text-text-primary">{w.llmModel}</span>} />
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" className="flex-1" onClick={() => navigate("peers")}>VIEW_PEERS</Button>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => openEdit(w)}
                className="w-8 h-8 border border-border-light text-text-muted hover:text-text-primary flex items-center justify-center"
                aria-label="Edit workspace"
              >
                <Icon name="settings" size={12} />
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setRemoveTarget(w.id)}
                className="w-8 h-8 border border-border-light text-text-muted hover:text-red-400 flex items-center justify-center"
                aria-label="Remove workspace"
              >
                <Icon name="trash" size={12} />
              </motion.button>
            </div>
            <div className="mt-3 pt-3 border-t border-border text-[10px] text-text-muted space-y-0.5">
              <div>created: <span className="text-text-primary">{w.createdAt}</span></div>
              <div>id: <span className="text-text-primary">{w.id}</span></div>
            </div>
          </Panel>
          </motion.div>
        ))}
        </AnimatePresence>
      </div>

      <StatusBar />

      <ConfirmModal
        open={!!removeTarget}
        title="CONFIRM_REMOVE"
        body={
          <>
            This will permanently delete the{" "}
            <span className="text-accent">
              {workspaces.find((w) => w.id === removeTarget)?.name}
            </span>{" "}
            workspace and all its peers/sessions/messages. This cannot be undone.
          </>
        }
        confirmLabel="REMOVE_WORKSPACE"
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => removeTarget && remove(removeTarget)}
      />

      <Modal
        title={editingId ? "EDIT_WORKSPACE" : "CREATE_WORKSPACE"}
        open={open}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>CANCEL</Button>
            <Button variant="primary" onClick={save}>{editingId ? "SAVE" : "CREATE"}</Button>
          </>
        }
      >
        <Field label="WORKSPACE_NAME">
          <TextInput placeholder="e.g., production, staging, development" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="flex items-start gap-3 p-3 bg-void/50 border border-border">
          <Toggle checked={reasoning} onChange={setReasoning} />
          <div>
            <div className="text-xs">Enable reasoning</div>
            <div className="text-[10px] text-text-muted">When enabled, Honcho will run inference on messages to build peer representations</div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: "users" | "git-branch" | "message-square" | "file-search"; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <Icon name={icon} className="text-text-muted shrink-0" size={12} />
      <span className="text-text-muted">{label}:</span>
      <span className="text-text-primary tabular-nums">{value}</span>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-text-muted">{k}</span>
      <span>{v}</span>
    </div>
  );
}
