"use client";

import type { Scope, ScopeBackfillState } from "@honcho-ai/sdk";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Checkbox, Chip, Field, RefreshButton, TextInput } from "@/components/atoms";
import { Honcho31Notice } from "@/components/Honcho31Notice";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { useConfirm } from "@/components/confirm";
import { useToast } from "@/components/toast";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import {
  isHonchoPermissionError,
  useHonchoCapabilities,
} from "@/lib/honcho/useCapabilities";
import { getSdk } from "@/lib/honcho/sdk";
import { listAllScopes, listAllScopeSessions } from "@/lib/honcho/scopeListing";
import { listAllSessions } from "@/lib/honcho/sessionListing";
import { toApiSession } from "@/lib/honcho/adapters";
import { formatApiError, invalidate, useHonchoQuery } from "@/lib/honcho/useQuery";
import type { ApiSession } from "@/lib/honcho/types";
import { useWriteActions } from "@/lib/writeActions";

const SCOPE_NAME = /^[A-Za-z0-9_-]+$/;

function scopeKey(workspaceId: string): string {
  return `workspaces/${workspaceId}/scopes`;
}

function statusTone(state: ScopeBackfillState["state"]): "accent" | "warn" | "danger" {
  if (state === "completed") return "accent";
  if (state === "failed") return "danger";
  return "warn";
}

export function ScopesPage() {
  const apiOpts = useActiveHonchoOptions();
  const { workspaceId } = useActiveWorkspace();
  const { push } = useToast();
  const confirm = useConfirm();
  const { enabled: canWrite } = useWriteActions();
  const capabilities = useHonchoCapabilities();
  const scopesAvailable = capabilities.scopes === "available";

  const [selectedScope, setSelectedScope] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [scopeName, setScopeName] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const scopes = useHonchoQuery<Scope[]>(
    workspaceId && scopesAvailable ? `${scopeKey(workspaceId)}/list` : null,
    (opts) => listAllScopes(getSdk(opts, workspaceId!)),
  );

  useEffect(() => {
    const items = scopes.data ?? [];
    if (!workspaceId || items.length === 0) {
      setSelectedScope("");
      return;
    }
    setSelectedScope((current) =>
      items.some((scope) => scope.id === current) ? current : items[0].id,
    );
  }, [scopes.data, workspaceId]);

  const activeScope = (scopes.data ?? []).find((scope) => scope.id === selectedScope);
  const members = useHonchoQuery<ApiSession[]>(
    workspaceId && scopesAvailable && activeScope
      ? `${scopeKey(workspaceId)}/${selectedScope}/sessions`
      : null,
    async () => (await listAllScopeSessions(activeScope!)).map(toApiSession),
  );
  const status = useHonchoQuery(
    workspaceId && scopesAvailable && activeScope
      ? `${scopeKey(workspaceId)}/${selectedScope}/status`
      : null,
    () => activeScope!.status(),
    { refreshInterval: 5000 },
  );
  const allSessions = useHonchoQuery<{ items: ApiSession[] }>(
    workspaceId ? `${scopeKey(workspaceId)}/available-sessions` : null,
    async (opts) => ({
      items: (await listAllSessions(getSdk(opts, workspaceId!))).map(toApiSession),
    }),
    { enabled: addOpen && scopesAvailable },
  );

  const memberIds = useMemo(
    () => new Set((members.data ?? []).map((session) => session.id)),
    [members.data],
  );
  const availableSessions = (allSessions.data?.items ?? []).filter(
    (session) => !memberIds.has(session.id),
  );
  const backfills = Object.entries(status.data?.backfillStatus ?? {});
  const pendingCount = backfills.filter(([, job]) => job.state === "pending").length;
  const failedCount = backfills.filter(([, job]) => job.state === "failed").length;

  const refresh = () => {
    scopes.refetch();
    members.refetch();
    status.refetch();
  };

  const openCreate = () => {
    setScopeName("");
    setCreateOpen(true);
  };

  const createScope = async () => {
    if (!apiOpts || !workspaceId) return;
    const id = scopeName.trim();
    if (!SCOPE_NAME.test(id) || id.length > 506) {
      push({
        type: "error",
        message: "Scope names may contain letters, numbers, underscores, and hyphens",
      });
      return;
    }
    const ok = await confirm({
      title: "CREATE_SCOPE",
      confirmLabel: "CREATE",
      body: (
        <>
          Create scope <span className="text-accent font-mono">{id}</span> in the active
          workspace? It will start with no session members.
        </>
      ),
    });
    if (!ok) return;

    setBusy(true);
    try {
      const created = await getSdk(apiOpts, workspaceId).scope(id);
      setSelectedScope(created.id);
      setCreateOpen(false);
      setScopeName("");
      invalidate(scopeKey(workspaceId));
      scopes.refetch();
      push({ type: "success", message: `Scope ${created.id} created` });
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    } finally {
      setBusy(false);
    }
  };

  const openAdd = () => {
    setSelectedSessions([]);
    setAddOpen(true);
  };

  const addSessions = async () => {
    if (!apiOpts || !workspaceId || !activeScope || selectedSessions.length === 0) return;
    const ok = await confirm({
      title: "ADD_SCOPE_SESSIONS",
      confirmLabel: "ADD_SESSIONS",
      body: (
        <>
          Add <span className="text-accent">{selectedSessions.length}</span> session
          {selectedSessions.length === 1 ? "" : "s"} to scope{" "}
          <span className="text-accent font-mono">{selectedScope}</span>? Existing conclusions
          will be copied into the scope asynchronously.
        </>
      ),
    });
    if (!ok) return;

    setBusy(true);
    try {
      await activeScope.addSessions(selectedSessions);
      setAddOpen(false);
      setSelectedSessions([]);
      invalidate(scopeKey(workspaceId));
      members.refetch();
      status.refetch();
      push({ type: "success", message: "Scope membership updated" });
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    } finally {
      setBusy(false);
    }
  };

  const removeSession = async (sessionId: string) => {
    if (!apiOpts || !workspaceId || !activeScope) return;
    const ok = await confirm({
      title: "REMOVE_SCOPE_SESSION",
      confirmLabel: "REMOVE",
      destructive: true,
      body: (
        <>
          Remove session <span className="text-accent font-mono">{sessionId}</span> from scope{" "}
          <span className="text-accent font-mono">{selectedScope}</span>? Honcho will reconcile
          copied and derived conclusions asynchronously.
        </>
      ),
    });
    if (!ok) return;

    try {
      await activeScope.removeSession(sessionId);
      invalidate(scopeKey(workspaceId));
      members.refetch();
      status.refetch();
      push({ type: "success", message: `Session ${sessionId} removed from scope` });
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    }
  };

  return (
    <div className="space-y-3">
      <PageHeader
        title="SCOPES"
        subtitle="named session boundaries for search, chat, and context recall"
        actions={scopesAvailable ? (
          <div className="flex items-center gap-2">
            <RefreshButton label="REFRESH" onClick={refresh} />
            {canWrite ? (
              <Button icon="plus" onClick={openCreate} disabled={!workspaceId}>
                NEW_SCOPE
              </Button>
            ) : (
              <Chip tone="muted" icon="key">read-only · enable in CONFIG</Chip>
            )}
          </div>
        ) : undefined}
      />

      {!workspaceId ? (
        <Panel title="NO_WORKSPACE">
          <div className="text-xs text-text-muted py-6 text-center">Select a workspace first.</div>
        </Panel>
      ) : !scopesAvailable ? (
        <Honcho31Notice
          state={capabilities.scopes}
          version={capabilities.version}
          feature="named scopes and scope membership"
          fallback="Sessions, messages, search, peer chat, and unscoped context remain available."
          panel
        />
      ) : isHonchoPermissionError(scopes.error) ? (
        <Honcho31Notice
          state="restricted"
          version={capabilities.version}
          feature="named scopes and scope membership"
          fallback="Use the existing session and message views with the current key."
          panel
        />
      ) : scopes.error ? (
        <Panel title="SCOPES_UNAVAILABLE" status="processing">
          <div className="text-xs text-red-400">{formatApiError(scopes.error)}</div>
          <div className="text-[10px] text-text-muted mt-2">
            Scopes require Honcho 3.1.0+ and a workspace- or admin-level key.
          </div>
        </Panel>
      ) : scopes.isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          <div className="lg:col-span-4 h-56 bg-surface border border-border animate-pulse" />
          <div className="lg:col-span-8 h-56 bg-surface border border-border animate-pulse" />
        </div>
      ) : (scopes.data ?? []).length === 0 ? (
        <Panel title="NO_SCOPES">
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
            <Icon name="focus" size={26} className="text-text-muted" />
            <div className="text-xs text-text-primary">No recall boundaries yet</div>
            <div className="text-[10px] text-text-muted max-w-[64ch]">
              A scope groups related sessions so search, chat, and context cannot recall outside
              that boundary.
            </div>
            {canWrite ? <Button className="mt-2" onClick={openCreate}>CREATE_FIRST_SCOPE</Button> : null}
          </div>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
          <Panel title="SCOPE_REGISTRY" className="lg:col-span-4">
            <div className="space-y-1.5">
              {(scopes.data ?? []).map((scope) => (
                <Button
                  key={scope.id}
                  variant={scope.id === selectedScope ? "solid" : "outline"}
                  className="w-full justify-between normal-case tracking-normal"
                  onClick={() => setSelectedScope(scope.id)}
                >
                  <span className="truncate">{scope.id}</span>
                  <span className="text-[9px] opacity-70">
                    {scope.id === selectedScope ? "ACTIVE" : "OPEN"}
                  </span>
                </Button>
              ))}
            </div>
          </Panel>

          <div className="lg:col-span-8 space-y-3">
            <Panel
              title="RECALL_BOUNDARY"
              status={pendingCount > 0 ? "processing" : "active"}
              actions={
                <div className="flex items-center gap-1.5">
                  {pendingCount > 0 ? <Chip tone="warn">{pendingCount} pending</Chip> : null}
                  {failedCount > 0 ? <Chip tone="danger">{failedCount} failed</Chip> : null}
                </div>
              }
            >
              <div className="border border-border bg-void/40 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-text-muted">workspace:</span>
                  <span className="text-text-primary">{workspaceId}</span>
                  <span className="text-text-muted">→</span>
                  <span className="text-accent">scope:{activeScope?.id}</span>
                  <span className="text-text-muted">→</span>
                  <span className="text-text-primary">{members.data?.length ?? 0} sessions</span>
                </div>
                <div className="mt-2 text-[10px] text-text-muted">
                  Search, chat, and peer representation recall stay inside these member sessions.
                  Empty scopes fail closed and return no recalled memory.
                </div>
              </div>
              {activeScope?.metadata && Object.keys(activeScope.metadata).length > 0 ? (
                <pre className="mt-3 text-[10px] text-text-muted whitespace-pre-wrap break-all">
                  metadata: {JSON.stringify(activeScope.metadata)}
                </pre>
              ) : null}
            </Panel>

            <Panel
              title="MEMBER_SESSIONS"
              actions={
                canWrite ? (
                  <Button size="sm" icon="plus" onClick={openAdd} disabled={members.isLoading}>
                    ADD_SESSIONS
                  </Button>
                ) : undefined
              }
            >
              {members.error ? (
                <div className="text-xs text-red-400">{formatApiError(members.error)}</div>
              ) : members.isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="h-11 bg-border/40 animate-pulse" />
                  ))}
                </div>
              ) : (members.data ?? []).length === 0 ? (
                <div className="text-xs text-text-muted py-6 text-center">
                  This scope has no sessions. Add members before using it for recall.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {(members.data ?? []).map((session) => {
                    const job = status.data?.backfillStatus[session.id];
                    return (
                      <div
                        key={session.id}
                        className="flex flex-wrap items-center gap-2 border border-border bg-void/30 px-3 py-2.5"
                      >
                        <Icon name="git-branch" size={12} className="text-text-muted" />
                        <span className="text-xs text-text-primary min-w-0 flex-1 truncate">
                          {session.id}
                        </span>
                        {job ? (
                          <>
                            <Chip tone={statusTone(job.state)}>{job.state}</Chip>
                            {job.docsCopied !== undefined ? (
                              <span className="text-[10px] text-text-muted tabular-nums">
                                {job.docsCopied.toLocaleString()} docs copied
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <Chip tone="muted">current</Chip>
                        )}
                        {canWrite ? (
                          <Button
                            variant="danger"
                            size="sm"
                            icon="x"
                            onClick={() => removeSession(session.id)}
                          >
                            REMOVE
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>

            {backfills.length > 0 ? (
              <Panel title="BACKFILL_STATUS" status={pendingCount > 0 ? "processing" : "active"}>
                <div className="space-y-1.5">
                  {backfills.map(([sessionId, job]) => (
                    <div
                      key={sessionId}
                      className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border pb-1.5 text-[10px] last:border-0 last:pb-0"
                    >
                      <span className="text-text-primary truncate">{sessionId}</span>
                      <span className="flex items-center gap-2">
                        <Chip tone={statusTone(job.state)}>{job.state}</Chip>
                        <span className="text-text-muted tabular-nums">
                          {new Date(job.updatedAt).toLocaleString()}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </Panel>
            ) : null}
          </div>
        </div>
      )}

      <StatusBar />

      <Modal
        title="CREATE_SCOPE"
        open={createOpen}
        onClose={() => !busy && setCreateOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={busy}>
              CANCEL
            </Button>
            <Button onClick={createScope} disabled={busy || !scopeName.trim()}>
              {busy ? "CREATING…" : "CREATE"}
            </Button>
          </>
        }
      >
        <Field
          label="SCOPE_ID"
          hint="Use letters, numbers, underscores, or hyphens. Honcho stores the internal scope. prefix for you."
        >
          <TextInput
            value={scopeName}
            onChange={(event) => setScopeName(event.target.value)}
            placeholder="e.g., customer_support"
            autoFocus
            disabled={busy}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !busy && scopeName.trim()) createScope();
            }}
          />
        </Field>
      </Modal>

      <Modal
        title="ADD_SCOPE_SESSIONS"
        open={addOpen}
        onClose={() => !busy && setAddOpen(false)}
        className="max-w-3xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)} disabled={busy}>
              CANCEL
            </Button>
            <Button onClick={addSessions} disabled={busy || selectedSessions.length === 0}>
              {busy
                ? "ADDING…"
                : selectedSessions.length > 0
                  ? `ADD_${selectedSessions.length}_SESSIONS`
                  : "ADD_SESSIONS"}
            </Button>
          </>
        }
      >
        <div className="text-[10px] text-text-muted">
          Select up to 100 sessions. Existing memory is copied asynchronously; the status panel
          reports when each backfill is ready.
        </div>
        <div className="max-h-[50vh] overflow-y-auto border border-border bg-void/30 p-3">
          {allSessions.error ? (
            <div className="text-xs text-red-400">{formatApiError(allSessions.error)}</div>
          ) : allSessions.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-8 bg-border/40 animate-pulse" />
              ))}
            </div>
          ) : availableSessions.length === 0 ? (
            <div className="text-xs text-text-muted py-6 text-center">
              Every workspace session already belongs to this scope.
            </div>
          ) : (
            <div className="space-y-3">
              {availableSessions.map((session) => {
                const checked = selectedSessions.includes(session.id);
                return (
                  <Checkbox
                    key={session.id}
                    checked={checked}
                    disabled={!checked && selectedSessions.length >= 100}
                    onChange={(next) =>
                      setSelectedSessions((current) =>
                        next
                          ? [...current, session.id]
                          : current.filter((id) => id !== session.id),
                      )
                    }
                    label={<span className="font-mono">{session.id}</span>}
                    hint={session.created_at ? `created ${new Date(session.created_at).toLocaleString()}` : undefined}
                  />
                );
              })}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
