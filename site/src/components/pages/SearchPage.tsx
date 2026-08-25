"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Chip, Field, PillTabs, TextInput } from "@/components/atoms";
import { Select } from "@/components/Select";
import { Icon } from "@/components/icons";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { getSdk } from "@/lib/honcho/sdk";
import { toApiMessage, toApiPeer, toApiSession } from "@/lib/honcho/adapters";
import { formatApiError, useHonchoQuery } from "@/lib/honcho/useQuery";
import { buildSearchFilters } from "@/lib/honcho/searchFilters";
import { orderSearchResults, type SearchOrder } from "@/lib/honcho/searchOrdering";
import type { ApiMessage, ApiPeer, ApiSession } from "@/lib/honcho/types";

type SearchScope = "workspace" | "session" | "peer";

interface SearchRun {
  workspaceId: string;
  query: string;
  scope: SearchScope;
  targetId: string;
  items: ApiMessage[];
}

const LIMIT_OPTIONS = [10, 25, 50, 100].map((n) => ({ value: String(n), label: String(n) }));
const ORDER_OPTIONS: { value: SearchOrder; label: string }[] = [
  { value: "relevance", label: "Honcho relevance" },
  { value: "newest", label: "newest first" },
  { value: "oldest", label: "oldest first" },
];

export function SearchPage() {
  const apiOpts = useActiveHonchoOptions();
  const { workspaceId } = useActiveWorkspace();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("workspace");
  const [targetId, setTargetId] = useState("");
  const [limit, setLimit] = useState("25");
  const [order, setOrder] = useState<SearchOrder>("relevance");
  const [advanced, setAdvanced] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [metadataJson, setMetadataJson] = useState("");
  const [run, setRun] = useState<SearchRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const peers = useHonchoQuery<{ items: ApiPeer[] }>(
    workspaceId ? `sdk/workspaces/${workspaceId}/peers/list?native-search` : null,
    async (o) => ({
      items: (await getSdk(o, workspaceId!).peers({ size: 100 })).items.map(toApiPeer),
    }),
  );
  const sessions = useHonchoQuery<{ items: ApiSession[] }>(
    workspaceId ? `sdk/workspaces/${workspaceId}/sessions/list?native-search` : null,
    async (o) => ({
      items: (await getSdk(o, workspaceId!).sessions({ size: 100 })).items.map(toApiSession),
    }),
  );

  const targetOptions = useMemo(() => {
    if (scope === "peer") {
      return (peers.data?.items ?? []).map((peer) => ({ value: peer.id, label: peer.id }));
    }
    if (scope === "session") {
      return (sessions.data?.items ?? []).map((session) => ({ value: session.id, label: session.id }));
    }
    return [];
  }, [peers.data?.items, scope, sessions.data?.items]);

  const effectiveTarget = targetOptions.some((option) => option.value === targetId) ? targetId : "";
  const targetRequired = scope !== "workspace";
  const currentRun = run?.workspaceId === workspaceId ? run : null;
  const orderedItems = useMemo(
    () => orderSearchResults(currentRun?.items ?? [], order),
    [currentRun?.items, order],
  );
  const hasFilters = !!(fromDate || toDate || metadataJson.trim());

  const changeScope = (next: SearchScope) => {
    setScope(next);
    setTargetId("");
    setError(null);
    setRun(null);
  };

  const search = async () => {
    const searchQuery = query.trim();
    if (!apiOpts || !workspaceId || !searchQuery || (targetRequired && !effectiveTarget)) return;

    const built = buildSearchFilters({ fromDate, toDate, metadataJson });
    if (!built.ok) {
      setError(built.error);
      setRun(null);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const sdk = getSdk(apiOpts, workspaceId);
      const options = { filters: built.filters, limit: Number(limit) };
      const found =
        scope === "session"
          ? await (await sdk.session(effectiveTarget)).search(searchQuery, options)
          : scope === "peer"
            ? await (await sdk.peer(effectiveTarget)).search(searchQuery, options)
            : await sdk.search(searchQuery, options);

      setRun({
        workspaceId,
        query: searchQuery,
        scope,
        targetId: effectiveTarget,
        items: found.map(toApiMessage),
      });
    } catch (err) {
      setError(formatApiError(err));
      setRun(null);
    } finally {
      setBusy(false);
    }
  };

  const canSearch =
    !!apiOpts && !!workspaceId && !!query.trim() && (!targetRequired || !!effectiveTarget) && !busy;

  return (
    <div className="space-y-3">
      <PageHeader
        title="SEARCH"
        subtitle="hybrid keyword and semantic search across Honcho messages"
      />

      <Panel title="NATIVE_SEARCH" status={busy ? "processing" : "active"}>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSearch) search();
          }}
        >
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Icon
                name="search"
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
              />
              <TextInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={workspaceId ? `search ${workspaceId}…` : "select a workspace first…"}
                disabled={!workspaceId || busy}
                className="pl-9"
                autoFocus
              />
            </div>
            <Button type="submit" variant="solid" icon="search" disabled={!canSearch}>
              {busy ? "SEARCHING…" : "SEARCH"}
            </Button>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <Field label="SCOPE" className="min-w-[280px]">
              <PillTabs<SearchScope>
                items={[
                  { key: "workspace", label: "WORKSPACE" },
                  { key: "session", label: "SESSION" },
                  { key: "peer", label: "PEER" },
                ]}
                current={scope}
                onChange={changeScope}
                layoutId="native-search-scope"
              />
            </Field>

            {targetRequired ? (
              <Field label={scope === "session" ? "SESSION" : "PEER"} className="min-w-[220px] flex-1">
                <Select
                  value={effectiveTarget}
                  onChange={setTargetId}
                  options={targetOptions}
                  placeholder={
                    scope === "session"
                      ? sessions.isLoading
                        ? "loading sessions…"
                        : "select a session…"
                      : peers.isLoading
                        ? "loading peers…"
                        : "select a peer…"
                  }
                  disabled={!workspaceId || busy || (scope === "session" ? sessions.isLoading : peers.isLoading)}
                />
              </Field>
            ) : null}

            <Field label="ORDER" className="w-[180px]">
              <Select<SearchOrder>
                value={order}
                onChange={setOrder}
                options={ORDER_OPTIONS}
                disabled={busy}
              />
            </Field>

            <Field label="MAX_RESULTS" className="w-[140px]">
              <Select value={limit} onChange={setLimit} options={LIMIT_OPTIONS} disabled={busy} />
            </Field>

            <Button
              type="button"
              variant={advanced || hasFilters ? "primary" : "ghost"}
              icon="filter"
              onClick={() => setAdvanced((open) => !open)}
            >
              FILTERS{hasFilters ? " *" : ""}
            </Button>
          </div>

          {advanced ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-border">
              <Field label="FROM_DATE_UTC" hint="Inclusive UTC day.">
                <TextInput type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
              </Field>
              <Field label="TO_DATE_UTC" hint="Inclusive UTC day.">
                <TextInput type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
              </Field>
              <Field
                label="METADATA_FILTER"
                hint='Optional JSON object, for example {"source":"docs"}.'
                className="sm:col-span-2"
              >
                <TextInput
                  value={metadataJson}
                  onChange={(event) => setMetadataJson(event.target.value)}
                  placeholder='{"key":"value"}'
                  spellCheck={false}
                />
              </Field>
            </div>
          ) : null}

          <div className="flex items-start gap-2 text-[10px] text-text-muted">
            <Icon name="brain" size={11} className="mt-px shrink-0" />
            <span>
              Honcho relevance blends full-text and semantic rankings. Date order is applied after Honcho returns the selected maximum; new messages may take a few seconds to enter semantic results.
            </span>
          </div>
        </form>
      </Panel>

      {error ? (
        <Panel title="SEARCH_ERROR" status="processing">
          <div className="text-xs text-red-400">{error}</div>
        </Panel>
      ) : busy ? (
        <Panel title="SEARCH_RESULTS" status="processing">
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="border border-border bg-void/30 p-3 space-y-2">
                <div className="h-3 w-1/3 bg-border/60 animate-pulse" />
                <div className="h-3 bg-border/40 animate-pulse" />
                <div className="h-3 w-4/5 bg-border/40 animate-pulse" />
              </div>
            ))}
          </div>
        </Panel>
      ) : !currentRun ? (
        <Panel title="SEARCH_READY">
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
            <Icon name="search" size={24} className="text-text-muted" />
            <div className="text-xs text-text-primary">Search the selected workspace</div>
            <div className="text-[10px] text-text-muted max-w-[58ch]">
              Keep Honcho&apos;s native relevance ranking or order the returned matches chronologically, then narrow by session, peer, date range, or metadata.
            </div>
          </div>
        </Panel>
      ) : orderedItems.length === 0 ? (
        <Panel title="NO_MATCHES">
          <div className="text-xs text-text-muted py-6 text-center">
            No messages matched <span className="text-text-primary">“{currentRun.query}”</span>. Try a broader query or remove filters.
          </div>
        </Panel>
      ) : (
        <Panel
          title="SEARCH_RESULTS"
          actions={<Chip tone="accent">{orderedItems.length} MATCHES</Chip>}
        >
          <div className="mb-3 text-[10px] text-text-muted">
            scope: <span className="text-text-primary">{currentRun.scope}</span>
            {currentRun.targetId ? (
              <> · target: <span className="text-accent">{currentRun.targetId}</span></>
            ) : null}
            {" · "}order: <span className="text-text-primary">{order}</span>
            {" · "}query: <span className="text-text-primary">“{currentRun.query}”</span>
          </div>
          <div className="space-y-2">
            {orderedItems.map((message, index) => (
              <article key={message.id} className="border border-border bg-void/30 p-3">
                <div className="flex flex-wrap items-center gap-2 text-[10px] mb-2">
                  <span className="text-text-muted tabular-nums">#{String(index + 1).padStart(2, "0")}</span>
                  <Chip tone="accent" icon="user">{message.peer_id}</Chip>
                  <Chip tone="muted" icon="git-branch">{message.session_id}</Chip>
                  <span className="text-text-muted tabular-nums">
                    {new Date(message.created_at).toLocaleString()}
                  </span>
                  <span className="text-text-muted tabular-nums">{message.token_count} tok</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={() => {
                      window.location.hash = `#/messages?session=${encodeURIComponent(message.session_id)}&peer=${encodeURIComponent(message.peer_id)}`;
                    }}
                  >
                    VIEW_MESSAGES
                  </Button>
                </div>
                <div className="text-xs text-text-primary whitespace-pre-wrap break-words leading-relaxed">
                  {message.content}
                </div>
              </article>
            ))}
          </div>
        </Panel>
      )}

      <StatusBar />
    </div>
  );
}
