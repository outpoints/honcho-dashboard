"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { Button, Checkbox, Chip, Field, PillTabs, TextInput } from "@/components/atoms";
import { Select } from "@/components/Select";
import { Icon } from "@/components/icons";
import { useConfirm } from "@/components/confirm";
import { useToast } from "@/components/toast";
import type { HonchoClientOptions } from "@/lib/honcho/client";
import { formatApiError } from "@/lib/honcho/useQuery";
import {
  DEFAULT_IMPORT_OPTIONS,
  SnapshotError,
  TransferAborted,
  exportWorkspace,
  parseWorkspaceSnapshot,
  planImport,
  planStillValid,
  runImport,
  snapshotCounts,
  snapshotFileName,
  type ExportOptions,
  type ImportOptions,
  type ImportPlan,
  type ImportResult,
  type TransferProgress,
  type WorkspaceSnapshot,
} from "@/lib/honcho/workspaceTransfer";
import {
  liveExportSource,
  liveImportTarget,
  loadTargetState,
} from "@/lib/honcho/workspaceTransferIO";

/** Browsers hold the whole file in memory; past this, parsing can freeze the tab. */
const MAX_IMPORT_BYTES = 250 * 1024 * 1024;

function downloadSnapshot(snapshot: WorkspaceSnapshot) {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = snapshotFileName(snapshot);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function describeError(error: unknown): string {
  if (error instanceof SnapshotError || error instanceof TransferAborted) return error.message;
  return formatApiError(error);
}

function ProgressLine({ progress }: { progress: TransferProgress }) {
  const pct = progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : null;
  return (
    <div className="space-y-1.5" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <span className="text-text-primary">{progress.phase}</span>
        <span className="text-text-muted tabular-nums">
          {progress.total !== null ? `${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}` : `${progress.done.toLocaleString()}…`}
        </span>
      </div>
      <div className="h-1.5 bg-void border border-border overflow-hidden" aria-hidden>
        <div
          className={pct === null ? "h-full w-1/3 bg-accent/60 motion-safe:animate-pulse" : "h-full bg-accent transition-[width] duration-200"}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
      {progress.detail ? <div className="text-[10px] text-text-muted truncate">{progress.detail}</div> : null}
    </div>
  );
}

function CountRow({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 px-3 py-2 text-[11px]">
      <dt className="text-text-muted uppercase tracking-wider">{label}</dt>
      <dd className="text-text-primary tabular-nums min-w-0">
        {value}
        {hint ? <span className="block text-[10px] text-text-muted mt-0.5">{hint}</span> : null}
      </dd>
    </div>
  );
}

function SnapshotSummary({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const counts = snapshotCounts(snapshot);
  return (
    <dl className="border border-border divide-y divide-border bg-void/30">
      <CountRow label="workspace" value={<span className="font-mono text-accent">{snapshot.workspace.id}</span>}
        hint={`${snapshot.source.kind === "hombre" ? "Hombre export" : "dashboard snapshot"}${snapshot.exported_at ? ` · ${new Date(snapshot.exported_at).toLocaleString()}` : ""}${snapshot.source.honcho_version ? ` · Honcho ${snapshot.source.honcho_version}` : ""}`} />
      <CountRow label="peers" value={counts.peers.toLocaleString()} />
      <CountRow label="sessions" value={counts.sessions.toLocaleString()} hint={`${counts.messages.toLocaleString()} messages`} />
      <CountRow label="conclusions" value={counts.conclusions === null ? "not included" : counts.conclusions.toLocaleString()} />
      <CountRow label="scopes" value={counts.scopes === null ? "not included" : counts.scopes.toLocaleString()} />
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function ExportWorkspaceModal({
  open,
  onClose,
  apiOpts,
  workspaceId,
  scopesAvailable,
  honchoVersion,
}: {
  open: boolean;
  onClose: () => void;
  apiOpts: HonchoClientOptions | null;
  workspaceId: string;
  scopesAvailable: boolean;
  honchoVersion: string | null;
}) {
  const [options, setOptions] = useState<ExportOptions>({ messages: true, conclusions: true, scopes: true });
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const running = progress !== null && snapshot === null && error === null;

  const reset = () => {
    setProgress(null);
    setSnapshot(null);
    setError(null);
  };

  const close = () => {
    controller.current?.abort();
    reset();
    onClose();
  };

  const start = async () => {
    if (!apiOpts) return;
    reset();
    controller.current = new AbortController();
    setProgress({ phase: "STARTING", done: 0, total: null });
    try {
      const result = await exportWorkspace(
        liveExportSource(apiOpts, workspaceId, scopesAvailable),
        { ...options, scopes: options.scopes && scopesAvailable },
        { onProgress: setProgress, signal: controller.current.signal, honchoVersion },
      );
      setSnapshot(result);
      downloadSnapshot(result);
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <Modal
      title="EXPORT_WORKSPACE"
      open={open}
      onClose={close}
      className="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={running ? () => controller.current?.abort() : close}>
            {running ? "STOP" : "CLOSE"}
          </Button>
          {snapshot ? (
            <Button variant="solid" icon="download" onClick={() => downloadSnapshot(snapshot)}>DOWNLOAD_AGAIN</Button>
          ) : (
            <Button variant="solid" icon="download" onClick={start} disabled={!apiOpts || running}>
              {running ? "EXPORTING…" : "EXPORT_JSON"}
            </Button>
          )}
        </>
      }
    >
      <p className="text-[11px] text-text-primary leading-relaxed">
        Read every peer, session, and message in <span className="text-accent font-mono">{workspaceId}</span> into one JSON
        file on this device. Nothing is written to Honcho. The file can hold private memory; store it like a database backup.
      </p>
      <div className="space-y-3">
        <Checkbox checked={options.messages} onChange={(messages) => setOptions((o) => ({ ...o, messages }))} disabled={running}
          label={<span className="text-xs">INCLUDE_MESSAGES</span>} hint="Every message with its author, metadata, and timestamp. Large workspaces take a while." />
        <Checkbox checked={options.conclusions} onChange={(conclusions) => setOptions((o) => ({ ...o, conclusions }))} disabled={running}
          label={<span className="text-xs">INCLUDE_CONCLUSIONS</span>} hint="Derived memory with level and provenance, for reference or explicit re-import." />
        <Checkbox checked={options.scopes && scopesAvailable} onChange={(scopes) => setOptions((o) => ({ ...o, scopes }))} disabled={running || !scopesAvailable}
          label={<span className="text-xs">INCLUDE_SCOPES</span>}
          hint={scopesAvailable ? "Named scopes and their member sessions." : "This server or key cannot list named scopes."} />
      </div>
      {progress && !snapshot && !error ? <ProgressLine progress={progress} /> : null}
      {snapshot ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] text-text-primary">
            <Icon name="check" size={12} className="text-accent" /> Saved {snapshotFileName(snapshot)}
          </div>
          <SnapshotSummary snapshot={snapshot} />
        </div>
      ) : null}
      {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Import / merge
// ---------------------------------------------------------------------------

type SourceKind = "file" | "workspace";

export function ImportWorkspaceModal({
  open,
  onClose,
  apiOpts,
  workspaces,
  defaultTarget,
  scopesAvailable,
  honchoVersion,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  apiOpts: HonchoClientOptions | null;
  workspaces: string[];
  defaultTarget: string | null;
  scopesAvailable: boolean;
  honchoVersion: string | null;
  onImported: (workspaceId: string) => void;
}) {
  const confirm = useConfirm();
  const { push } = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const controller = useRef<AbortController | null>(null);

  const [kind, setKind] = useState<SourceKind>("file");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSnapshot, setFileSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [sourceWorkspace, setSourceWorkspace] = useState("");
  const [target, setTarget] = useState(defaultTarget ?? "");
  const [options, setOptions] = useState<ImportOptions>({ ...DEFAULT_IMPORT_OPTIONS, scopes: scopesAvailable });
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [planSnapshot, setPlanSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

  const stop = () => {
    controller.current?.abort();
    setStopping(true);
  };

  const invalidate = () => {
    setPlan(null);
    setResult(null);
    setError(null);
  };
  const update = <K extends keyof ImportOptions>(key: K, value: ImportOptions[K]) => {
    setOptions((current) => ({ ...current, [key]: value }));
    invalidate();
  };

  const close = () => {
    if (busy === "import") return;
    controller.current?.abort();
    setKind("file");
    setFileName(null);
    setFileSnapshot(null);
    setSourceWorkspace("");
    setTarget(defaultTarget ?? "");
    setOptions({ ...DEFAULT_IMPORT_OPTIONS, scopes: scopesAvailable });
    setPlan(null);
    setPlanSnapshot(null);
    setProgress(null);
    setBusy(null);
    setResult(null);
    setError(null);
    onClose();
  };

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    invalidate();
    setFileSnapshot(null);
    setFileName(file.name);
    if (file.size > MAX_IMPORT_BYTES) {
      setError("This file is larger than 250 MB, too large to import in the browser.");
      return;
    }
    try {
      const snapshot = parseWorkspaceSnapshot(JSON.parse(await file.text()));
      setFileSnapshot(snapshot);
      if (!target.trim()) setTarget(snapshot.workspace.id);
    } catch (err) {
      setError(err instanceof SyntaxError ? "The file is not valid JSON." : describeError(err));
    }
  };

  const targetId = target.trim();
  const sourceReady = kind === "file" ? fileSnapshot !== null : sourceWorkspace !== "" && sourceWorkspace !== targetId;

  const preview = async () => {
    if (!apiOpts || !sourceReady || !targetId) return;
    invalidate();
    setBusy("preview");
    setStopping(false);
    controller.current = new AbortController();
    try {
      let snapshot = fileSnapshot;
      if (kind === "workspace") {
        snapshot = await exportWorkspace(
          liveExportSource(apiOpts, sourceWorkspace, scopesAvailable),
          { messages: options.messages, conclusions: options.conclusions, scopes: options.scopes && scopesAvailable },
          { onProgress: setProgress, signal: controller.current.signal, honchoVersion },
        );
      }
      setProgress({ phase: "READING_TARGET", done: 0, total: null });
      const state = await loadTargetState(apiOpts, targetId, scopesAvailable);
      setPlanSnapshot(snapshot);
      setPlan(planImport(snapshot!, targetId, state, options));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setProgress(null);
      setBusy(null);
    }
  };

  const execute = async () => {
    if (!apiOpts || !plan || !planSnapshot) return;
    const creating = plan.sessions.filter((s) => s.action === "create").length;
    const ok = await confirm({
      title: "IMPORT_WORKSPACE",
      confirmLabel: "IMPORT",
      body: (
        <>
          Write into <span className="text-accent font-mono">{plan.workspaceId}</span> on the live instance:{" "}
          {plan.createWorkspace ? "create the workspace, " : ""}
          {plan.peersToCreate.length} peers, {creating} sessions, {plan.messageCount.toLocaleString()} messages
          {plan.conclusions.length ? `, ${plan.conclusions.length} conclusions` : ""}
          {plan.scopesToCreate.length ? `, ${plan.scopesToCreate.length} scopes` : ""}? Messages and conclusions cannot be
          removed through Honcho&apos;s API once written.
        </>
      ),
    });
    if (!ok) return;
    setBusy("import");
    setStopping(false);
    setError(null);
    controller.current = new AbortController();
    try {
      // Fail closed if the target changed after the preview.
      setProgress({ phase: "CHECKING_TARGET", done: 0, total: null });
      const drift = planStillValid(plan, await loadTargetState(apiOpts, plan.workspaceId, scopesAvailable));
      if (drift) {
        setError(`${drift} Nothing was written. Preview again.`);
        setPlan(null);
        return;
      }
      const outcome = await runImport(plan, liveImportTarget(apiOpts, plan.workspaceId, scopesAvailable), {
        onProgress: setProgress,
        signal: controller.current.signal,
      });
      setResult(outcome);
      setPlan(null);
      onImported(plan.workspaceId);
      push({
        type: outcome.failures.length || outcome.stopped ? "error" : "success",
        message: outcome.stopped ? "Import stopped early" : outcome.failures.length ? `Import finished with ${outcome.failures.length} failures` : "Import complete",
      });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setProgress(null);
      setBusy(null);
    }
  };

  const sourceOptions = workspaces.map((id) => ({ value: id, label: id }));
  const created = plan?.sessions.filter((s) => s.action === "create") ?? [];
  const renamed = created.filter((s) => s.renamed).length;
  const skipped = (plan?.sessions.length ?? 0) - created.length;

  // The modal body scrolls; bring a new preview or result into view so it isn't missed below the fold.
  const outcomeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (plan || result) outcomeRef.current?.scrollIntoView({ block: "nearest" });
  }, [plan, result]);

  return (
    <Modal
      title="IMPORT_WORKSPACE"
      open={open}
      onClose={close}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={busy ? stop : close} disabled={busy !== null && stopping}>
            {busy ? (stopping ? "STOPPING…" : "STOP") : result ? "CLOSE" : "CANCEL"}
          </Button>
          {plan ? (
            <Button variant="solid" icon="upload" onClick={execute} disabled={busy !== null}>
              {busy === "import" ? "IMPORTING…" : "RUN_IMPORT"}
            </Button>
          ) : result ? null : (
            <Button variant="primary" icon="eye" onClick={preview} disabled={!apiOpts || !sourceReady || !targetId || busy !== null}>
              {busy === "preview" ? "READING…" : "PREVIEW"}
            </Button>
          )}
        </>
      }
    >
      <div className="max-h-[62vh] overflow-y-auto space-y-4 pr-1">
        <Field label="SOURCE" hint="A JSON export from this dashboard or Hombre, or another workspace on this instance (merge).">
          <PillTabs<SourceKind>
            items={[
              { key: "file", label: "FILE", icon: "upload", disabled: busy !== null },
              { key: "workspace", label: "MERGE_WORKSPACE", icon: "layers", disabled: busy !== null || workspaces.length < 2 },
            ]}
            current={kind}
            onChange={(next) => { setKind(next); invalidate(); }}
            layoutId="import-source"
          />
        </Field>

        {kind === "file" ? (
          <div
            className="border border-dashed border-border-light bg-void/40 p-4 text-center transition-colors hover:border-accent/60"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); if (!busy) void chooseFile(event.dataTransfer.files[0]); }}
          >
            <input
              ref={inputRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              aria-label="Choose a workspace export"
              disabled={busy !== null}
              onChange={(event) => void chooseFile(event.target.files?.[0])}
            />
            <div className="flex flex-col items-center gap-2">
              <Icon name={fileSnapshot ? "book" : "upload"} size={20} className={fileSnapshot ? "text-accent" : "text-text-muted"} />
              <div className="text-xs text-text-primary break-all">{fileName ?? "Drop a workspace export here"}</div>
              <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy !== null}>
                {fileName ? "CHOOSE_DIFFERENT_FILE" : "CHOOSE_FILE"}
              </Button>
            </div>
          </div>
        ) : (
          <Field label="SOURCE_WORKSPACE" hint="Read live from this instance at preview time. The source is never modified.">
            <Select
              value={sourceWorkspace}
              onChange={(value) => { setSourceWorkspace(value); invalidate(); }}
              options={sourceOptions.filter((option) => option.value !== targetId)}
              placeholder="select a workspace…"
              disabled={busy !== null}
            />
          </Field>
        )}

        {kind === "file" && fileSnapshot ? <SnapshotSummary snapshot={fileSnapshot} /> : null}

        <Field
          label="TARGET_WORKSPACE"
          hint="Existing workspace: its settings stay as they are, existing peers are reused unchanged, and sessions follow the conflict rule. New workspace: created with the source metadata and configuration."
        >
          <TextInput
            value={target}
            onChange={(event) => { setTarget(event.target.value); invalidate(); }}
            placeholder="workspace id"
            spellCheck={false}
            disabled={busy !== null}
            aria-label="Target workspace"
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="SESSION_CONFLICTS" hint="When the target already has a session with the same id.">
            <PillTabs<ImportOptions["sessionConflict"]>
              items={[
                { key: "skip", label: "SKIP", disabled: busy !== null },
                { key: "rename", label: "RENAME_COPY", disabled: busy !== null },
              ]}
              current={options.sessionConflict}
              onChange={(value) => update("sessionConflict", value)}
              layoutId="import-conflict"
            />
          </Field>
          <div className="space-y-3">
            <Checkbox checked={options.messages} onChange={(value) => update("messages", value)} disabled={busy !== null}
              label={<span className="text-xs">IMPORT_MESSAGES</span>} hint="Original timestamps are kept." />
            <Checkbox checked={options.messages && options.derive} onChange={(value) => update("derive", value)} disabled={busy !== null || !options.messages}
              label={<span className="text-xs">DERIVE_MESSAGES</span>} hint="Queue them for reasoning. Off stores them without new conclusions." />
          </div>
          <Checkbox checked={options.conclusions} onChange={(value) => update("conclusions", value)} disabled={busy !== null}
            label={<span className="text-xs">IMPORT_CONCLUSIONS</span>} hint="Stored as new explicit conclusions. Pair with DERIVE off." />
          <Checkbox checked={options.scopes && scopesAvailable} onChange={(value) => update("scopes", value)} disabled={busy !== null || !scopesAvailable}
            label={<span className="text-xs">IMPORT_SCOPES</span>}
            hint={scopesAvailable ? "Create missing scopes and enroll the new sessions." : "This server or key cannot use named scopes."} />
        </div>

        {progress ? <ProgressLine progress={progress} /> : null}

        <div ref={outcomeRef} className="space-y-4 scroll-mt-4">
        {plan ? (
          <section className="space-y-2" aria-label="Import preview">
            <div className="flex items-center gap-2">
              <Chip tone="accent" icon="eye">PREVIEW</Chip>
              <span className="text-[11px] text-text-primary">Nothing has been written yet.</span>
            </div>
            <dl className="border border-border divide-y divide-border bg-void/30">
              <CountRow label="workspace" value={plan.createWorkspace ? "create" : "exists · settings untouched"} />
              <CountRow label="peers" value={`${plan.peersToCreate.length.toLocaleString()} create`} hint={plan.peersReused.length ? `${plan.peersReused.length.toLocaleString()} already exist and are reused unchanged` : undefined} />
              <CountRow label="sessions" value={`${created.length.toLocaleString()} create`}
                hint={[renamed ? `${renamed} renamed with an -imported suffix` : "", skipped ? `${skipped} skipped` : ""].filter(Boolean).join(" · ") || undefined} />
              <CountRow label="messages" value={plan.messageCount.toLocaleString()}
                hint={plan.messageCount ? `${plan.messageBatches.toLocaleString()} batch${plan.messageBatches === 1 ? "" : "es"} · ${plan.derive ? "queued for reasoning" : "stored without reasoning"}` : undefined} />
              <CountRow label="conclusions" value={plan.conclusions.length.toLocaleString()}
                hint={[plan.conclusionsSkipped ? `${plan.conclusionsSkipped} skipped (peer not in target)` : "", plan.conclusionsDetached ? `${plan.conclusionsDetached} kept without their skipped session` : ""].filter(Boolean).join(" · ") || undefined} />
              <CountRow label="scopes" value={`${plan.scopesToCreate.length} create`} hint={plan.scopesReused.length ? `${plan.scopesReused.length} reused` : undefined} />
            </dl>
            {plan.warnings.length ? (
              <ul className="space-y-1">
                {plan.warnings.map((warning) => (
                  <li key={warning} className="flex items-start gap-2 text-[11px] text-yellow-300">
                    <Icon name="warning" size={11} className="mt-0.5 shrink-0" />
                    <span>{warning}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {result ? (
          <section className="space-y-2" aria-label="Import result">
            <div className="flex items-center gap-2">
              <Chip tone={result.stopped ? "warn" : result.failures.length ? "danger" : "accent"} icon={result.stopped || result.failures.length ? "warning" : "check"}>
                {result.stopped ? "STOPPED" : result.failures.length ? "FINISHED_WITH_FAILURES" : "COMPLETE"}
              </Chip>
            </div>
            <dl className="border border-border divide-y divide-border bg-void/30">
              <CountRow label="workspace" value={result.workspaceCreated ? "created" : "existing"} />
              <CountRow label="peers" value={`${result.peersCreated.toLocaleString()} created`} />
              <CountRow label="sessions" value={`${result.sessionsCreated.toLocaleString()} created`} />
              <CountRow label="messages" value={`${result.messagesWritten.toLocaleString()} written`} />
              <CountRow label="conclusions" value={`${result.conclusionsWritten.toLocaleString()} written`} />
              <CountRow label="scopes" value={`${result.scopesCreated.toLocaleString()} created`} />
            </dl>
            {result.stopped ? <p role="alert" className="text-[11px] text-yellow-300">{result.stopped}</p> : null}
            {result.failures.length ? (
              <ul className="max-h-40 overflow-y-auto border border-border divide-y divide-border text-[10px]">
                {result.failures.map((failure, index) => (
                  <li key={index} className="px-3 py-1.5">
                    <span className="text-red-400 uppercase">{failure.step}</span>{" "}
                    <span className="font-mono text-text-primary break-all">{failure.target}</span>
                    <span className="block text-text-muted break-words">{failure.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
        </div>
      </div>
    </Modal>
  );
}
