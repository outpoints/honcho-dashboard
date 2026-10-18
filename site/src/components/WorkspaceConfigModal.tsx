"use client";

import { useEffect, useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Modal } from "@/components/Modal";
import { Panel } from "@/components/Panel";
import { Button, Checkbox, Chip, Field, PillTabs, TextInput } from "@/components/atoms";
import { HonchoFeatureNotice } from "@/components/HonchoFeatureNotice";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm";
import { useWriteActions } from "@/lib/writeActions";
import { honcho } from "@/lib/honcho/client";
import { useActiveHonchoOptions } from "@/lib/honcho/config";
import { useHonchoCapabilities } from "@/lib/honcho/useCapabilities";
import { formatApiError, invalidate } from "@/lib/honcho/useQuery";
import { HonchoApiError, type ApiWorkspace } from "@/lib/honcho/types";
import {
  buildWorkspaceConfiguration,
  instructionFieldsInError,
  instructionState,
  seedWorkspaceConfigForm,
  validateWorkspaceConfiguration,
  withClearedKeys,
  type InstructionKey,
  type InstructionModule,
  type InstructionState,
  type Instructions,
  type Tri,
  type WorkspaceConfigForm,
} from "@/lib/honcho/workspaceConfig";
import { cn } from "@/lib/utils";

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

type Config = Record<string, unknown>;

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

const TEXTAREA_CLASS =
  "w-full bg-void border border-border px-3 py-2 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:border-accent outline-none transition-colors duration-150 resize-y";

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
  const { customInstructions: instructionsState } = useHonchoCapabilities();
  const instructionsAvailable = instructionsState === "available";

  const [mode, setMode] = useState<"form" | "json">("form");
  const [saving, setSaving] = useState(false);

  // The form is overlaid onto `base` on save, so keys it does not show survive.
  const [base, setBase] = useState<Config>({});
  const [form, setForm] = useState<WorkspaceConfigForm>(() => seedWorkspaceConfigForm({}));

  const [jsonText, setJsonText] = useState("");
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneId, setCloneId] = useState("");
  // Instruction fields start collapsed and show a one-line summary.
  const [openFields, setOpenFields] = useState<Partial<Record<InstructionKey, boolean>>>({});

  // Seed every field from the workspace's stored configuration whenever it opens.
  useEffect(() => {
    if (!workspace) return;
    const stored = (workspace.configuration ?? {}) as Config;
    setMode("form");
    setBase(stored);
    setForm(seedWorkspaceConfigForm(stored));
    setCloneOpen(false);
    setCloneId("");
    setOpenFields({});
  }, [workspace]);

  const update = (patch: Partial<WorkspaceConfigForm>) => setForm((prev) => ({ ...prev, ...patch }));
  const setInstruction = (agent: InstructionModule) => (value: Instructions) =>
    setForm((prev) => ({ ...prev, instructions: { ...prev.instructions, [agent]: value } }));
  const toggleField = (key: InstructionKey) => () =>
    setOpenFields((prev) => ({ ...prev, [key]: !prev[key] }));

  /** Open any instruction field the server rejected, so the error is not hidden. */
  function revealRejectedFields(error: unknown) {
    if (!(error instanceof HonchoApiError) || error.status !== 422) return;
    const keys = instructionFieldsInError(error.body);
    if (keys.length) setOpenFields((prev) => ({ ...prev, ...Object.fromEntries(keys.map((key) => [key, true])) }));
  }

  function buildConfig(): Config {
    return buildWorkspaceConfiguration(base, form, { customInstructions: instructionsAvailable });
  }

  function resolveConfig(): Config | null {
    if (mode === "json") {
      try {
        const parsed = jsonText.trim() ? JSON.parse(jsonText) : {};
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("not an object");
        }
        return parsed as Config;
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
    // json -> form: re-seed the form and keep the edited JSON as the overlay base.
    try {
      const parsed = jsonText.trim() ? JSON.parse(jsonText) : {};
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("not an object");
      }
      setBase(parsed as Config);
      setForm(seedWorkspaceConfigForm(parsed));
      setMode("form");
    } catch {
      push({ type: "error", message: "Fix the JSON before switching to the form" });
    }
  }

  async function save() {
    if (!apiOpts || !workspace) return;
    const resolved = resolveConfig();
    if (!resolved) return;
    const err = validateWorkspaceConfiguration(resolved);
    if (err) {
      push({ type: "error", message: err });
      return;
    }
    const cfg = withClearedKeys(workspace.configuration, resolved);
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
      revealRejectedFields(e);
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
    const err = validateWorkspaceConfiguration(cfg);
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
      revealRejectedFields(e);
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
            hint="Full workspace configuration. Must be a JSON object. A removed section is saved as empty."
          >
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              rows={16}
              spellCheck={false}
              className={TEXTAREA_CLASS}
            />
          </Field>
        ) : (
          <div className="space-y-3">
            {instructionsAvailable ? (
              <Panel title="SHARED_INSTRUCTIONS" status="idle">
                <InstructionsField
                  label="CUSTOM_INSTRUCTIONS"
                  hint="Used by the deriver, summaries, dialectic chat, and dreams unless a section sets its own. Session settings override these."
                  value={form.sharedInstructions}
                  onChange={(value) => update({ sharedInstructions: value })}
                  placeholder="(none)"
                  rows={3}
                  open={!!openFields.shared}
                  onToggle={toggleField("shared")}
                />
              </Panel>
            ) : (
              <HonchoFeatureNotice
                state={instructionsState}
                minimum="3.3"
                feature="Shared and per-agent instruction editing"
              />
            )}

            <Panel title="REASONING" status="idle">
              <ConfigToggle
                label="Enabled"
                value={form.reasoning}
                fallback={DEFAULTS.reasoning}
                onChange={(value) => update({ reasoning: value })}
              />
              <InstructionsField
                label="CUSTOM_INSTRUCTIONS"
                hint={
                  instructionsAvailable
                    ? "Deriver only. Overrides the shared instructions."
                    : "Optional extra guidance for the reasoning system. Leave blank to inherit."
                }
                value={form.instructions.reasoning}
                onChange={setInstruction("reasoning")}
                inheritsShared={instructionsAvailable}
                placeholder={instructionsAvailable ? "Inherits shared instructions" : "(none)"}
                rows={3}
                open={!!openFields.reasoning}
                onToggle={toggleField("reasoning")}
                className="mt-3"
              />
            </Panel>

            <Panel title="PEER_CARD" status="idle">
              <div className="space-y-2.5">
                <ConfigToggle
                  label="Use peer card during reasoning"
                  value={form.peerCardUse}
                  fallback={DEFAULTS.peerCardUse}
                  onChange={(value) => update({ peerCardUse: value })}
                />
                <ConfigToggle
                  label="Generate peer card from content"
                  value={form.peerCardCreate}
                  fallback={DEFAULTS.peerCardCreate}
                  onChange={(value) => update({ peerCardCreate: value })}
                />
              </div>
              {instructionsAvailable ? (
                <InstructionsField
                  label="CUSTOM_INSTRUCTIONS"
                  hint="Added to the dream instructions when peer cards update. Does not use the shared instructions."
                  value={form.instructions.peer_card}
                  onChange={setInstruction("peer_card")}
                  placeholder="(none)"
                  open={!!openFields.peer_card}
                  onToggle={toggleField("peer_card")}
                  className="mt-3"
                />
              ) : null}
            </Panel>

            <Panel title="SUMMARY" status="idle">
              <ConfigToggle
                label="Enabled"
                value={form.summary}
                fallback={DEFAULTS.summary}
                onChange={(value) => update({ summary: value })}
              />
              <div className="grid grid-cols-2 gap-3 mt-3">
                <Field label="SHORT_SUMMARY_INTERVAL" hint="min 10 msgs">
                  <TextInput
                    type="number"
                    min={10}
                    inputMode="numeric"
                    value={form.shortInterval}
                    placeholder={`Default (${DEFAULTS.shortInterval})`}
                    onChange={(e) => update({ shortInterval: e.target.value })}
                  />
                </Field>
                <Field label="LONG_SUMMARY_INTERVAL" hint="min 20 msgs">
                  <TextInput
                    type="number"
                    min={20}
                    inputMode="numeric"
                    value={form.longInterval}
                    placeholder={`Default (${DEFAULTS.longInterval})`}
                    onChange={(e) => update({ longInterval: e.target.value })}
                  />
                </Field>
              </div>
              {instructionsAvailable ? (
                <InstructionsField
                  label="CUSTOM_INSTRUCTIONS"
                  hint="Overrides the shared instructions for session summaries."
                  value={form.instructions.summary}
                  onChange={setInstruction("summary")}
                  inheritsShared
                  placeholder="Inherits shared instructions"
                  open={!!openFields.summary}
                  onToggle={toggleField("summary")}
                  className="mt-3"
                />
              ) : null}
            </Panel>

            <Panel title="DREAM" status="idle">
              <ConfigToggle
                label="Enabled"
                value={form.dream}
                fallback={DEFAULTS.dream}
                onChange={(value) => update({ dream: value })}
              />
              {instructionsAvailable ? (
                <InstructionsField
                  label="CUSTOM_INSTRUCTIONS"
                  hint="Overrides the shared instructions for dreams."
                  value={form.instructions.dream}
                  onChange={setInstruction("dream")}
                  inheritsShared
                  placeholder="Inherits shared instructions"
                  open={!!openFields.dream}
                  onToggle={toggleField("dream")}
                  className="mt-3"
                />
              ) : null}
            </Panel>

            {instructionsAvailable ? (
              <Panel title="DIALECTIC" status="idle">
                <InstructionsField
                  label="CUSTOM_INSTRUCTIONS"
                  hint="Overrides the shared instructions for peer and workspace chat."
                  value={form.instructions.dialectic}
                  onChange={setInstruction("dialectic")}
                  inheritsShared
                  placeholder="Inherits shared instructions"
                  open={!!openFields.dialectic}
                  onToggle={toggleField("dialectic")}
                />
              </Panel>
            ) : null}

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

/** What a collapsed field says when it holds no text of its own. */
const SUMMARY_TEXT: Record<Exclude<InstructionState, "custom">, string> = {
  none: "no instructions",
  inherits: "inherits shared",
  unset: "not set",
};

/**
 * A collapsible instruction field. Collapsed, it shows one line: the text itself,
 * or whether it inherits, is unset, or is explicitly empty. `null` = unset
 * (inherit), `""` = explicitly none, text = custom. `inheritsShared` marks
 * sections that fall back to the shared text and offers the explicit-none state.
 */
function InstructionsField({
  label,
  hint,
  value,
  onChange,
  inheritsShared = false,
  placeholder,
  rows = 2,
  open,
  onToggle,
  className,
}: {
  label: string;
  hint: string;
  value: Instructions;
  onChange: (next: Instructions) => void;
  inheritsShared?: boolean;
  placeholder: string;
  rows?: number;
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const id = useId();
  const reducedMotion = useReducedMotion();
  const none = inheritsShared && value === "";
  const state = instructionState(value, inheritsShared);
  const summary = state === "custom" ? (value ?? "").trim() : SUMMARY_TEXT[state];
  return (
    <div className={className}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={open ? `${id}-body` : undefined}
        className="group w-full flex items-center gap-2 py-0.5 text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-2"
      >
        <Icon
          name="chevron-right"
          size={11}
          className={cn("shrink-0 text-text-muted transition-transform duration-150", open && "rotate-90")}
        />
        <span
          id={`${id}-label`}
          className="shrink-0 text-[10px] text-text-muted uppercase tracking-wider group-hover:text-text-primary transition-colors duration-150"
        >
          {label}
        </span>
        {open ? null : (
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[11px]",
              state === "custom" ? "text-text-primary" : "text-text-muted",
            )}
          >
            {summary}
          </span>
        )}
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="body"
            id={`${id}-body`}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.2, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="pt-2 space-y-1.5">
              <textarea
                aria-labelledby={`${id}-label`}
                value={value ?? ""}
                onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
                disabled={none}
                rows={rows}
                spellCheck={false}
                placeholder={none ? "No instructions" : placeholder}
                className={`${TEXTAREA_CLASS} disabled:opacity-50 disabled:cursor-not-allowed`}
              />
              <div className="text-[10px] text-text-muted">{hint}</div>
              {inheritsShared ? (
                <Checkbox
                  className="pt-1"
                  checked={none}
                  onChange={(next) => onChange(next ? "" : null)}
                  label="No instructions"
                  hint="Don't use the shared instructions here."
                />
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
