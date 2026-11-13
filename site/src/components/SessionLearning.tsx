"use client";

import { useMemo, useState } from "react";
import { Button, Chip, ToggleButton, TextInput } from "@/components/atoms";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm";
import { useWriteActions } from "@/lib/writeActions";
import { honcho } from "@/lib/honcho/client";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { useHonchoCapabilities } from "@/lib/honcho/useCapabilities";
import { formatApiError, useHonchoQuery } from "@/lib/honcho/useQuery";
import { useListTotal } from "@/lib/honcho/useListTotal";
import type { ApiQueueStatus } from "@/lib/honcho/types";
import type { InstructionKey, Instructions } from "@/lib/honcho/workspaceConfig";
import {
  SESSION_SWITCHES,
  flagChoice,
  isScopeMember,
  learnersAbout,
  loadSessionSettings,
  planMemberChanges,
  planSessionChanges,
  resolveInstructions,
  resolveIntervals,
  resolveMember,
  resolveSwitches,
  saveSessionSettings,
  seedSessionSettingsForm,
  validateSessionSettings,
  type ChangeStatus,
  type Choice,
  type FlagChoice,
  type MemberEdits,
  type MemberField,
  type SaveResult,
  type SessionSettingsForm,
  type SessionSettingsState,
  type SettingChange,
  type SettingSource,
  type SwitchKey,
} from "@/lib/honcho/sessionSettings";
import { sessionSettingsIO } from "@/lib/honcho/sessionSettingsIO";
import { cn } from "@/lib/utils";

const TEXTAREA_CLASS =
  "w-full bg-void border border-border px-3 py-2 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:border-accent outline-none transition-colors duration-150 resize-y";

const INSTRUCTION_ROWS: { key: InstructionKey; label: string }[] = [
  { key: "shared", label: "SHARED" },
  { key: "reasoning", label: "CONCLUSIONS" },
  { key: "summary", label: "SUMMARIES" },
  { key: "dream", label: "DREAMS" },
  { key: "dialectic", label: "CHAT" },
  { key: "peer_card", label: "PEER_CARD" },
];

const STATUS_CHIP: Record<ChangeStatus, { tone: "accent" | "danger" | "muted" | "warn"; label: string }> = {
  saved: { tone: "accent", label: "saved" },
  not_saved: { tone: "danger", label: "not saved" },
  not_sent: { tone: "muted", label: "not sent" },
  unknown: { tone: "warn", label: "unknown" },
};

interface Draft {
  revision: string;
  form: SessionSettingsForm;
  members: MemberEdits;
}

/**
 * What Honcho learns from new messages in one session: the session's own
 * switches (with the value in effect and where it comes from), each member's
 * observation flags, this session's queue, and its stored conclusions. Edits
 * are reviewed together, confirmed, written once and read back.
 */
export function SessionLearning({
  workspaceId,
  sessionId,
  workspaceConfig,
  onSaved,
}: {
  workspaceId: string;
  sessionId: string;
  /** The workspace's stored configuration, or undefined when it couldn't be read. */
  workspaceConfig: unknown | undefined;
  onSaved: () => void;
}) {
  const apiOpts = useActiveHonchoOptions();
  const { push } = useToast();
  const confirm = useConfirm();
  const { enabled: canWrite } = useWriteActions();
  const { honcho31, customInstructions } = useHonchoCapabilities();
  const { workspaceId: activeWorkspaceId, setWorkspaceId } = useActiveWorkspace();
  const instructionsAvailable = customInstructions === "available";
  const options = useMemo(() => ({ customInstructions: instructionsAvailable }), [instructionsAvailable]);

  const settings = useHonchoQuery<SessionSettingsState | null>(
    `session-settings/${workspaceId}/${sessionId}`,
    (o) => loadSessionSettings(sessionSettingsIO(o, workspaceId, sessionId)),
  );
  const queue = useHonchoQuery<ApiQueueStatus>(
    `queue/session/${workspaceId}/${sessionId}`,
    (o) => honcho.queue.status(o, workspaceId, { sessionId }),
    { refreshInterval: (d) => (d && d.pending_work_units + d.in_progress_work_units > 0 ? 5000 : undefined) },
  );
  const listTotal = useListTotal();
  const stored = useHonchoQuery(
    `conclusions/list/${workspaceId}/session/${sessionId}/count`,
    (o) => honcho.conclusions.list(o, workspaceId, { page: 1, size: 1, filters: { session_id: sessionId } }),
  );

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  // Instruction rows set to CUSTOM with no text yet, per revision.
  const [incomplete, setIncomplete] = useState<{ revision: string; keys: Partial<Record<InstructionKey, boolean>> } | null>(null);
  // Bumped on discard and save so instruction rows drop local state.
  const [epoch, setEpoch] = useState(0);

  const state = settings.data ?? null;
  // A draft belongs to the revision it was made on; a reload with other values drops it.
  const live = state && draft?.revision === state.revision ? draft : null;
  const incompleteKeys = state && incomplete?.revision === state.revision
    ? Object.entries(incomplete.keys).filter(([, value]) => value).map(([key]) => key)
    : [];
  const form = live?.form ?? (state ? seedSessionSettingsForm(state.configuration) : null);
  const memberEdits = useMemo(() => live?.members ?? {}, [live]);
  const editable = canWrite && honcho31 === "available" && !!state;

  const plan = useMemo((): { changes: SettingChange[]; error: string | null } => {
    if (!state || !form) return { changes: [], error: null };
    try {
      return {
        changes: [...planSessionChanges(state.configuration, form, options), ...planMemberChanges(state.members ?? [], memberEdits)],
        error: null,
      };
    } catch (error) {
      return { changes: [], error: error instanceof Error ? error.message : String(error) };
    }
  }, [state, form, memberEdits, options]);
  const changedIds = new Set(plan.changes.map((change) => change.id));

  if (settings.error) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-xs text-red-400">
        <span>
          Couldn&apos;t read this session&apos;s settings: {formatApiError(settings.error)}{" "}
          <a href="#/config" className="underline underline-offset-2">Check CONFIG</a>
        </span>
        <Button variant="ghost" size="sm" icon="refresh" onClick={() => settings.refetch()}>RETRY</Button>
      </div>
    );
  }
  if (settings.isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 bg-border/40 animate-pulse" />)}
      </div>
    );
  }
  if (!state || !form) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted py-2">
        <span>Honcho no longer lists this session, or it is being deleted.</span>
        <Button variant="ghost" size="sm" icon="refresh" onClick={() => settings.refetch()}>CHECK_AGAIN</Button>
      </div>
    );
  }

  const switches = resolveSwitches(state.configuration, workspaceConfig);
  const intervals = resolveIntervals(state.configuration, workspaceConfig);
  const instructions = resolveInstructions(state.configuration, workspaceConfig, { shared: instructionsAvailable });
  const reasoning = switches.find((row) => row.key === "reasoning")!;
  const members = state.members ?? [];
  const learners = learnersAbout(members);

  const edit = (next: Partial<Draft>) =>
    setDraft({ revision: state.revision, form: next.form ?? form, members: next.members ?? memberEdits });
  const setSwitch = (key: SwitchKey, choice: Choice) => edit({ form: { ...form, switches: { ...form.switches, [key]: choice } } });
  const setInstruction = (key: InstructionKey, value: Instructions) =>
    edit({ form: key === "shared" ? { ...form, sharedInstructions: value } : { ...form, instructions: { ...form.instructions, [key]: value } } });
  const setMember = (peerId: string, field: MemberField, choice: FlagChoice) =>
    edit({ members: { ...memberEdits, [peerId]: { ...memberEdits[peerId], [field]: choice } } });
  const markIncomplete = (key: InstructionKey, value: boolean) =>
    setIncomplete((prev) => ({
      revision: state.revision,
      keys: { ...(prev?.revision === state.revision ? prev.keys : {}), [key]: value },
    }));
  const discard = () => {
    setDraft(null);
    setIncomplete(null);
    setEpoch((n) => n + 1);
  };

  const goToConclusions = () => {
    if (activeWorkspaceId !== workspaceId) setWorkspaceId(workspaceId);
    window.location.hash = `#/conclusions?session=${encodeURIComponent(sessionId)}`;
  };

  async function save() {
    if (!apiOpts || !state || !form || !plan.changes.length) return;
    const invalid = validateSessionSettings(form, workspaceConfig);
    if (invalid) {
      push({ type: "error", message: invalid });
      return;
    }
    const ok = await confirm({
      title: "SAVE_SESSION_SETTINGS",
      confirmLabel: "SAVE",
      body: (
        <div className="space-y-3">
          <p>
            Save {plan.changes.length} {plan.changes.length === 1 ? "change" : "changes"} to session{" "}
            <span className="text-accent font-mono">{sessionId}</span> on the live instance?
          </p>
          <ChangeList changes={plan.changes} />
          <p className="text-text-muted text-[11px]">
            They apply to messages saved after this. Stored memory stays, and work already queued keeps its old settings.
          </p>
        </div>
      ),
    });
    if (!ok) return;
    setSaving(true);
    setResult(null);
    try {
      const outcome = await saveSessionSettings(sessionSettingsIO(apiOpts, workspaceId, sessionId), {
        revision: state.revision,
        form,
        memberEdits,
        options,
      });
      const wrote = outcome.changes.some((change) => change.status !== "not_sent");
      if (outcome.outcome === "saved") {
        push({ type: "success", message: `Saved ${outcome.changes.length} ${outcome.changes.length === 1 ? "change" : "changes"}. Honcho returned the new values.` });
        discard();
      } else {
        push({ type: "error", message: outcome.message ?? "The save did not complete." });
        if (outcome.changes.length) setResult(outcome);
      }
      settings.refetch();
      queue.refetch();
      // Refetch the list in place (onSaved), not invalidate it: clearing it would
      // unmount this row and drop the open tab.
      if (wrote) onSaved();
    } catch (error) {
      push({ type: "error", message: formatApiError(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="session-learning">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-[11px] text-text-muted leading-relaxed max-w-[75ch]">
          What Honcho learns from messages saved to this session from now on. Stored conclusions, summaries and messages
          stay as they are.
        </p>
        {!canWrite ? (
          <Chip tone="muted" icon="key">read-only · enable in CONFIG</Chip>
        ) : honcho31 !== "available" ? (
          <span className="text-[10px] text-text-muted">
            {honcho31 === "checking" ? "Checking server version…" : "Server version is unverified, so these are read-only."}
          </span>
        ) : null}
      </div>

      <section aria-labelledby={`settings-${sessionId}`}>
        <SectionLabel id={`settings-${sessionId}`}>SETTINGS</SectionLabel>
        <div className="border border-border divide-y divide-border">
          <div className="hidden md:grid grid-cols-[minmax(10rem,14rem)_auto_1fr] gap-x-4 px-3 py-1.5 text-[9px] text-text-muted uppercase tracking-wider">
            <span>SETTING</span><span>THIS_SESSION</span><span className="text-right">IN_EFFECT_NOW</span>
          </div>
          {SESSION_SWITCHES.map((spec) => {
            const row = switches.find((item) => item.key === spec.key)!;
            const value = form.switches[spec.key];
            return (
              <SettingRow key={spec.key} label={spec.label} hint={spec.hint} changed={changedIds.has(`switch.${spec.key}`)}
                control={editable ? (
                  <ChoiceGroup label={spec.label} value={value} onChange={(next) => setSwitch(spec.key, next)}
                    options={[{ key: "inherit", label: "INHERIT" }, { key: "on", label: "ON" }, { key: "off", label: "OFF" }]} />
                ) : (
                  <span className="text-[11px] text-text-primary uppercase">{value === "inherit" ? "inherit" : value}</span>
                )}
                effect={<Effect value={row.effective} source={row.source} legacy={row.legacy} />}
              />
            );
          })}
          <SettingRow label="SUMMARY_INTERVALS" hint="Messages between a short summary, and between a long one."
            changed={changedIds.has("interval.short") || changedIds.has("interval.long")}
            control={editable ? (
              <div className="flex items-center gap-2">
                <IntervalInput label="SHORT" value={form.shortInterval} min={10}
                  onChange={(next) => edit({ form: { ...form, shortInterval: next } })} />
                <IntervalInput label="LONG" value={form.longInterval} min={20}
                  onChange={(next) => edit({ form: { ...form, longInterval: next } })} />
              </div>
            ) : (
              <span className="text-[11px] text-text-primary tabular-nums">
                {form.shortInterval || "inherit"} / {form.longInterval || "inherit"}
              </span>
            )}
            effect={
              <span className="text-[11px] tabular-nums">
                <IntervalEffect label="short" interval={intervals.short} />
                <span className="text-text-muted"> · </span>
                <IntervalEffect label="long" interval={intervals.long} />
              </span>
            }
          />
        </div>

        <div className="mt-2">
          <button
            type="button"
            onClick={() => setInstructionsOpen((open) => !open)}
            aria-expanded={instructionsOpen}
            aria-controls={instructionsOpen ? `instructions-${sessionId}` : undefined}
            className="group flex items-center gap-2 py-1 text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-2"
          >
            <Icon name="chevron-right" size={11} className={cn("text-text-muted transition-transform duration-150", instructionsOpen && "rotate-90")} />
            <span className="text-[10px] text-text-muted uppercase tracking-wider group-hover:text-text-primary">INSTRUCTIONS</span>
            <span className="text-[10px] text-text-muted">
              {instructions.filter((row) => row.stored !== null).length} set on this session
              {[...changedIds].some((id) => id.startsWith("instructions.")) ? " · edited" : ""}
            </span>
          </button>
          {instructionsOpen ? (
            <div id={`instructions-${sessionId}`} className="mt-1 border border-border divide-y divide-border">
              {INSTRUCTION_ROWS.filter((row) => instructions.some((item) => item.key === row.key)).map((row) => {
                const resolved = instructions.find((item) => item.key === row.key)!;
                const value = row.key === "shared" ? form.sharedInstructions : form.instructions[row.key];
                return (
                  <InstructionRow key={`${row.key}:${epoch}:${state.revision}`} label={row.label} value={value} editable={editable}
                    changed={changedIds.has(`instructions.${row.key}`)}
                    inheritLocked={row.key === "shared" && typeof state.configuration.custom_instructions === "string"}
                    effective={resolved.effective} source={resolved.source}
                    onChange={(next) => setInstruction(row.key, next)}
                    onIncomplete={(value) => markIncomplete(row.key, value)} />
                );
              })}
              {!instructionsAvailable ? (
                <p className="px-3 py-2 text-[10px] text-text-muted">
                  Shared and per-agent instructions need Honcho 3.3 or later, confirmed. Others stored on this session are kept.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section aria-labelledby={`observation-${sessionId}`}>
        <SectionLabel id={`observation-${sessionId}`}>OBSERVATION</SectionLabel>
        <p className="text-[10px] text-text-muted leading-relaxed max-w-[90ch] mb-2">
          OBSERVED: Honcho learns about the peer from its messages here. OBSERVES_OTHERS: the peer builds its own view of
          the others here. A peer that isn&apos;t observed gets no conclusions from anyone.
          {reasoning.effective === false ? " Conclusions are off for this session, so none of this applies until they are back on." : ""}
        </p>
        {state.membersError ? (
          <div className="text-xs text-red-400">Couldn&apos;t read the members: {state.membersError}</div>
        ) : members.length === 0 ? (
          <div className="text-[11px] text-text-muted italic">No members. Add a peer on the CONVERSATION tab.</div>
        ) : (
          <div className="border border-border divide-y divide-border">
            <div className="hidden md:grid grid-cols-[minmax(8rem,1fr)_1.3fr_1.3fr_1fr] gap-3 px-3 py-1.5 text-[9px] text-text-muted uppercase tracking-wider">
              <span>PEER</span><span>OBSERVED</span><span>OBSERVES_OTHERS</span><span>VIEWS_OF_IT_FROM_HERE</span>
            </div>
            {members.map((member) => {
              const resolved = resolveMember(member);
              const scope = isScopeMember(member.id);
              const edits = memberEdits[member.id] ?? {};
              const flag = (field: MemberField) => {
                const current = flagChoice(field === "observe_me" ? member.observeMe : member.observeOthers);
                const value = edits[field] ?? current;
                const effective = field === "observe_me" ? resolved.observeMe : resolved.observeOthers;
                return (
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className="md:hidden text-[9px] text-text-muted uppercase tracking-wider w-full">
                      {field === "observe_me" ? "OBSERVED" : "OBSERVES_OTHERS"}
                    </span>
                    {editable && !scope ? (
                      <ChoiceGroup label={`${member.id} ${field}`} value={value} onChange={(next) => setMember(member.id, field, next)}
                        options={[
                          ...(current === "unset" ? [{ key: "unset" as const, label: "UNSET" }] : []),
                          { key: "on" as const, label: "ON" },
                          { key: "off" as const, label: "OFF" },
                        ]} />
                    ) : null}
                    <span className="text-[11px]">
                      {/* Only an unobserved peer is notable; not observing others is the default. */}
                      <span className={effective.effective || field === "observe_others" ? "text-text-primary" : "text-yellow-400"}>
                        {effective.effective ? "ON" : "OFF"}
                      </span>
                      <span className="text-text-muted"> · {memberSource(effective.source)}</span>
                    </span>
                    {changedIds.has(`member.${member.id}.${field}`) ? <Chip tone="accent">edited</Chip> : null}
                  </div>
                );
              };
              const views = learners[member.id] ?? [];
              return (
                <div key={member.id} className="grid grid-cols-1 md:grid-cols-[minmax(8rem,1fr)_1.3fr_1.3fr_1fr] gap-x-3 gap-y-2 px-3 py-2 items-center">
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="text-xs text-text-primary font-mono truncate" title={member.id}>{member.id}</span>
                    {scope ? <Chip tone="muted" icon="focus">SCOPE</Chip> : null}
                  </div>
                  {flag("observe_me")}
                  {flag("observe_others")}
                  <div className="text-[11px] min-w-0">
                    <span className="md:hidden text-[9px] text-text-muted uppercase tracking-wider block">VIEWS_OF_IT_FROM_HERE</span>
                    {views.length ? (
                      <span className="text-text-primary break-words">{views.join(", ")}</span>
                    ) : (
                      <span className="text-text-muted">nobody</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {state.membersTruncated ? (
          <p className="mt-1 text-[10px] text-text-muted">Showing the first {members.length} members.</p>
        ) : null}
        {editable && members.some((member) => member.observeMe !== null || member.observeOthers !== null) ? (
          <p className="mt-1 text-[10px] text-text-muted">Honcho can&apos;t clear a session flag back to unset once it is on or off.</p>
        ) : null}
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <section className="border border-border px-3 py-2 space-y-1.5" aria-labelledby={`queue-${sessionId}`}>
          <div className="flex items-center justify-between gap-2">
            <SectionLabel id={`queue-${sessionId}`} className="mb-0">QUEUE</SectionLabel>
            <Button variant="ghost" size="sm" icon="refresh" onClick={() => queue.refetch()} aria-label="Refresh this session's queue">
              REFRESH
            </Button>
          </div>
          {queue.error ? (
            <div className="text-[11px] text-red-400">{formatApiError(queue.error)}</div>
          ) : !queue.data ? (
            <div className="h-4 w-48 bg-border/40 animate-pulse" />
          ) : (
            <div className="text-[11px] text-text-primary tabular-nums">
              <span className={queue.data.pending_work_units ? "text-yellow-400" : undefined}>{queue.data.pending_work_units} waiting</span>
              {" · "}{queue.data.in_progress_work_units} running · {queue.data.completed_work_units} done
            </div>
          )}
          <p className="text-[10px] text-text-muted leading-relaxed">
            Work queued before a change keeps the settings it was queued with. Done counts reset at Honcho&apos;s periodic cleanup.
          </p>
        </section>

        <section className="border border-border px-3 py-2 space-y-1.5" aria-labelledby={`stored-${sessionId}`}>
          <div className="flex items-center justify-between gap-2">
            <SectionLabel id={`stored-${sessionId}`} className="mb-0">STORED_CONCLUSIONS</SectionLabel>
            <Button variant="ghost" size="sm" icon="arrow-right" onClick={goToConclusions}>VIEW_CONCLUSIONS</Button>
          </div>
          {stored.error ? (
            <div className="text-[11px] text-red-400">{formatApiError(stored.error)}</div>
          ) : !stored.data ? (
            <div className="h-4 w-40 bg-border/40 animate-pulse" />
          ) : (
            <div className="text-[11px] text-text-primary tabular-nums">
              {listTotal.format(stored.data.total ?? stored.data.items.length)} filed under this session
            </div>
          )}
          <p className="text-[10px] text-text-muted leading-relaxed">
            Turning conclusions off keeps these. Dreams can file conclusions derived from them under another session, and a
            dream started elsewhere can still use them. The Conclusions page finds both.
          </p>
        </section>
      </div>

      {result ? (
        <section className="border border-border px-3 py-2 space-y-2" role="status" aria-labelledby={`result-${sessionId}`}>
          <div className="flex items-center justify-between gap-2">
            <SectionLabel id={`result-${sessionId}`} className="mb-0">LAST_SAVE</SectionLabel>
            <Button variant="ghost" size="sm" onClick={() => setResult(null)}>DISMISS</Button>
          </div>
          {result.message ? <p className="text-[11px] text-red-400">{result.message}</p> : null}
          <ChangeList changes={result.changes} />
        </section>
      ) : null}

      {editable && (plan.changes.length || plan.error || incompleteKeys.length) ? (
        <div className="flex flex-wrap items-center gap-2 border border-accent/40 px-3 py-2" role="status">
          <span className="text-[11px] text-text-primary">
            {plan.changes.length} unsaved {plan.changes.length === 1 ? "change" : "changes"}
          </span>
          {plan.error ? <span className="text-[11px] text-red-400">{plan.error}</span> : incompleteKeys.length ? (
            <span className="text-[11px] text-yellow-400">Custom instructions need text before you can save.</span>
          ) : (
            <span className="text-[10px] text-text-muted">You review them before anything is written.</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={discard} disabled={saving}>DISCARD</Button>
            <Button variant="primary" size="sm" onClick={save}
              disabled={saving || !!plan.error || !plan.changes.length || incompleteKeys.length > 0}>
              {saving ? "SAVING…" : "SAVE"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SectionLabel({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  return (
    <h4 id={id} className={cn("text-[10px] text-text-muted uppercase tracking-wider mb-2 font-normal", className)}>
      {children}
    </h4>
  );
}

function SettingRow({ label, hint, control, effect, changed }: {
  label: string;
  hint: string;
  control: React.ReactNode;
  effect: React.ReactNode;
  changed: boolean;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[minmax(10rem,14rem)_auto_1fr] items-center gap-x-4 gap-y-1.5 px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-primary uppercase tracking-wider">{label}</span>
          {changed ? <Chip tone="accent">edited</Chip> : null}
        </div>
        <div className="text-[10px] text-text-muted leading-snug mt-0.5">{hint}</div>
      </div>
      <div>{control}</div>
      <div className="md:text-right">
        <span className="md:hidden text-[9px] text-text-muted uppercase tracking-wider mr-2">IN_EFFECT</span>
        {effect}
      </div>
    </div>
  );
}

/** Choices that defer to another level. Selected, they stay quiet so explicit overrides stand out. */
const DEFERRING = new Set(["inherit", "unset"]);

function ChoiceGroup<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { key: T; label: string; disabled?: boolean; title?: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex">
      {options.map((option, index) => {
        const active = value === option.key;
        return (
        <ToggleButton
          key={option.key}
          active={active}
          disabled={option.disabled}
          title={option.title}
          onClick={() => onChange(option.key)}
          className={cn(
            "relative px-2",
            index > 0 && "-ml-px",
            active && "z-10",
            // Explicit choices keep body text on a faint tint (AA in both themes); the accent border marks them.
            active && (DEFERRING.has(option.key) ? "bg-border text-text-primary border-border-light" : "bg-accent/10 text-text-primary border-accent"),
          )}
        >
          {option.label}
        </ToggleButton>
        );
      })}
    </div>
  );
}

function sourceText(source: SettingSource, legacy = false): string {
  const base = source === "session" ? "this session" : source === "workspace" ? "workspace" : source === "server" ? "server default" : "workspace unread";
  return legacy ? `${base} (legacy key)` : base;
}

function IntervalEffect({ label, interval }: { label: string; interval: { effective: number | null; source: SettingSource } }) {
  return (
    <span>
      <span className="text-text-muted">{label} </span>
      {interval.effective === null ? (
        <span className="text-text-muted">{interval.source === "unknown" ? "unknown" : "server default"}</span>
      ) : (
        <>
          <span className="text-text-primary">{interval.effective}</span>
          <span className="text-text-muted"> {sourceText(interval.source)}</span>
        </>
      )}
    </span>
  );
}

function memberSource(source: "session" | "peer" | "default" | "unset"): string {
  return source === "session" ? "this session" : source === "peer" ? "peer setting" : source === "default" ? "default" : "unset";
}

function Effect({ value, source, legacy }: { value: boolean | null; source: SettingSource; legacy: boolean }) {
  if (value === null) {
    return (
      <span className="text-[11px] text-text-muted" title="Honcho ships with this on. The server's own config can change it, and the API doesn't report it.">
        {source === "unknown" ? "unknown · workspace unread" : "server default"}
      </span>
    );
  }
  return (
    <span className="text-[11px]">
      <span className={value ? "text-text-primary" : "text-yellow-400"}>{value ? "ON" : "OFF"}</span>
      <span className="text-text-muted"> · {sourceText(source, legacy)}</span>
    </span>
  );
}

function IntervalInput({ label, value, min, onChange }: { label: string; value: string; min: number; onChange: (next: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[10px] text-text-muted uppercase tracking-wider">
      {label}
      <TextInput
        type="number"
        min={min}
        inputMode="numeric"
        value={value}
        placeholder="inherit"
        onChange={(e) => onChange(e.target.value)}
        className="w-24 px-2 py-1 tabular-nums normal-case"
      />
    </label>
  );
}

type InstructionChoice = "inherit" | "none" | "custom";

function InstructionRow({ label, value, editable, changed, inheritLocked, effective, source, onChange, onIncomplete }: {
  label: string;
  value: Instructions;
  editable: boolean;
  changed: boolean;
  /** The session stores shared instructions, which Honcho can't remove. */
  inheritLocked: boolean;
  effective: string | null;
  source: string | null;
  onChange: (next: Instructions) => void;
  /** CUSTOM is picked but holds no text yet, so the form can't be saved. */
  onIncomplete: (incomplete: boolean) => void;
}) {
  const stored: InstructionChoice = value === null ? "inherit" : value === "" ? "none" : "custom";
  // CUSTOM picked before any text was typed. The form keeps its old value meanwhile.
  const [pendingCustom, setPendingCustom] = useState(false);
  const choice: InstructionChoice = pendingCustom ? "custom" : stored;
  const pick = (next: InstructionChoice) => {
    const pending = next === "custom" && stored !== "custom";
    setPendingCustom(pending);
    onIncomplete(pending);
    if (next === "inherit") onChange(null);
    else if (next === "none") onChange("");
  };
  return (
    <div className="px-3 py-2 space-y-1.5">
      <div className="grid grid-cols-1 md:grid-cols-[minmax(10rem,14rem)_auto_1fr] items-center gap-x-4 gap-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-primary uppercase tracking-wider">{label}</span>
          {changed ? <Chip tone="accent">edited</Chip> : null}
        </div>
        <div>
          {editable ? (
            <ChoiceGroup label={`${label} instructions`} value={choice} onChange={pick} options={[
              { key: "inherit", label: "INHERIT", disabled: inheritLocked && choice !== "inherit", title: inheritLocked ? "Honcho can't remove shared instructions from a session once set." : undefined },
              { key: "none", label: "NONE" },
              { key: "custom", label: "CUSTOM" },
            ]} />
          ) : (
            <span className="text-[11px] text-text-primary">{choice}</span>
          )}
        </div>
        <div className="min-w-0 md:text-right text-[11px]">
          {effective ? (
            <span className="text-text-primary truncate inline-block max-w-full align-bottom" title={effective}>{effective}</span>
          ) : (
            <span className="text-text-muted">{source ? "none" : "not set"}</span>
          )}
          {source ? <span className="text-text-muted"> · {source}</span> : null}
        </div>
      </div>
      {choice === "custom" && editable ? (
        <>
          <textarea
            aria-label={`${label} instructions`}
            value={pendingCustom ? "" : value ?? ""}
            onChange={(e) => {
              const next = e.target.value;
              const empty = !next.trim();
              setPendingCustom(empty);
              onIncomplete(empty);
              if (!empty) onChange(next);
            }}
            rows={2}
            spellCheck={false}
            placeholder="Instructions for this session"
            className={TEXTAREA_CLASS}
          />
          {pendingCustom ? <p className="text-[10px] text-text-muted">Enter text, or pick INHERIT or NONE.</p> : null}
        </>
      ) : null}
      {inheritLocked && editable ? (
        <p className="text-[10px] text-text-muted">Set on this session. Honcho can&apos;t return it to inherit, only to none or other text.</p>
      ) : null}
    </div>
  );
}

function ChangeList({ changes }: { changes: (SettingChange & { status?: ChangeStatus })[] }) {
  return (
    <ul className="space-y-1">
      {changes.map((change) => (
        <li key={change.id} className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-text-primary">{change.label}</span>
          <span className="text-text-muted truncate max-w-[18ch]" title={change.from}>{change.from}</span>
          <Icon name="arrow-right" size={10} className="text-text-muted" />
          <span className="text-accent truncate max-w-[24ch]" title={change.to}>{change.to}</span>
          {change.status ? <Chip tone={STATUS_CHIP[change.status].tone}>{STATUS_CHIP[change.status].label}</Chip> : null}
        </li>
      ))}
    </ul>
  );
}
