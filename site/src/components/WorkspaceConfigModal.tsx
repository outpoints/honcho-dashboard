"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { Panel } from "@/components/Panel";
import { Button, Checkbox, Chip, Field, PillTabs, TextInput } from "@/components/atoms";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm";
import { useWriteActions } from "@/lib/writeActions";
import { honcho } from "@/lib/honcho/client";
import { useActiveHonchoOptions } from "@/lib/honcho/config";
import { formatApiError, invalidate } from "@/lib/honcho/useQuery";
import type { ApiWorkspace } from "@/lib/honcho/types";

/**
 * Global defaults Honcho falls back to when a workspace config field is unset.
 * Mirrors `src/config.py` (DeriverSettings / PeerCardSettings / SummarySettings /
 * DreamSettings) on the Honcho server. Used only to render the "DEFAULT" state and
 * the effective toggle position — unset fields are NOT written on save.
 */
const DEFAULTS = {
  reasoning: true,
  peerCardUse: true,
  peerCardCreate: true,
  summary: true,
  shortInterval: 20,
  longInterval: 60,
  dream: true,
} as const;

const KNOWN_KEYS = new Set(["reasoning", "peer_card", "summary", "dream"]);

interface ReasoningCfg {
  enabled?: boolean | null;
  custom_instructions?: string | null;
}
interface PeerCardCfg {
  use?: boolean | null;
  create?: boolean | null;
}
interface SummaryCfg {
  enabled?: boolean | null;
  messages_per_short_summary?: number | null;
  messages_per_long_summary?: number | null;
}
interface DreamCfg {
  enabled?: boolean | null;
}
interface WorkspaceCfg {
  reasoning?: ReasoningCfg | null;
  peer_card?: PeerCardCfg | null;
  summary?: SummaryCfg | null;
  dream?: DreamCfg | null;
  [k: string]: unknown;
}

/** `null` = inherit the global default (not explicitly stored). */
type Tri = boolean | null;

export function WorkspaceConfigModal({
  workspace,
  onClose,
  onSaved,
}: {
  workspace: ApiWorkspace | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const apiOpts = useActiveHonchoOptions();
  const { push } = useToast();
  const confirm = useConfirm();
  const { enabled: canWrite } = useWriteActions();

  const [mode, setMode] = useState<"form" | "json">("form");
  const [saving, setSaving] = useState(false);

  // Form state. `null` toggles inherit the default; empty strings inherit too.
  const [reasoning, setReasoning] = useState<Tri>(null);
  const [customInstructions, setCustomInstructions] = useState("");
  const [pcUse, setPcUse] = useState<Tri>(null);
  const [pcCreate, setPcCreate] = useState<Tri>(null);
  const [summary, setSummary] = useState<Tri>(null);
  const [shortInterval, setShortInterval] = useState("");
  const [longInterval, setLongInterval] = useState("");
  const [dream, setDream] = useState<Tri>(null);

  const [jsonText, setJsonText] = useState("");
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneId, setCloneId] = useState("");

  // Seed every field from the workspace's stored configuration whenever it opens.
  useEffect(() => {
    if (!workspace) return;
    const c = (workspace.configuration ?? {}) as WorkspaceCfg;
    setMode("form");
    setReasoning(c.reasoning?.enabled ?? null);
    setCustomInstructions(c.reasoning?.custom_instructions ?? "");
    setPcUse(c.peer_card?.use ?? null);
    setPcCreate(c.peer_card?.create ?? null);
    setSummary(c.summary?.enabled ?? null);
    setShortInterval(
      c.summary?.messages_per_short_summary != null
        ? String(c.summary.messages_per_short_summary)
        : "",
    );
    setLongInterval(
      c.summary?.messages_per_long_summary != null
        ? String(c.summary.messages_per_long_summary)
        : "",
    );
    setDream(c.dream?.enabled ?? null);
    setCloneOpen(false);
    setCloneId("");
  }, [workspace]);

  /** Build the configuration dict, writing only explicitly-set fields and
   *  preserving any unknown keys already on the workspace. */
  const buildConfig = useMemo(
    () =>
      function build(): WorkspaceCfg {
        const out: WorkspaceCfg = {};

        const reasoningCfg: ReasoningCfg = {};
        if (reasoning !== null) reasoningCfg.enabled = reasoning;
        if (customInstructions.trim()) reasoningCfg.custom_instructions = customInstructions.trim();
        if (Object.keys(reasoningCfg).length) out.reasoning = reasoningCfg;

        const peerCardCfg: PeerCardCfg = {};
        if (pcUse !== null) peerCardCfg.use = pcUse;
        if (pcCreate !== null) peerCardCfg.create = pcCreate;
        if (Object.keys(peerCardCfg).length) out.peer_card = peerCardCfg;

        const summaryCfg: SummaryCfg = {};
        if (summary !== null) summaryCfg.enabled = summary;
        if (shortInterval.trim()) summaryCfg.messages_per_short_summary = Number(shortInterval);
        if (longInterval.trim()) summaryCfg.messages_per_long_summary = Number(longInterval);
        if (Object.keys(summaryCfg).length) out.summary = summaryCfg;

        const dreamCfg: DreamCfg = {};
        if (dream !== null) dreamCfg.enabled = dream;
        if (Object.keys(dreamCfg).length) out.dream = dreamCfg;

        // Preserve unknown keys (server allows extra config fields).
        const original = (workspace?.configuration ?? {}) as Record<string, unknown>;
        for (const [k, v] of Object.entries(original)) {
          if (!KNOWN_KEYS.has(k)) out[k] = v;
        }
        return out;
      },
    [
      reasoning,
      customInstructions,
      pcUse,
      pcCreate,
      summary,
      shortInterval,
      longInterval,
      dream,
      workspace,
    ],
  );

  /** Reject summary intervals that violate the server's constraints up front. */
  function validateIntervals(cfg: WorkspaceCfg): string | null {
    const s = cfg.summary?.messages_per_short_summary;
    const l = cfg.summary?.messages_per_long_summary;
    if (s != null && (!Number.isFinite(s) || s < 10)) return "Short summary interval must be ≥ 10";
    if (l != null && (!Number.isFinite(l) || l < 20)) return "Long summary interval must be ≥ 20";
    if (s != null && l != null && s >= l)
      return "Short summary interval must be less than the long interval";
    return null;
  }

  function resolveConfig(): WorkspaceCfg | null {
    if (mode === "json") {
      try {
        const parsed = jsonText.trim() ? JSON.parse(jsonText) : {};
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("not an object");
        }
        return parsed as WorkspaceCfg;
      } catch {
        push({ type: "error", message: "Configuration must be a JSON object" });
        return null;
      }
    }
    return buildConfig();
  }

  function switchMode(next: "form" | "json") {
    if (next === mode) return;
    if (next === "json") {
      setJsonText(JSON.stringify(buildConfig(), null, 2));
      setMode("json");
      return;
    }
    // json -> form: try to re-seed the form from the edited JSON.
    try {
      const parsed = jsonText.trim() ? (JSON.parse(jsonText) as WorkspaceCfg) : {};
      setReasoning(parsed.reasoning?.enabled ?? null);
      setCustomInstructions(parsed.reasoning?.custom_instructions ?? "");
      setPcUse(parsed.peer_card?.use ?? null);
      setPcCreate(parsed.peer_card?.create ?? null);
      setSummary(parsed.summary?.enabled ?? null);
      setShortInterval(
        parsed.summary?.messages_per_short_summary != null
          ? String(parsed.summary.messages_per_short_summary)
          : "",
      );
      setLongInterval(
        parsed.summary?.messages_per_long_summary != null
          ? String(parsed.summary.messages_per_long_summary)
          : "",
      );
      setDream(parsed.dream?.enabled ?? null);
      setMode("form");
    } catch {
      push({ type: "error", message: "Fix the JSON before switching to the form" });
    }
  }

  async function save() {
    if (!apiOpts || !workspace) return;
    const cfg = resolveConfig();
    if (!cfg) return;
    const err = validateIntervals(cfg);
    if (err) {
      push({ type: "error", message: err });
      return;
    }
    const ok = await confirm({
      title: "SAVE_WORKSPACE_CONFIG",
      confirmLabel: "SAVE",
      body: (
        <>
          Save configuration for workspace{" "}
          <span className="text-accent font-mono">{workspace.id}</span> on the live instance?
        </>
      ),
    });
    if (!ok) return;
    setSaving(true);
    try {
      await honcho.workspaces.update(apiOpts, workspace.id, { configuration: cfg });
      push({ type: "success", message: `Config saved for ${workspace.id}` });
      invalidate("workspaces");
      onSaved();
      onClose();
    } catch (e) {
      push({ type: "error", message: formatApiError(e) });
    } finally {
      setSaving(false);
    }
  }

  async function clone() {
    if (!apiOpts) return;
    const id = cloneId.trim();
    if (!id) {
      push({ type: "error", message: "New workspace id is required" });
      return;
    }
    const cfg = resolveConfig();
    if (!cfg) return;
    const err = validateIntervals(cfg);
    if (err) {
      push({ type: "error", message: err });
      return;
    }
    const ok = await confirm({
      title: "CREATE_WORKSPACE",
      confirmLabel: "CREATE",
      body: (
        <>
          Create workspace <span className="text-accent font-mono">{id}</span> with the cloned
          configuration on the live instance?
        </>
      ),
    });
    if (!ok) return;
    setSaving(true);
    try {
      await honcho.workspaces.create(apiOpts, { id, configuration: cfg });
      push({ type: "success", message: `Workspace ${id} created with cloned config` });
      invalidate("workspaces");
      onSaved();
      onClose();
    } catch (e) {
      push({ type: "error", message: formatApiError(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="WORKSPACE_CONFIG"
      open={!!workspace}
      onClose={onClose}
      className="max-w-3xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {canWrite ? "CANCEL" : "CLOSE"}
          </Button>
          {canWrite ? (
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? "SAVING…" : "SAVE"}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-text-muted">
          editing config for{" "}
          <span className="text-accent font-mono">{workspace?.id}</span>
        </div>
        <PillTabs
          items={[
            { key: "form", label: "FORM" },
            { key: "json", label: "JSON" },
          ]}
          current={mode}
          onChange={switchMode}
        />
      </div>

      <div className="max-h-[60vh] overflow-y-auto pr-1 -mr-1">
        {mode === "json" ? (
          <Field
            label="CONFIGURATION (JSON)"
            hint="Full workspace configuration. Must be a JSON object."
          >
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              rows={16}
              spellCheck={false}
              className="w-full bg-void border border-border px-3 py-2 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:border-accent outline-none transition-colors duration-150 resize-y"
            />
          </Field>
        ) : (
          <div className="space-y-3">
            <Panel title="REASONING" status="idle">
              <ConfigToggle
                label="Enabled"
                value={reasoning}
                fallback={DEFAULTS.reasoning}
                onChange={setReasoning}
              />
              <Field
                label="CUSTOM_INSTRUCTIONS"
                hint="Optional extra guidance for the reasoning system. Leave blank to inherit."
                className="mt-3"
              >
                <textarea
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  rows={3}
                  spellCheck={false}
                  placeholder="(none)"
                  className="w-full bg-void border border-border px-3 py-2 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:border-accent outline-none transition-colors duration-150 resize-y"
                />
              </Field>
            </Panel>

            <Panel title="PEER_CARD" status="idle">
              <div className="space-y-2.5">
                <ConfigToggle
                  label="Use peer card during reasoning"
                  value={pcUse}
                  fallback={DEFAULTS.peerCardUse}
                  onChange={setPcUse}
                />
                <ConfigToggle
                  label="Generate peer card from content"
                  value={pcCreate}
                  fallback={DEFAULTS.peerCardCreate}
                  onChange={setPcCreate}
                />
              </div>
            </Panel>

            <Panel title="SUMMARY" status="idle">
              <ConfigToggle
                label="Enabled"
                value={summary}
                fallback={DEFAULTS.summary}
                onChange={setSummary}
              />
              <div className="grid grid-cols-2 gap-3 mt-3">
                <Field label="SHORT_SUMMARY_INTERVAL" hint="min 10 msgs">
                  <TextInput
                    type="number"
                    min={10}
                    inputMode="numeric"
                    value={shortInterval}
                    placeholder={`Default (${DEFAULTS.shortInterval})`}
                    onChange={(e) => setShortInterval(e.target.value)}
                  />
                </Field>
                <Field label="LONG_SUMMARY_INTERVAL" hint="min 20 msgs">
                  <TextInput
                    type="number"
                    min={20}
                    inputMode="numeric"
                    value={longInterval}
                    placeholder={`Default (${DEFAULTS.longInterval})`}
                    onChange={(e) => setLongInterval(e.target.value)}
                  />
                </Field>
              </div>
            </Panel>

            <Panel title="DREAM" status="idle">
              <ConfigToggle
                label="Enabled"
                value={dream}
                fallback={DEFAULTS.dream}
                onChange={setDream}
              />
            </Panel>

            <div className="pt-1">
              {!canWrite ? null : cloneOpen ? (
                <div className="space-y-2">
                  <Field
                    label="NEW WORKSPACE ID"
                    hint="Creates a new workspace seeded with the config above."
                  >
                    <TextInput
                      autoFocus
                      placeholder="e.g., staging"
                      value={cloneId}
                      onChange={(e) => setCloneId(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !saving) clone();
                      }}
                    />
                  </Field>
                  <div className="flex items-center gap-2">
                    <Button variant="primary" onClick={clone} disabled={saving}>
                      {saving ? "CREATING…" : "CREATE_WITH_CLONED_CONFIG"}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setCloneOpen(false)}
                      disabled={saving}
                    >
                      CANCEL
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="outline" icon="copy" onClick={() => setCloneOpen(true)}>
                  CREATE_NEW_WORKSPACE_WITH_CLONED_CONFIG
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ConfigToggle({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: Tri;
  fallback: boolean;
  /** Accepts the tri-state directly: a boolean makes it explicit, `null` reverts. */
  onChange: (next: Tri) => void;
}) {
  const effective = value ?? fallback;
  return (
    <div className="flex items-center gap-2.5">
      <Checkbox checked={effective} onChange={(next) => onChange(next)} label={label} />
      {value === null ? (
        <Chip tone="muted">default</Chip>
      ) : (
        <button
          onClick={() => onChange(null)}
          className="text-[10px] text-text-muted hover:text-accent uppercase tracking-wider flex items-center gap-1"
          title="Revert to default"
          type="button"
        >
          <Icon name="refresh" size={9} /> reset
        </button>
      )}
    </div>
  );
}
