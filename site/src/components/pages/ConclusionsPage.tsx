"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import type { Scope } from "@honcho-ai/sdk";
import { motion } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { Markdown } from "@/components/Markdown";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Checkbox, Chip, Field, PillTabs, RefreshButton, TextInput } from "@/components/atoms";
import { Modal } from "@/components/Modal";
import { ConclusionInspector } from "@/components/ConclusionInspector";
import { ConclusionTrashPanel } from "@/components/ConclusionTrashPanel";
import { TRASH_LIMIT, trashScope, useConclusionTrash } from "@/lib/conclusionTrash";
import { HonchoFeatureNotice } from "@/components/HonchoFeatureNotice";
import { useHonchoCapabilities } from "@/lib/honcho/useCapabilities";
import { Select } from "@/components/Select";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm";
import { useWriteActions } from "@/lib/writeActions";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { formatApiError, invalidate, useHonchoQuery } from "@/lib/honcho/useQuery";
import { honcho } from "@/lib/honcho/client";
import { getSdk } from "@/lib/honcho/sdk";
import { toApiConclusion, toApiPeer } from "@/lib/honcho/adapters";
import type { ApiConclusion, ApiPeer, Page } from "@/lib/honcho/types";
import { listAllScopes } from "@/lib/honcho/scopeListing";
import { conclusionSourceFilter, scopeOfObserver, type ConclusionSource } from "@/lib/honcho/scopeCopies";
import { useTextHighlight } from "@/lib/textHighlight";
import { cn } from "@/lib/utils";
import { useHash } from "@/lib/nav";
import {
  SESSION_SCAN_LIMIT,
  conclusionsHash,
  deleteConclusions,
  findDerivedElsewhere,
  listAllConclusions,
  readConclusionsHash,
  withSessionFilter,
  type DerivedElsewhere,
} from "@/lib/honcho/sessionConclusions";

const EASE = [0.25, 0.46, 0.45, 0.94] as const;
const PAGE_SIZE = 25;

export function ConclusionsPage() {
  const opts = useActiveHonchoOptions();
  const { workspaceId } = useActiveWorkspace();
  return <ConclusionsSession key={`${opts?.baseUrl}/${opts?.token}/${workspaceId}`} />;
}

function ConclusionsSession() {
  const apiOpts = useActiveHonchoOptions();
  const { workspaceId } = useActiveWorkspace();
  const { push } = useToast();
  const confirm = useConfirm();
  const { enabled: canWrite } = useWriteActions();

  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState(""); // submitted semantic search
  const [observer, setObserver] = useState("");
  const [observed, setObserved] = useState(""); // "" = self (observer about itself)
  // `#/conclusions?session=<id>` narrows everything below to one session.
  const { session: sessionFilter } = readConclusionsHash(useHash());
  const setSessionFilter = (id: string | null) => {
    window.location.hash = conclusionsHash(id);
  };
  // Page and selection belong to the session filter they were made under.
  const [pageState, setPageState] = useState<{ session: string | null; page: number }>({ session: sessionFilter, page: 1 });
  const page = pageState.session === sessionFilter ? pageState.page : 1;
  const setPage = (next: number | ((current: number) => number)) =>
    setPageState((prev) => {
      const current = prev.session === sessionFilter ? prev.page : 1;
      return { session: sessionFilter, page: typeof next === "function" ? next(current) : next };
    });
  const [selection, setSelection] = useState<{ session: string | null; items: Map<string, ApiConclusion> }>(
    () => ({ session: sessionFilter, items: new Map() }),
  );
  const selected = selection.session === sessionFilter ? selection.items : new Map<string, ApiConclusion>();
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [selectingAll, setSelectingAll] = useState(false);
  const [derivedFor, setDerivedFor] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [inspected, setInspected] = useState<string | null>(null);
  const [source, setSource] = useState<ConclusionSource>("all");
  const { provenance, scopes: scopesCapability } = useHonchoCapabilities();
  const trash = useConclusionTrash(apiOpts && workspaceId ? trashScope(apiOpts.baseUrl, workspaceId) : null);

  // Scope copies only exist on 3.1+ servers with scopes; the list key matches ScopesPage's.
  const scopes = useHonchoQuery<Scope[]>(
    workspaceId && scopesCapability === "available" ? `workspaces/${workspaceId}/scopes/list` : null,
    (o) => listAllScopes(getSdk(o, workspaceId!)),
  );
  const scopeIds = useMemo(() => (scopes.data ?? []).map((scope) => scope.id), [scopes.data]);
  const sourceFilter = conclusionSourceFilter(source, scopeIds);
  const listFilter = withSessionFilter(sourceFilter, sessionFilter);

  // Honcho's conclusion semantic search is scoped to an (observer, observed)
  // pair — `/conclusions/query` 422s without it. So a query needs an observer.
  // Browsing the full list (`/conclusions/list`) stays workspace-wide.
  const searching = query.trim().length > 0 && !!observer;
  const resultsKey = workspaceId
    ? searching
      ? `conclusions/query/${workspaceId}/${observer}/${observed || observer}/${query}/s:${sessionFilter ?? ""}`
      : listFilter === null
        ? null
        : `conclusions/list/${workspaceId}/p${page}/${source}/${source === "all" ? "" : scopeIds.join(",")}/s:${sessionFilter ?? ""}`
    : null;

  const results = useHonchoQuery<Page<ApiConclusion>>(resultsKey, async (o) => {
    if (searching) {
      const observerPeer = await getSdk(o, workspaceId!).peer(observer);
      const observedId = observed || observer;
      const scope =
        observedId === observer ? observerPeer.conclusions : observerPeer.conclusionsOf(observedId);
      const found = await scope.query(query.trim(), 50);
      // Semantic search can't filter by session on the server; narrow its top matches here.
      const mapped = found.map(toApiConclusion).filter((c) => !sessionFilter || c.session_id === sessionFilter);
      return { items: mapped, total: mapped.length, page: 1, size: mapped.length, pages: 1 };
    }
    return honcho.conclusions.list(o, workspaceId!, { page, size: PAGE_SIZE, ...(listFilter ? { filters: listFilter } : {}) });
  });

  // One level of conclusions that cite this session's conclusions but are filed elsewhere.
  const derived = useHonchoQuery<{ items: DerivedElsewhere[]; scanned: number; truncated: boolean }>(
    workspaceId && sessionFilter && derivedFor === sessionFilter && provenance === "available"
      ? `conclusions/derived/${workspaceId}/${sessionFilter}`
      : null,
    (o) => findDerivedElsewhere((params) => honcho.conclusions.list(o, workspaceId!, params), sessionFilter!),
  );

  const peers = useHonchoQuery<{ items: ApiPeer[] }>(
    workspaceId ? `sdk/workspaces/${workspaceId}/peers/list?concl` : null,
    async (o) => ({ items: (await getSdk(o, workspaceId!).peers({ size: 100 })).items.map(toApiPeer) }),
  );

  const items = results.data?.items ?? [];
  const pages = results.data?.pages ?? 1;
  const peerOptions = (peers.data?.items ?? []).map((p) => ({ value: p.id, label: p.id }));
  const listRef = useRef<HTMLDivElement | null>(null);
  // Semantic matches often share no words with the query; highlight the ones that do.
  useTextHighlight(listRef, searching ? query : "", results.data);

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
          Delete this conclusion about{" "}
          <span className="text-accent font-mono">{c.observed_id}</span> on the live instance? Honcho
          deletes it permanently. A copy stays in this tab&apos;s TRASH so you can recreate it as a new
          explicit conclusion.
        </>
      ),
    });
    if (!ok) return;
    try {
      await honcho.conclusions.delete(apiOpts, workspaceId, c.id);
      const kept = trash.add(c);
      invalidate("conclusions/");
      invalidate(`provenance/${workspaceId}/`);
      results.refetch();
      push(kept
        ? { type: "success", message: "Conclusion deleted · copy kept in TRASH" }
        : { type: "info", message: "Conclusion deleted. This browser blocked the trash copy." });
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    }
  };

  const updateSelection = (change: (next: Map<string, ApiConclusion>) => void) =>
    setSelection((prev) => {
      const next = new Map(prev.session === sessionFilter ? prev.items : []);
      change(next);
      return { session: sessionFilter, items: next };
    });
  const toggleSelected = (c: ApiConclusion, on: boolean) =>
    updateSelection((next) => (on ? next.set(c.id, c) : next.delete(c.id)));
  const pageAllSelected = items.length > 0 && items.every((c) => selected.has(c.id));
  const selectPage = () =>
    updateSelection((next) => items.forEach((c) => (pageAllSelected ? next.delete(c.id) : next.set(c.id, c))));

  const selectAllInSession = async () => {
    if (!apiOpts || !workspaceId || !sessionFilter) return;
    setSelectingAll(true);
    try {
      const all = await listAllConclusions(
        (params) => honcho.conclusions.list(apiOpts, workspaceId, params),
        { session_id: sessionFilter },
      );
      updateSelection((next) => all.items.forEach((c) => next.set(c.id, c)));
      if (all.truncated) push({ type: "info", message: `Selected the first ${SESSION_SCAN_LIMIT.toLocaleString()} conclusions in this session.` });
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    } finally {
      setSelectingAll(false);
    }
  };

  const deleteSelected = async () => {
    if (!apiOpts || !workspaceId || bulk) return;
    const list = [...selected.values()];
    if (!list.length) return;
    const ok = await confirm({
      title: "DELETE_CONCLUSIONS",
      destructive: true,
      confirmLabel: `DELETE ${list.length}`,
      body: (
        <>
          Delete {list.length} {list.length === 1 ? "conclusion" : "conclusions"} on the live instance? Honcho deletes
          them permanently, one at a time. This tab&apos;s TRASH keeps a copy of each
          {list.length > TRASH_LIMIT ? `, up to the newest ${TRASH_LIMIT}` : ""} so you can recreate it as a new explicit
          conclusion. Derived conclusions that cite these are not deleted with them.
          {sessionFilter && provenance === "available" && derivedFor !== sessionFilter ? (
            <span className="block mt-2 text-yellow-400">
              Run FIND_DERIVED first. It starts from this session&apos;s conclusions, so once they are deleted it can&apos;t
              find what was derived from them.
            </span>
          ) : null}
        </>
      ),
    });
    if (!ok) return;
    setBulk({ done: 0, total: list.length });
    try {
      const outcome = await deleteConclusions(
        list,
        (id) => honcho.conclusions.delete(apiOpts, workspaceId, id),
        (done, total) => setBulk({ done, total }),
      );
      let kept = 0;
      for (const c of outcome.deleted) if (trash.add(c)) kept += 1;
      updateSelection((next) => {
        outcome.deleted.forEach((c) => next.delete(c.id));
        outcome.gone.forEach((id) => next.delete(id));
      });
      invalidate("conclusions/");
      invalidate(`provenance/${workspaceId}/`);
      results.refetch();
      derived.refetch();
      const done = outcome.deleted.length;
      const parts = [
        `Deleted ${done} ${done === 1 ? "conclusion" : "conclusions"}`,
        outcome.gone.length ? `${outcome.gone.length} already gone` : null,
        done ? (kept === done ? "copies kept in TRASH" : `${kept} of ${done} copies kept in TRASH`) : null,
      ].filter(Boolean).join(" · ");
      if (outcome.failed.length) {
        push({ type: "error", message: `${parts}. ${outcome.failed.length} failed and stay selected: ${outcome.failed[0].error}` });
      } else {
        push({ type: "success", message: parts });
      }
    } finally {
      setBulk(null);
    }
  };

  const rowProps = (c: ApiConclusion, index: number, note?: ReactNode) => ({
    c,
    index,
    canWrite,
    note,
    onDelete: () => onDelete(c),
    onInspect: provenance === "available" ? () => setInspected(c.id) : undefined,
    selected: canWrite ? selected.has(c.id) : undefined,
    onSelect: canWrite ? (on: boolean) => toggleSelected(c, on) : undefined,
    onSessionClick: c.session_id && c.session_id !== sessionFilter ? () => setSessionFilter(c.session_id!) : undefined,
  });

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

      <HonchoFeatureNotice state={provenance} minimum="3.2" feature="Conclusion provenance" />

      <Panel
        title={searching ? "SEARCH_RESULTS" : sessionFilter ? "SESSION_CONCLUSIONS" : "ALL_CONCLUSIONS"}
        status={results.isLoading ? "processing" : "active"}
        actions={
          !searching && results.data ? (
            <span className="text-[10px] text-text-muted">
              {(results.data.total ?? items.length).toLocaleString()} total
            </span>
          ) : undefined
        }
      >
        {sessionFilter ? (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Chip tone="cyan" icon="git-branch">SESSION · {sessionFilter}</Chip>
            <Button variant="ghost" size="sm" icon="x" onClick={() => setSessionFilter(null)} title="Show conclusions from every session">
              CLEAR
            </Button>
            <span className="text-[10px] text-text-muted max-w-[80ch]">
              {searching
                ? "Semantic search ranks the observer's conclusions first, then keeps those filed under this session."
                : "Conclusions Honcho filed under this session. Dreams can file conclusions derived from them elsewhere, and DERIVED_ELSEWHERE below finds those."}
            </span>
          </div>
        ) : null}
        {!searching && scopeIds.length > 0 ? (
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <PillTabs<ConclusionSource>
              items={[
                { key: "all", label: "ALL" },
                { key: "peers", label: "PEER_MEMORY" },
                { key: "scopes", label: "SCOPE_COPIES", icon: "focus" },
              ]}
              current={source}
              onChange={(next) => { setSource(next); setPage(1); }}
              layoutId="conclusion-source"
            />
            <span className="text-[10px] text-text-muted max-w-[70ch]">
              Adding a session to a scope copies its conclusions into that scope so scoped recall has evidence. Copies are labeled SCOPE.
            </span>
          </div>
        ) : null}
        {canWrite && workspaceId && (items.length > 0 || selected.size > 0) ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-border pb-3">
            <Checkbox
              checked={pageAllSelected}
              onChange={selectPage}
              disabled={!items.length || !!bulk}
              label={<span className="text-[10px] uppercase tracking-wider text-text-muted">SELECT_PAGE</span>}
            />
            {sessionFilter && !searching ? (
              <Button variant="ghost" size="sm" onClick={selectAllInSession} disabled={selectingAll || !!bulk}>
                {selectingAll ? "SELECTING…" : `SELECT_ALL_IN_SESSION (${(results.data?.total ?? items.length).toLocaleString()})`}
              </Button>
            ) : null}
            {selected.size ? (
              <>
                <span className="text-[11px] text-text-primary tabular-nums ml-1">{selected.size.toLocaleString()} selected</span>
                <Button variant="ghost" size="sm" onClick={() => updateSelection((next) => next.clear())} disabled={!!bulk}>
                  CLEAR_SELECTION
                </Button>
                <Button variant="warning" size="sm" icon="trash" onClick={deleteSelected} disabled={!!bulk} className="ml-auto">
                  {bulk ? `DELETING ${bulk.done}/${bulk.total}…` : "DELETE_SELECTED"}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
        {!workspaceId ? (
          <div className="text-xs text-text-muted py-4">Select a workspace in the header to browse conclusions.</div>
        ) : listFilter === null ? (
          <div className="text-xs text-text-muted py-6 text-center">This workspace has no scopes, so there are no scope copies.</div>
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
            {searching
              ? "No conclusions match that search."
              : sessionFilter
                ? "Honcho has filed no conclusions under this session. Derived ones can still be filed elsewhere. Check DERIVED_ELSEWHERE below."
                : source === "scopes"
                  ? "No scope copies yet. They appear after a scope member session is reasoned over."
                  : "No conclusions in this workspace yet."}
          </div>
        ) : (
          <div ref={listRef} className="space-y-2">
            {items.map((c, i) => (
              <ConclusionRow key={c.id} {...rowProps(c, i)} />
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

      {workspaceId && sessionFilter && !searching ? (
        <Panel
          title="DERIVED_ELSEWHERE"
          status={derived.isLoading ? "processing" : "idle"}
          actions={derived.data ? (
            <span className="text-[10px] text-text-muted tabular-nums">
              {derived.data.items.length.toLocaleString()} found · {derived.data.scanned.toLocaleString()} premises checked
            </span>
          ) : undefined}
        >
          <p className="text-[11px] text-text-muted leading-relaxed max-w-[90ch] mb-3">
            Conclusions that cite this session&apos;s conclusions as premises but are filed under another session or none,
            usually by a dream. One level only: open PROVENANCE on one to follow it further.
          </p>
          {provenance !== "available" ? (
            <div className="text-[11px] text-text-muted">Needs a confirmed Honcho 3.2 or later server, which records premises.</div>
          ) : derivedFor !== sessionFilter ? (
            <Button variant="outline" size="sm" icon="search" onClick={() => setDerivedFor(sessionFilter)}>
              FIND_DERIVED
            </Button>
          ) : derived.error ? (
            <div className="text-xs text-red-400">{formatApiError(derived.error)}</div>
          ) : derived.isLoading || !derived.data ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 bg-border/40 animate-pulse" />)}
            </div>
          ) : derived.data.scanned === 0 ? (
            <div className="text-xs text-text-muted py-3 max-w-[90ch]">
              This session has no conclusions to start from. Conclusions derived from ones already deleted still cite their
              old IDs, and this search can&apos;t see those.
            </div>
          ) : derived.data.items.length === 0 ? (
            <div className="text-xs text-text-muted py-3">
              Nothing outside this session cites its {derived.data.scanned.toLocaleString()} conclusions.
            </div>
          ) : (
            <div className="space-y-2">
              {derived.data.truncated ? (
                <p className="text-[10px] text-yellow-400">
                  Stopped at {SESSION_SCAN_LIMIT.toLocaleString()} conclusions, so this list may be incomplete.
                </p>
              ) : null}
              {derived.data.items.map(({ conclusion, cites }, i) => (
                <ConclusionRow
                  key={conclusion.id}
                  {...rowProps(conclusion, i, `cites ${cites} of this session's conclusions`)}
                />
              ))}
            </div>
          )}
        </Panel>
      ) : null}

      {workspaceId ? (
        <ConclusionTrashPanel
          items={trash.items}
          apiOpts={apiOpts}
          workspaceId={workspaceId}
          canWrite={canWrite}
          onRemove={trash.remove}
          onClear={trash.clear}
          onRestored={() => {
            invalidate("conclusions/");
            invalidate(`provenance/${workspaceId}/`);
            results.refetch();
          }}
        />
      ) : null}

      {canWrite ? (
        <CreateConclusionModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          peers={peers.data?.items ?? []}
          onCreated={() => {
            invalidate("conclusions/");
            invalidate(`provenance/${workspaceId}/`);
            results.refetch();
          }}
        />
      ) : null}

      <StatusBar />
      {inspected && provenance === "available" ? <ConclusionInspector key={inspected} id={inspected} onClose={() => setInspected(null)} /> : null}
    </div>
  );
}

function ConclusionRow({
  c,
  index,
  canWrite,
  onDelete,
  onInspect,
  selected,
  onSelect,
  onSessionClick,
  note,
}: {
  c: ApiConclusion;
  index: number;
  canWrite: boolean;
  onDelete: () => void;
  onInspect?: () => void;
  /** Present when rows can be selected for a bulk delete. */
  selected?: boolean;
  onSelect?: (on: boolean) => void;
  /** Narrow the page to this conclusion's session. */
  onSessionClick?: () => void;
  note?: ReactNode;
}) {
  const scopeName = scopeOfObserver(c.observer_id);
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.3), duration: 0.2, ease: EASE }}
      className={cn(
        "border bg-void/30 p-3 hover:border-border-light transition-colors",
        selected ? "border-accent/50" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        {onSelect ? (
          <Checkbox
            checked={!!selected}
            onChange={onSelect}
            className="pt-0.5"
            label={<span className="sr-only">Select this conclusion</span>}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1.5 text-[10px]">
            {scopeName ? (
              <span title={`Copy Honcho keeps for recall inside scope ${scopeName}. Observer ${c.observer_id}.`}>
                <Chip tone="muted" icon="focus">SCOPE · {scopeName}</Chip>
              </span>
            ) : (
              <span className="text-accent font-mono">{c.observer_id}</span>
            )}
            <Icon name="arrow-right" size={10} className="text-text-muted" />
            <span className="text-purple-400 font-mono">{c.observed_id}</span>
            {c.session_id ? (
              onSessionClick ? (
                <button
                  type="button"
                  onClick={onSessionClick}
                  title={`Show only conclusions filed under ${c.session_id}`}
                  className="focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1 hover:opacity-80"
                >
                  <Chip tone="cyan">{c.session_id}</Chip>
                </button>
              ) : (
                <Chip tone="cyan">{c.session_id}</Chip>
              )
            ) : (
              <span className="text-text-muted">no session</span>
            )}
          </div>
          <p className="text-[12px] text-text-primary leading-relaxed break-words">
            <Markdown inline text={c.content} />
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-text-muted tabular-nums">
            <span>{new Date(c.created_at).toLocaleString()}</span>
            {onInspect ? <>
              <Chip tone="purple">{c.level ?? "explicit"}</Chip>
              <span>
                {c.times_derived ?? 1} derivations · {c.source_ids?.length ?? 0} parents
                {/* Honcho 3.5+ sends citations (null when none were recorded). */}
                {Array.isArray(c.source_message_ids) ? ` · ${c.source_message_ids.length} cited ${c.source_message_ids.length === 1 ? "message" : "messages"}` : null}
              </span>
              <Button size="sm" variant="ghost" onClick={onInspect}>PROVENANCE</Button>
            </> : null}
            {note ? <span className="text-text-primary">{note}</span> : null}
          </div>
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
