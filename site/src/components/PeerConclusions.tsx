"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, Tabs, TextInput } from "@/components/atoms";
import { ConclusionInspector } from "@/components/ConclusionInspector";
import { Icon } from "@/components/icons";
import { Markdown } from "@/components/Markdown";
import { Select } from "@/components/Select";
import { honcho as raw } from "@/lib/honcho/client";
import { useActiveHonchoOptions } from "@/lib/honcho/config";
import { useHonchoCapabilities } from "@/lib/honcho/useCapabilities";
import { useListTotal } from "@/lib/honcho/useListTotal";
import { formatApiError, useHonchoQuery } from "@/lib/honcho/useQuery";
import type { ApiConclusion, ApiMessage } from "@/lib/honcho/types";
import {
  CONCLUSION_LEVELS,
  appendPage,
  conclusionFilters,
  defaultLevel,
  foldDuplicates,
  shortAge,
  type LevelTab,
  type Perspective,
} from "@/lib/peerMemory";
import { cn } from "@/lib/utils";
import { LEVEL_META, levelMeta } from "@/lib/conclusionLevels";
import { useNow } from "@/lib/useNow";

const PAGE = 10;
const LONG_TEXT = 280;
const DAY_MS = 86_400_000;

// The header and every row share one grid through subgrid, so the detail columns
// can size to their widest content (peer names are short) and still line up.
// The conclusion text takes all the remaining width. HELD_BY stops growing at
// 16rem; a longer peer id truncates, with the full list in its title.
// Below the container breakpoint each row stacks: text, then one line of details.
const TABLE_COLS = {
  withLevel: "@3xl:grid-cols-[minmax(0,1fr)_max-content_fit-content(16rem)_max-content_max-content]",
  plain: "@3xl:grid-cols-[minmax(0,1fr)_fit-content(16rem)_max-content_max-content]",
} as const;
const SUBGRID_ROW = "@3xl:col-span-full @3xl:grid @3xl:grid-cols-subgrid";

async function countOf(o: Parameters<typeof raw.conclusions.list>[0], workspaceId: string, filters: Record<string, unknown>) {
  const page = await raw.conclusions.list(o, workspaceId, { page: 1, size: 1, filters });
  return page.total;
}

type MessageSearch = { query: string; items: ApiMessage[] | null; loading: boolean; error?: unknown };

/**
 * Conclusions about one peer, read through Honcho's list endpoint so it works
 * without the operator database. Leads with the synthesized levels, separates
 * the peer's own view from other peers' views, and folds repeated text.
 */
export function PeerConclusions({ workspaceId, peerId }: { workspaceId: string; peerId: string }) {
  const apiOpts = useActiveHonchoOptions();
  const { provenance } = useHonchoCapabilities();
  const base = `peer-memory/${workspaceId}/${peerId}`;
  const searchId = useId();
  const tabsId = useId();

  const [chosenLevel, setChosenLevel] = useState<LevelTab | null>(null);
  const [perspective, setPerspective] = useState<Perspective>("all");
  const [draft, setDraft] = useState("");
  const [text, setText] = useState("");
  const [inspected, setInspected] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<MessageSearch | null>(null);

  // Tab counts follow the viewpoint and text filter; viewpoint counts follow the tab.
  const levelCounts = useHonchoQuery(`${base}/levels/${perspective}/${text}`, async (o) => {
    const keys: LevelTab[] = ["all", ...CONCLUSION_LEVELS];
    const totals = await Promise.all(keys.map((level) => countOf(o, workspaceId, conclusionFilters(peerId, { level, perspective, text }))));
    return Object.fromEntries(keys.map((key, i) => [key, totals[i]])) as Record<LevelTab, number>;
  });
  const level: LevelTab = chosenLevel ?? (levelCounts.data ? defaultLevel(levelCounts.data) : "all");
  const viewCounts = useHonchoQuery(levelCounts.data ? `${base}/views/${level}/${text}` : null, async (o) => {
    const views: Perspective[] = ["all", "own", "others"];
    const totals = await Promise.all(views.map((p) => countOf(o, workspaceId, conclusionFilters(peerId, { level, perspective: p, text }))));
    return { all: totals[0], own: totals[1], others: totals[2] };
  });
  const overall = useHonchoQuery(`${base}/overall`, async (o) => {
    const since = new Date(Date.now() - 30 * DAY_MS).toISOString();
    const [total, recent] = await Promise.all([
      countOf(o, workspaceId, { observed_id: peerId }),
      countOf(o, workspaceId, conclusionFilters(peerId, { level: "all", perspective: "all", since })),
    ]);
    return { total, recent };
  });

  // The list itself: newest first, ten at a time, appended on LOAD_MORE.
  const [list, setList] = useState<{ key: string; items: ApiConclusion[]; total: number; page: number; loading: boolean; error?: unknown }>({
    key: "", items: [], total: 0, page: 0, loading: false,
  });
  const listKey = levelCounts.data ? `${base}/${level}/${perspective}/${text}` : null;
  const loadPage = async (key: string, page: number) => {
    if (!apiOpts) return;
    setList((s) => (s.key === key ? { ...s, loading: true, error: undefined } : { key, items: [], total: 0, page: 0, loading: true }));
    try {
      const result = await raw.conclusions.list(apiOpts, workspaceId, {
        page,
        size: PAGE,
        filters: conclusionFilters(peerId, { level, perspective, text }),
      });
      setList((s) => (s.key !== key ? s : {
        key,
        items: page === 1 ? result.items : appendPage(s.items, result.items),
        total: result.total,
        page,
        loading: false,
      }));
    } catch (error) {
      setList((s) => (s.key !== key ? s : { ...s, loading: false, error }));
    }
  };
  const loadRef = useRef(loadPage);
  loadRef.current = loadPage;
  useEffect(() => {
    if (listKey) void loadRef.current(listKey, 1);
  }, [listKey]);

  const rows = useMemo(() => foldDuplicates(list.key === listKey ? list.items : []), [list, listKey]);

  const searchMessages = async () => {
    const q = draft.trim();
    if (!q || !apiOpts) return;
    setMessages({ query: q, items: null, loading: true });
    try {
      const items = await raw.peers.search(apiOpts, workspaceId, peerId, { query: q, limit: 20 });
      setMessages({ query: q, items, loading: false });
    } catch (error) {
      setMessages({ query: q, items: [], loading: false, error });
    }
  };
  const clearText = () => {
    setDraft("");
    setText("");
  };

  const now = useNow(60_000);
  const listTotal = useListTotal();
  const counts = levelCounts.data;
  const views = viewCounts.data;
  const shown = list.key === listKey ? list.items.length : 0;
  const withLevel = level === "all";
  const cols = withLevel ? TABLE_COLS.withLevel : TABLE_COLS.plain;
  const viewLabel = (label: string, n: number | undefined) => (n === undefined ? label : `${label} · ${listTotal.format(n)}`);
  const emptyLabel = text
    ? <>No {LEVEL_META[level].noun}conclusions about {peerId} contain &ldquo;{text}&rdquo;.</>
    : <>No {LEVEL_META[level].noun}conclusions about {peerId} {perspective === "own" ? "held by itself" : perspective === "others" ? "held by other peers" : ""} yet.</>;

  return (
    <section aria-label={`Conclusions about ${peerId}`} className="@container min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-3">
        <Icon name="sparkles" size={11} className="text-accent self-center" />
        <h3 className="text-[10px] text-accent uppercase tracking-wider font-normal">conclusions</h3>
        <span className="text-[10px] text-text-muted tabular-nums">
          {overall.error ? "counts unavailable" : overall.data
            ? `${listTotal.format(overall.data.total)} about ${peerId} · ${overall.data.recent.toLocaleString()} new in the last 30 days`
            : "counting…"}
        </span>
      </div>

      {messages ? (
        <MessageResults peerId={peerId} state={messages} onBack={() => setMessages(null)} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-border">
            <Tabs<LevelTab>
              ariaLabel="Conclusion level"
              layoutId={`levels-${tabsId}`}
              className="border-0 -ml-4 max-w-full"
              current={level}
              onChange={setChosenLevel}
              items={(["all", ...CONCLUSION_LEVELS] as LevelTab[]).map((key) => ({
                key,
                label: LEVEL_META[key].label,
                icon: LEVEL_META[key].icon,
                count: counts ? counts[key] : null,
              }))}
            />
            <div role="group" aria-label="Held by" className="flex items-center gap-2 pb-1.5 text-[10px] uppercase tracking-wider text-text-muted">
              <span aria-hidden>held by</span>
              <Select<Perspective>
                value={perspective}
                onChange={setPerspective}
                className="min-w-[200px] normal-case tracking-normal"
                triggerClassName="py-1"
                options={[
                  { value: "all", label: viewLabel("anyone", views?.all) },
                  { value: "own", label: viewLabel(`${peerId} itself`, views?.own) },
                  { value: "others", label: viewLabel("other peers", views?.others) },
                ]}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 my-3">
            <label htmlFor={searchId} className="sr-only">Filter conclusions by text</label>
            <div className="relative flex-1 min-w-[220px]">
              <Icon name="search" size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <TextInput
                id={searchId}
                className="pl-7"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setText(draft.trim());
                  if (e.key === "Escape") clearText();
                }}
                placeholder="filter conclusions by text…"
              />
            </div>
            {text ? <Button variant="ghost" size="sm" onClick={clearText}>CLEAR</Button> : null}
            <Button
              variant="outline"
              size="sm"
              icon="message-square"
              onClick={() => void searchMessages()}
              disabled={!draft.trim()}
              title={`Search ${peerId}'s messages by meaning instead`}
            >
              SEARCH_MESSAGES
            </Button>
          </div>

          {levelCounts.error || list.error ? (
            <p role="alert" className="text-[11px] text-red-400 break-words py-2">{formatApiError(levelCounts.error ?? list.error)}</p>
          ) : !counts || (list.loading && shown === 0) ? (
            <div aria-label="Loading conclusions">
              {[0, 1, 2].map((i) => (
                <div key={i} className="py-2.5 border-b border-border space-y-1.5">
                  <div className="h-3 bg-border/60 animate-pulse w-3/5" />
                  <div className="h-3 bg-border/40 animate-pulse w-2/5" />
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="text-[11px] text-text-muted py-3">{emptyLabel}</p>
          ) : (
            <>
            <div className={cn("@3xl:grid @3xl:gap-x-6", cols)}>
              <div aria-hidden className={cn("hidden pb-1.5 border-b border-border text-[10px] uppercase tracking-wider text-text-muted", SUBGRID_ROW)}>
                <span>conclusion</span>
                {withLevel ? <span>level</span> : null}
                <span>held_by</span>
                <span>built_from</span>
                <span className="text-right">age</span>
              </div>
              <ul className={SUBGRID_ROW}>
                {rows.map(({ item, alsoHeldBy }) => {
                  const meta = levelMeta(item.level);
                  const long = item.content.length > LONG_TEXT;
                  const expanded = open.has(item.id);
                  const sources = item.source_ids?.length ?? 0;
                  // Honcho 3.5+: explicit conclusions cite messages instead of conclusions.
                  const cited = item.source_message_ids?.length ?? 0;
                  const derived = item.times_derived ?? 1;
                  const self = item.observer_id === peerId;
                  return (
                    <li key={item.id} className={cn("grid grid-cols-1 gap-y-1 py-2.5 border-b border-border text-xs leading-5", SUBGRID_ROW)}>
                      <div className="min-w-0">
                        <div className={cn("text-text-primary max-w-[140ch]", long && !expanded && "line-clamp-3")}>
                          <Markdown inline text={item.content} />
                        </div>
                        {long ? (
                          <button
                            type="button"
                            aria-expanded={expanded}
                            onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(item.id)) n.delete(item.id); else n.add(item.id); return n; })}
                            className="mt-0.5 text-[10px] uppercase tracking-wider text-text-muted hover:text-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                          >
                            {expanded ? "SHOW_LESS" : "SHOW_MORE"}
                          </button>
                        ) : null}
                      </div>
                      {/* One wrapped line of details when narrow; separate columns when wide. */}
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[10px] text-text-muted @3xl:contents @3xl:text-[11px]">
                        {withLevel ? (
                          <span className={cn("inline-flex items-center gap-1 uppercase tracking-wider text-[10px] self-start @3xl:pt-px", meta.tone)}>
                            {meta.icon ? <Icon name={meta.icon} size={10} /> : null}
                            {item.level ?? "unknown"}
                          </span>
                        ) : null}
                        <span className="min-w-0 truncate" title={alsoHeldBy.length ? `Same text also held by ${alsoHeldBy.join(", ")}` : undefined}>
                          <span className="@3xl:hidden">held by </span>
                          {self ? <span>itself</span> : <span className="font-mono text-text-primary">{item.observer_id}</span>}
                          {alsoHeldBy.length ? (
                            <span> +{alsoHeldBy.length}<span className="sr-only"> others with the same text: {alsoHeldBy.join(", ")}</span></span>
                          ) : null}
                        </span>
                        <span className="whitespace-nowrap">
                          {sources > 0 ? (
                            <>
                              <span className="@3xl:hidden">from </span>
                              <span className="text-text-primary tabular-nums">{sources}</span>
                              <span className="@3xl:hidden"> conclusion{sources === 1 ? "" : "s"}</span>
                              {provenance === "available" ? (
                                <button
                                  type="button"
                                  onClick={() => setInspected(item.id)}
                                  aria-label={`Why: open the ${sources} conclusion${sources === 1 ? "" : "s"} this was built from`}
                                  className="ml-2 uppercase tracking-wider text-accent hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                                >
                                  WHY →
                                </button>
                              ) : null}
                            </>
                          ) : cited > 0 ? (
                            <>
                              {/* The column counts conclusions, so name the unit for messages. */}
                              <span className="@3xl:hidden">from </span>
                              <span className="text-text-primary tabular-nums">{cited}</span>
                              <span> message{cited === 1 ? "" : "s"}</span>
                              {provenance === "available" ? (
                                <button
                                  type="button"
                                  onClick={() => setInspected(item.id)}
                                  aria-label={`Why: open the ${cited} message${cited === 1 ? "" : "s"} this was taken from`}
                                  className="ml-2 uppercase tracking-wider text-accent hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                                >
                                  WHY →
                                </button>
                              ) : null}
                            </>
                          ) : (
                            <span className="hidden @3xl:inline" aria-label="no source conclusions">—</span>
                          )}
                          {derived > 1 ? <span className="ml-2" title={`Derived ${derived} times`}>×{derived}</span> : null}
                        </span>
                        <time dateTime={item.created_at} title={new Date(item.created_at).toLocaleString()} className="whitespace-nowrap tabular-nums @3xl:text-right">
                          {shortAge(item.created_at, now)}
                        </time>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
              <div className="flex items-center justify-between gap-3 pt-2.5 text-[10px] text-text-muted">
                <span className="tabular-nums">newest first · {shown.toLocaleString()} of {listTotal.format(list.total)}</span>
                {shown < list.total ? (
                  <Button variant="ghost" size="sm" onClick={() => listKey && void loadPage(listKey, list.page + 1)} disabled={list.loading}>
                    {list.loading ? "LOADING…" : "LOAD_MORE"}
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </>
      )}

      {inspected ? <ConclusionInspector key={inspected} id={inspected} workspaceId={workspaceId} onClose={() => setInspected(null)} /> : null}
    </section>
  );
}

function MessageResults({ peerId, state, onBack }: { peerId: string; state: MessageSearch; onBack: () => void }) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-border">
        <p className="text-[11px] text-text-muted">
          Messages from <span className="font-mono text-text-primary">{peerId}</span> closest in meaning to &ldquo;<span className="text-text-primary">{state.query}</span>&rdquo;
          {state.items ? <> · {state.items.length}</> : null}
        </p>
        <Button variant="ghost" size="sm" icon="x" onClick={onBack}>BACK_TO_CONCLUSIONS</Button>
      </div>
      {state.loading ? (
        <div className="space-y-1.5 pt-2" aria-label="Searching messages">
          {[0, 1, 2].map((i) => <div key={i} className="h-8 bg-border/40 animate-pulse" />)}
        </div>
      ) : state.error ? (
        <p role="alert" className="text-[11px] text-red-400 break-words py-2">{formatApiError(state.error)}</p>
      ) : !state.items?.length ? (
        <p className="text-[11px] text-text-muted py-3">No messages from {peerId} match &ldquo;{state.query}&rdquo;.</p>
      ) : (
        <ul>
          {state.items.map((m) => (
            <li key={m.id} className="py-2 border-b border-border">
              <div className="flex items-center gap-3 text-[10px] text-text-muted mb-0.5">
                <span className="text-text-primary font-mono">{m.session_id}</span>
                <time dateTime={m.created_at}>{new Date(m.created_at).toLocaleString()}</time>
              </div>
              <div className="text-xs leading-5 text-text-primary line-clamp-2 max-w-[100ch]">
                <Markdown inline text={m.content} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
