"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Chip, Field, RefreshButton, TextInput } from "@/components/atoms";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm";
import { useWriteActions } from "@/lib/writeActions";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { formatApiError, invalidate, useHonchoQuery } from "@/lib/honcho/useQuery";
import { honcho } from "@/lib/honcho/client";
import { getSdk } from "@/lib/honcho/sdk";
import { toApiPeer } from "@/lib/honcho/adapters";
import type { ApiConclusion, ApiPeer, Page } from "@/lib/honcho/types";

const EASE = [0.25, 0.46, 0.45, 0.94] as const;
const PAGE_SIZE = 25;

export function ConclusionsPage() {
  const apiOpts = useActiveHonchoOptions();
  const { workspaceId } = useActiveWorkspace();
  const { push } = useToast();
  const confirm = useConfirm();
  const { enabled: canWrite } = useWriteActions();

  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState(""); // submitted semantic search
  const [observer, setObserver] = useState("");
  const [observed, setObserved] = useState(""); // "" = self (observer about itself)
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  // Honcho's conclusion semantic search is scoped to an (observer, observed)
  // pair — `/conclusions/query` 422s without it. So a query needs an observer.
  // Browsing the full list (`/conclusions/list`) stays workspace-wide.
  const searching = query.trim().length > 0 && !!observer;
  const resultsKey = workspaceId
    ? searching
      ? `conclusions/query/${workspaceId}/${observer}/${observed || observer}/${query}`
      : `conclusions/list/${workspaceId}/p${page}`
    : null;

  const results = useHonchoQuery<Page<ApiConclusion>>(resultsKey, async (o) => {
    if (searching) {
      const observerPeer = await getSdk(o, workspaceId!).peer(observer);
      const observedId = observed || observer;
      const scope =
        observedId === observer ? observerPeer.conclusions : observerPeer.conclusionsOf(observedId);
      const found = await scope.query(query.trim(), 50);
      const mapped: ApiConclusion[] = found.map((c) => ({
        id: c.id,
        content: c.content,
        observer_id: c.observerId,
        observed_id: c.observedId,
        session_id: c.sessionId,
        created_at: c.createdAt,
      }));
      return { items: mapped, total: mapped.length, page: 1, size: mapped.length, pages: 1 };
    }
    return honcho.conclusions.list(o, workspaceId!, { page, size: PAGE_SIZE });
  });

  const peers = useHonchoQuery<{ items: ApiPeer[] }>(
    workspaceId ? `sdk/workspaces/${workspaceId}/peers/list?concl` : null,
    async (o) => ({ items: (await getSdk(o, workspaceId!).peers({ size: 100 })).items.map(toApiPeer) }),
  );

  const items = results.data?.items ?? [];
  const pages = results.data?.pages ?? 1;
  const peerOptions = (peers.data?.items ?? []).map((p) => ({ value: p.id, label: p.id }));

  const runSearch = () => {
    if (!observer) {
      push({ type: "error", message: "Pick an observer peer to semantic-search" });
      return;
    }
    if (!draftQuery.trim()) return;
    setQuery(draftQuery);
    setPage(1);
  };
  const clearSearch = () => {
    setDraftQuery("");
    setQuery("");
    setPage(1);
  };

  const onDelete = async (c: ApiConclusion) => {
    if (!apiOpts || !workspaceId) return;
    const ok = await confirm({
      title: "DELETE_CONCLUSION",
      destructive: true,
      confirmLabel: "DELETE",
      body: (
        <>
          Permanently delete this conclusion about{" "}
          <span className="text-accent font-mono">{c.observed_id}</span> on the live instance? This
          cannot be undone.
        </>
      ),
    });
    if (!ok) return;
    try {
      await honcho.conclusions.delete(apiOpts, workspaceId, c.id);
      invalidate("conclusions/");
      results.refetch();
      push({ type: "success", message: "Conclusion deleted" });
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    }
  };

  return (
    <div className="space-y-3">
      <PageHeader
        title="CONCLUSIONS"
        subtitle="derived facts Honcho has concluded about peers — browse, search, and manage"
        actions={
          <div className="flex items-center gap-2">
            <RefreshButton label="REFRESH" onClick={() => results.refetch()} />
            {canWrite ? (
              <Button icon="plus" onClick={() => setCreateOpen(true)} disabled={!workspaceId}>
                NEW_CONCLUSION
              </Button>
            ) : (
              <Chip tone="muted" icon="key">
                read-only · enable in CONFIG
              </Chip>
            )}
          </div>
        }
      />

      <Panel title="SEMANTIC_SEARCH" status="active">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-2">
          <Field label="OBSERVER" hint="Whose conclusions to search.">
            <Select
              value={observer}
              onChange={setObserver}
              options={peerOptions}
              disabled={!workspaceId}
              placeholder="select a peer…"
            />
          </Field>
          <Field label="OBSERVED" hint="About whom. Blank = the observer itself.">
            <Select
              value={observed}
              onChange={setObserved}
              options={[{ value: "", label: "— self —" }, ...peerOptions]}
              disabled={!workspaceId || !observer}
              placeholder="— self —"
            />
          </Field>
        </div>
        <div className="flex items-center gap-2">
          <TextInput
            value={draftQuery}
            onChange={(e) => setDraftQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch();
            }}
            placeholder={observer ? "search this peer's conclusions…" : "pick an observer peer first…"}
            disabled={!workspaceId}
            className="flex-1"
          />
          <Button
            variant="primary"
            icon="search"
            onClick={runSearch}
            disabled={!workspaceId || !observer || !draftQuery.trim()}
          >
            SEARCH
          </Button>
          {searching ? (
            <Button variant="ghost" icon="x" onClick={clearSearch}>
              CLEAR
            </Button>
          ) : null}
        </div>
        <div className="mt-2 text-[10px] text-text-muted">
          {searching ? (
            <>
              semantic results for <span className="text-accent">{query}</span> ·{" "}
              <span className="text-accent font-mono">{observer}</span> →{" "}
              <span className="text-purple-400 font-mono">{observed || observer}</span> · {items.length} match
              {items.length === 1 ? "" : "es"}
            </>
          ) : (
            <>Honcho stores conclusions per (observer → observed) pair, so semantic search needs an observer. The list below is workspace-wide.</>
          )}
        </div>
      </Panel>

      <Panel
        title={searching ? "SEARCH_RESULTS" : "ALL_CONCLUSIONS"}
        status={results.isLoading ? "processing" : "active"}
        actions={
          !searching && results.data ? (
            <span className="text-[10px] text-text-muted">
              {(results.data.total ?? items.length).toLocaleString()} total
            </span>
          ) : undefined
        }
      >
        {!workspaceId ? (
          <div className="text-xs text-text-muted py-4">Select a workspace in the header to browse conclusions.</div>
        ) : results.isLoading && items.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 bg-border/40 animate-pulse" />
            ))}
          </div>
        ) : results.error ? (
          <div className="text-xs text-red-400">{formatApiError(results.error)}</div>
        ) : items.length === 0 ? (
          <div className="text-xs text-text-muted py-6 text-center">
            {searching ? "No conclusions match that search." : "No conclusions in this workspace yet."}
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((c, i) => (
              <ConclusionRow key={c.id} c={c} index={i} canWrite={canWrite} onDelete={() => onDelete(c)} />
            ))}
          </div>
        )}

        {!searching && results.data && pages > 1 ? (
          <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-[11px]">
            <Button
              variant="ghost"
              size="sm"
              icon="chevron-right"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || results.isLoading}
            >
              PREV
            </Button>
            <span className="text-text-muted tabular-nums">
              page {results.data.page ?? page} / {pages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              icon="chevron-right"
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page >= pages || results.isLoading}
            >
              NEXT
            </Button>
          </div>
        ) : null}
      </Panel>

      {canWrite ? (
        <CreateConclusionModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          peers={peers.data?.items ?? []}
          onCreated={() => {
            invalidate("conclusions/");
            results.refetch();
          }}
        />
      ) : null}

      <StatusBar />
    </div>
  );
}

function ConclusionRow({
  c,
  index,
  canWrite,
  onDelete,
}: {
  c: ApiConclusion;
  index: number;
  canWrite: boolean;
  onDelete: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.3), duration: 0.2, ease: EASE }}
      className="border border-border bg-void/30 p-3 hover:border-border-light transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1.5 text-[10px]">
            <span className="text-accent font-mono">{c.observer_id}</span>
            <Icon name="chevron-right" size={10} className="text-text-muted" />
            <span className="text-purple-400 font-mono">{c.observed_id}</span>
            {c.session_id ? <Chip tone="cyan">{c.session_id}</Chip> : null}
          </div>
          <p className="text-[12px] text-text-primary leading-relaxed break-words">{c.content}</p>
          <div className="mt-1.5 text-[9px] text-text-muted tabular-nums">{c.created_at}</div>
        </div>
        {canWrite ? (
          <button
            onClick={onDelete}
            className="shrink-0 text-text-muted hover:text-red-400 transition-colors p-1"
            aria-label="Delete conclusion"
          >
            <Icon name="trash" size={12} />
          </button>
        ) : null}
      </div>
    </motion.div>
  );
}

function CreateConclusionModal({
  open,
  onClose,
  peers,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  peers: ApiPeer[];
  onCreated: () => void;
}) {
  const apiOpts = useActiveHonchoOptions();
  const { workspaceId } = useActiveWorkspace();
  const { push } = useToast();
  const confirm = useConfirm();

  const [observer, setObserver] = useState("");
  const [observed, setObserved] = useState(""); // "" = self (same as observer)
  const [content, setContent] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [busy, setBusy] = useState(false);

  const peerOptions = useMemo(() => peers.map((p) => ({ value: p.id, label: p.id })), [peers]);

  const create = async () => {
    if (!apiOpts || !workspaceId) return;
    const text = content.trim();
    if (!observer) {
      push({ type: "error", message: "Pick an observer peer" });
      return;
    }
    if (!text) {
      push({ type: "error", message: "Conclusion content is required" });
      return;
    }
    const observedId = observed || observer;
    const ok = await confirm({
      title: "CREATE_CONCLUSION",
      confirmLabel: "CREATE",
      body: (
        <>
          Write a new conclusion where <span className="text-accent font-mono">{observer}</span>{" "}
          concludes about <span className="text-purple-400 font-mono">{observedId}</span> on the live
          instance?
        </>
      ),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const observerPeer = await getSdk(apiOpts, workspaceId).peer(observer);
      const scope = observedId === observer ? observerPeer.conclusions : observerPeer.conclusionsOf(observedId);
      await scope.create({ content: text, ...(sessionId.trim() ? { sessionId: sessionId.trim() } : {}) });
      push({ type: "success", message: "Conclusion created" });
      setContent("");
      setSessionId("");
      onCreated();
      onClose();
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="NEW_CONCLUSION"
      open={open}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            CANCEL
          </Button>
          <Button variant="primary" onClick={create} disabled={busy}>
            {busy ? "CREATING…" : "CREATE"}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="OBSERVER" hint="The peer making the conclusion.">
          <Select value={observer} onChange={setObserver} options={peerOptions} placeholder="select a peer…" />
        </Field>
        <Field label="OBSERVED" hint="Who it's about. Blank = the observer itself.">
          <Select
            value={observed}
            onChange={setObserved}
            options={[{ value: "", label: "— self —" }, ...peerOptions]}
            placeholder="— self —"
          />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="CONTENT" hint="The derived fact, e.g. 'prefers dark mode'.">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            spellCheck={false}
            placeholder="a fact this peer concluded…"
            className="w-full bg-void border border-border px-3 py-2 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:border-accent outline-none transition-colors duration-150 resize-y"
          />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="SESSION_ID" hint="Optional — attribute the conclusion to a session.">
          <TextInput
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            placeholder="(optional)"
          />
        </Field>
      </div>
    </Modal>
  );
}
