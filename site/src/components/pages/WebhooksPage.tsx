"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Chip, Field, StatTile, TextInput, Toggle } from "@/components/atoms";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { ConfirmModal } from "@/components/ConfirmModal";
import { useToast } from "@/components/toast";
import { ALL_WEBHOOK_EVENTS, WEBHOOKS } from "@/lib/data";
import type { Webhook } from "@/types/honcho";
import { cn } from "@/lib/utils";

export function WebhooksPage() {
  const { push } = useToast();
  const [hooks, setHooks] = useState<Webhook[]>(WEBHOOKS);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [active, setActive] = useState(true);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const counts = useMemo(() => ({
    active: hooks.filter((h) => h.active).length,
    inactive: hooks.filter((h) => !h.active).length,
    failures: hooks.reduce((s, h) => s + h.failures, 0),
  }), [hooks]);

  const openCreate = () => {
    setEditingId(null);
    setUrl("");
    setEvents([]);
    setActive(true);
    setOpen(true);
  };

  const openEdit = (h: Webhook) => {
    setEditingId(h.id);
    setUrl(h.url);
    setEvents(h.events);
    setActive(h.active);
    setOpen(true);
  };

  const save = () => {
    if (!url || events.length === 0) {
      push({ type: "error", message: "URL and at least one event are required" });
      return;
    }
    if (editingId) {
      setHooks((cur) =>
        cur.map((h) => (h.id === editingId ? { ...h, url, events: events as Webhook["events"], active } : h)),
      );
      push({ type: "success", message: "Webhook updated" });
    } else {
      const id = `wh_${Date.now()}`;
      setHooks((cur) => [
        ...cur,
        {
          id,
          url,
          events: events as Webhook["events"],
          active,
          failures: 0,
          lastDelivery: "never",
          createdAt: new Date().toLocaleString(),
        },
      ]);
      push({ type: "success", message: "Webhook created" });
    }
    setOpen(false);
  };

  const togglePower = (id: string) => {
    setHooks((cur) => cur.map((h) => (h.id === id ? { ...h, active: !h.active } : h)));
    const h = hooks.find((x) => x.id === id);
    if (h) {
      push({ type: "success", message: `Webhook ${h.active ? "paused" : "resumed"}` });
    }
  };

  const remove = (id: string) => {
    setHooks((cur) => cur.filter((h) => h.id !== id));
    setRemoveTarget(null);
    push({ type: "success", message: `Webhook removed` });
  };

  return (
    <div className="space-y-3">
      <PageHeader
        title="WEBHOOKS"
        subtitle="webhook endpoint management for self-hosted Honcho instance"
        actions={<Button icon="plus" onClick={openCreate}>NEW_WEBHOOK</Button>}
      />

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="active" value={counts.active} hintTone="accent" hint={<span>{counts.active} endpoints delivering</span>} />
        <StatTile label="inactive" value={counts.inactive} hintTone="muted" hint={<span>paused or disabled</span>} />
        <StatTile
          label="failures"
          value={<span className={counts.failures ? "text-yellow-400" : "text-text-primary"}>{counts.failures}</span>}
          hintTone="warn"
          hint={<span>last 24h</span>}
        />
      </div>

      <Panel title="WEBHOOK_ENDPOINTS">
        <div className="space-y-2">
        <AnimatePresence initial={false}>
          {hooks.map((w, i) => (
            <motion.div
              key={w.id}
              layout
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 100, transition: { duration: 0.2 } }}
              transition={{ delay: i * 0.05, duration: 0.2 }}
              whileHover={{ borderColor: "rgba(60, 130, 247, 0.5)" }}
              className="flex items-center gap-3 px-3 py-3 bg-void/40 border border-border transition-colors duration-150"
            >
              <Icon name={w.active ? "check" : "x-circle"} size={14} className={w.active ? "text-accent" : "text-text-muted"} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-text-primary font-mono">{w.url}</span>
                  {w.failures ? <Chip tone="warn" icon="warning">{w.failures} failures</Chip> : null}
                </div>
                <div className="flex flex-wrap items-center gap-1 mt-1">
                  {w.events.map((e) => (
                    <span key={e} className="text-[10px] px-1.5 py-0.5 bg-accent/10 text-accent">{e}</span>
                  ))}
                </div>
                <div className="flex items-center gap-3 mt-1 text-[10px] text-text-muted">
                  <span className="flex items-center gap-1"><Icon name="clock" size={10} /> last: {w.lastDelivery}</span>
                  <span>created: {w.createdAt}</span>
                </div>
              </div>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => togglePower(w.id)}
                className={cn(
                  "w-8 h-8 border flex items-center justify-center transition-colors duration-150",
                  w.active ? "border-accent/50 text-accent" : "border-border text-text-muted",
                )}
                aria-label={w.active ? "Pause" : "Resume"}
              >
                <Icon name="power" size={12} />
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => openEdit(w)}
                className="w-8 h-8 border border-border-light text-text-muted hover:text-text-primary flex items-center justify-center transition-colors duration-150"
                aria-label="Edit"
              >
                <Icon name="edit" size={12} />
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setRemoveTarget(w.id)}
                className="w-8 h-8 border border-border-light text-text-muted hover:text-red-400 flex items-center justify-center transition-colors duration-150"
                aria-label="Remove"
              >
                <Icon name="trash" size={12} />
              </motion.button>
            </motion.div>
          ))}
        </AnimatePresence>
        </div>
      </Panel>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 lg:col-span-7">
          <Panel title="EVENT_TYPES">
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              {ALL_WEBHOOK_EVENTS.map((e) => (
                <div key={e} className="flex items-center gap-2">
                  <span className="w-1 h-1 bg-accent" />
                  <span className="text-accent">{e}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
        <div className="col-span-12 lg:col-span-5">
          <Panel title="SELF_HOSTED_INFO">
            <div className="space-y-2 text-xs">
              <Bullet icon="external-link" label="No API key required for self-hosted" />
              <Bullet icon="webhook" label="Webhooks target local endpoints only" />
              <Bullet icon="warning" label="Ensure endpoints are reachable from server" tone="warn" />
              <div className="mt-3 pt-3 border-t border-border space-y-0.5 text-[11px] text-text-muted">
                <div>&gt; endpoint: <span className="text-text-primary">http://localhost:8000</span></div>
                <div>&gt; retries: <span className="text-text-primary">3 (exponential backoff)</span></div>
                <div>&gt; timeout: <span className="text-text-primary">10s</span></div>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      <StatusBar />

      <ConfirmModal
        open={!!removeTarget}
        title="CONFIRM_REMOVE"
        body={<>This will permanently delete this webhook endpoint. Pending deliveries will be dropped.</>}
        confirmLabel="REMOVE_WEBHOOK"
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => removeTarget && remove(removeTarget)}
      />

      <Modal
        title={editingId ? "EDIT_WEBHOOK" : "NEW_WEBHOOK"}
        open={open}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>CANCEL</Button>
            <Button variant="primary" onClick={save}>{editingId ? "SAVE" : "CREATE_WEBHOOK"}</Button>
          </>
        }
      >
        <Field label="ENDPOINT_URL" hint="URL that will receive POST requests for subscribed events">
          <TextInput placeholder="http://localhost:3000/api/webhook" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Field label="EVENTS">
          <div className="grid grid-cols-2 gap-1.5">
            {ALL_WEBHOOK_EVENTS.map((e) => (
              <label key={e} className="flex items-center gap-2 px-2 py-1.5 border border-border hover:border-border-light cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={events.includes(e)}
                  onChange={(ev) => setEvents((curr) => ev.target.checked ? [...curr, e] : curr.filter((c) => c !== e))}
                  className="accent-accent"
                />
                {e}
              </label>
            ))}
          </div>
          <p className="text-[10px] text-text-muted mt-2">&gt; {events.length} events selected</p>
        </Field>
        <Field label="SIGNING_SECRET (OPTIONAL)" hint="Used to verify webhook payloads (HMAC-SHA256)">
          <TextInput placeholder="whsec_..." />
        </Field>
        <div className="flex items-start gap-3 p-3 bg-void/40 border border-border">
          <Toggle checked={active} onChange={setActive} />
          <div>
            <div className="text-xs">active</div>
            <div className="text-[10px] text-text-muted">Enable event delivery to this endpoint</div>
          </div>
        </div>
        {events.length === 0 || !url ? (
          <div className="px-3 py-2 bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-xs flex items-center gap-2">
            <Icon name="warning" size={12} /> URL and at least one event are required
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Bullet({ icon, label, tone = "muted" }: { icon: "external-link" | "webhook" | "warning"; label: string; tone?: "muted" | "warn" }) {
  const color = tone === "warn" ? "text-yellow-400" : "text-text-muted";
  return (
    <div className="flex items-center gap-2">
      <Icon name={icon} className={color} size={12} />
      <span className={color}>{label}</span>
    </div>
  );
}
