"use client";

import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Field, TextInput } from "@/components/atoms";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { honcho } from "@/lib/honcho/client";
import { useHonchoInstances, type HonchoInstance } from "@/lib/honcho/config";
import { formatApiError, invalidate } from "@/lib/honcho/useQuery";

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; detail: string }
  | { kind: "err"; detail: string };

type EditorMode = { kind: "new" } | { kind: "edit"; id: string };

export function ConfigPage() {
  const { instances, activeId, setActive, upsert, remove } = useHonchoInstances();
  const [mode, setMode] = useState<EditorMode | null>(null);

  const effectiveMode: EditorMode =
    mode ?? (activeId ? { kind: "edit", id: activeId } : { kind: "new" });

  const editing =
    effectiveMode.kind === "edit"
      ? instances.find((i) => i.id === effectiveMode.id) ?? null
      : null;

  const editorKey =
    effectiveMode.kind === "edit" ? `edit:${effectiveMode.id}` : "new";

  const startNew = () => setMode({ kind: "new" });
  const handleSelect = (id: string) => {
    setActive(id);
    setMode({ kind: "edit", id });
    invalidate("");
  };

  return (
    <div className="space-y-3">
      <PageHeader
        title="CONFIG"
        subtitle="self-hosted honcho instances and dashboard settings"
        actions={<Button icon="plus" onClick={startNew}>NEW_INSTANCE</Button>}
      />

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 lg:col-span-8 space-y-3">
          <Panel title={editing ? "EDIT_INSTANCE" : "NEW_INSTANCE"}>
            <InstanceEditor
              key={editorKey}
              editing={editing}
              upsert={upsert}
              setActive={setActive}
              onSaved={(id) => setMode({ kind: "edit", id })}
              onRemove={(id) => {
                const inst = instances.find((i) => i.id === id);
                if (!inst) return;
                if (instances.length === 1) return;
                remove(id);
                setMode(activeId && activeId !== id ? { kind: "edit", id: activeId } : { kind: "new" });
              }}
              canRemove={!!editing && instances.length > 1}
            />
          </Panel>

          <Panel title="INSTANCES">
            {instances.length === 0 ? (
              <div className="text-xs text-text-muted py-4">No instances yet. Add one above.</div>
            ) : (
              <div className="space-y-1">
                {instances.map((inst) => {
                  const isActive = inst.id === activeId;
                  const isEditing = editing?.id === inst.id;
                  return (
                    <button
                      key={inst.id}
                      onClick={() => handleSelect(inst.id)}
                      className={
                        "w-full flex items-center justify-between gap-2 px-2 py-2 text-left border transition-colors " +
                        (isEditing
                          ? "border-accent/60 bg-accent/5"
                          : "border-border hover:border-border-light")
                      }
                    >
                      <div className="min-w-0">
                        <div className="text-xs flex items-center gap-2">
                          <span className="text-text-primary truncate">{inst.name}</span>
                          {isActive ? (
                            <span className="text-[9px] text-accent uppercase tracking-wider">active</span>
                          ) : null}
                        </div>
                        <div className="text-[10px] text-text-muted truncate font-mono">{inst.baseUrl}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {inst.token ? <Icon name="key" size={11} className="text-text-muted" /> : null}
                        <Icon name="chevron-right" size={12} className="text-text-muted" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-3">
          <Panel title="ACTIVE_INSTANCE">
            {(() => {
              const a = instances.find((i) => i.id === activeId);
              if (!a) return <div className="text-xs text-text-muted">No active instance.</div>;
              const rows: [string, string][] = [
                ["name", a.name],
                ["base_url", a.baseUrl],
                ["auth", a.token ? "Bearer token" : "none"],
              ];
              return (
                <div className="space-y-1.5 text-xs">
                  {rows.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2 py-1.5 border-b border-border last:border-0">
                      <span className="text-text-muted">{k}</span>
                      <span className="text-accent truncate font-mono">{v}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </Panel>

          <Panel title="NOTES">
            <div className="text-[11px] text-text-muted space-y-2 leading-relaxed">
              <p>
                Instances are stored in <span className="text-accent">localStorage</span> — no
                server-side persistence. Tokens never leave this browser.
              </p>
              <p>
                The Honcho server config (LLM providers, workers, DB) is set via environment
                variables on the server, not from this dashboard. See{" "}
                <span className="text-accent">#/diagnostics</span> for runtime validation.
              </p>
            </div>
          </Panel>
        </div>
      </div>

      <StatusBar />
    </div>
  );
}

function InstanceEditor({
  editing,
  upsert,
  setActive,
  onSaved,
  onRemove,
  canRemove,
}: {
  editing: HonchoInstance | null;
  upsert: (i: HonchoInstance) => void;
  setActive: (id: string) => void;
  onSaved: (id: string) => void;
  onRemove: (id: string) => void;
  canRemove: boolean;
}) {
  const { push } = useToast();
  const [name, setName] = useState(editing?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(editing?.baseUrl ?? "http://localhost:8000");
  const [token, setToken] = useState(editing?.token ?? "");
  const [test, setTest] = useState<TestState>({ kind: "idle" });

  const handleSave = () => {
    const trimmedUrl = baseUrl.trim().replace(/\/+$/, "");
    const trimmedName = name.trim();
    if (!trimmedName) {
      push({ type: "error", message: "Name is required" });
      return;
    }
    if (!/^https?:\/\//.test(trimmedUrl)) {
      push({ type: "error", message: "Base URL must start with http:// or https://" });
      return;
    }
    const id = editing?.id ?? `inst_${Date.now().toString(36)}`;
    const next: HonchoInstance = {
      id,
      name: trimmedName,
      baseUrl: trimmedUrl,
      token: token.trim() || undefined,
    };
    upsert(next);
    setActive(id);
    invalidate("");
    onSaved(id);
    push({ type: "success", message: `Saved instance ${trimmedName}` });
  };

  const handleTest = async () => {
    const trimmedUrl = baseUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//.test(trimmedUrl)) {
      setTest({ kind: "err", detail: "Base URL must start with http:// or https://" });
      return;
    }
    setTest({ kind: "testing" });
    try {
      const opts = { baseUrl: trimmedUrl, token: token.trim() || undefined };
      const health = await honcho.health(opts);
      const ws = await honcho.workspaces.list(opts, { size: 1 });
      setTest({
        kind: "ok",
        detail: `health=${health.status} · workspaces=${ws.total}`,
      });
    } catch (err) {
      setTest({ kind: "err", detail: formatApiError(err) });
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="NAME" hint="A label for this Honcho instance, e.g. local, prod">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="local" />
        </Field>
        <Field label="BASE_URL" hint="Root URL of the Honcho server (no trailing slash)">
          <TextInput
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://localhost:8000"
          />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="BEARER_TOKEN" hint="Leave blank if the server has AUTH_USE_AUTH=false">
          <TextInput
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="(optional)"
            type="password"
          />
        </Field>
      </div>

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <Button variant="primary" onClick={handleSave}>{editing ? "SAVE" : "CREATE"}</Button>
        <Button variant="secondary" onClick={handleTest} disabled={test.kind === "testing"}>
          {test.kind === "testing" ? "TESTING…" : "TEST_CONNECTION"}
        </Button>
        {canRemove && editing ? (
          <Button variant="ghost" onClick={() => onRemove(editing.id)}>REMOVE</Button>
        ) : null}
      </div>

      {test.kind !== "idle" ? (
        <div
          className={
            "mt-3 px-2 py-1.5 border text-[11px] flex items-center gap-2 " +
            (test.kind === "ok"
              ? "border-accent/40 bg-accent/10 text-accent"
              : test.kind === "err"
                ? "border-red-500/40 bg-red-500/10 text-red-400"
                : "border-border bg-border/30 text-text-muted")
          }
        >
          <Icon
            name={test.kind === "ok" ? "check" : test.kind === "err" ? "x-circle" : "loader"}
            size={12}
          />
          <span className="truncate">
            {test.kind === "testing"
              ? "Contacting Honcho…"
              : test.kind === "ok"
                ? `Connected — ${test.detail}`
                : test.detail}
          </span>
        </div>
      ) : null}
    </>
  );
}
