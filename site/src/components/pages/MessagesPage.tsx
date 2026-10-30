"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { PageHeader } from "@/components/PageHeader";
import { StatusBar } from "@/components/StatusBar";
import { Button, RefreshButton, TextInput } from "@/components/atoms";
import { Icon } from "@/components/icons";
import { MessageLine, MessageLineHeader, type PeerKind } from "@/components/MessageLine";
import { Select } from "@/components/Select";
import { honcho as raw } from "@/lib/honcho/client";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { getSdk } from "@/lib/honcho/sdk";
import { toApiPeer, toApiSession } from "@/lib/honcho/adapters";
import { formatApiError, useHonchoQuery } from "@/lib/honcho/useQuery";
import type { ApiPeer, ApiSession } from "@/lib/honcho/types";
import { collapsedScope, useCollapsedSessions } from "@/lib/collapsedSessions";
import {
  LIVE_INTERVAL_MS,
  STREAM_PAGE,
  groupRuns,
  matchesText,
  mergeNewer,
  middleTruncate,
  peerColumnWidth,
  readStreamHash,
  streamHash,
  streamRows,
  streamUrl,
  summarize,
  type SessionGroup,
  type StreamFilters,
  type StreamMessage,
} from "@/lib/messageStream";
import { appendOlder, shortStamp } from "@/lib/sessionTranscript";
import { useTextHighlight } from "@/lib/textHighlight";
import { cn } from "@/lib/utils";

/** A peer's type from `observe_me`; null when unset. Never guessed from the name. */
function peerKindOf(cfg: Record<string, unknown> | undefined): PeerKind {
  const c = cfg ?? {};
  const observeMe = (c as { observe_me?: boolean }).observe_me ?? (c as { observeMe?: boolean }).observeMe;
  return observeMe === true ? "user" : observeMe === false ? "agent" : null;
}

// One session: the Sessions transcript's columns, peer | message | tokens | time.
// The peer column width comes from --peer-col, set from the names shown.
const LINE_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[var(--peer-col,11rem)_minmax(0,1fr)_3.5rem_6.5rem] gap-x-3 gap-y-0.5";
// Grouped by session: peer | message | time. The group header carries the token
// total and an opened line names its own tokens.
const GROUP_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[var(--peer-col,11rem)_minmax(0,1fr)_6.5rem] gap-x-3 gap-y-0.5";
const NO_IDS: ReadonlySet<string> = new Set();
/** The reader counts as at the top when scrolled less than this. */
const TOP_SLACK_PX = 48;

function subscribeHash(notify: () => void) {
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
}

interface DbPage {
  available: boolean;
  reason?: string;
  messages?: StreamMessage[];
  hasMore?: boolean;
}

interface StreamState {
  key: string;
  status: "loading" | "ready" | "error" | "needs-db";
  newestFirst: StreamMessage[];
  hasMore: boolean;
  source: "db" | "api";
  /** Next API page number (API source only). */
  nextPage: number | null;
  error?: string;
  reason?: string;
}

const EMPTY: StreamState = { key: "", status: "loading", newestFirst: [], hasMore: false, source: "db", nextPage: null };

async function fetchDbPage(filters: StreamFilters, cursor?: Parameters<typeof streamUrl>[1]): Promise<DbPage> {
  const res = await fetch(streamUrl(filters, cursor), { cache: "no-store" });
  const body = (await res.json().catch(() => null)) as DbPage | { detail?: string } | null;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(body as { detail?: string } | null)?.detail ?? res.statusText}`);
  return body as DbPage;
}

/**
 * Messages, kept newest first, a page at a time, plus live follow. The operator
 * database covers the whole workspace and searches text on the server; without
 * it, one session reads through the Honcho API (a raw list, never the SDK's
 * get-or-create).
 */
function useMessageStream(filters: StreamFilters | null, refreshKey: number) {
  const apiOpts = useActiveHonchoOptions();
  const [state, setState] = useState<StreamState>(EMPTY);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<{ key: string; message: string } | null>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  const key = filters ? `${filters.workspaceId}|${filters.sessionId}|${filters.peerId}|${filters.q}|${refreshKey}` : "";

  const apiPage = async (f: StreamFilters, page: number) => {
    if (!apiOpts || !f.sessionId) throw new Error("No Honcho instance is configured.");
    return raw.sessions.messages(apiOpts, f.workspaceId, f.sessionId, {
      page,
      size: STREAM_PAGE,
      reverse: true,
      filters: f.peerId ? { peer_id: f.peerId } : undefined,
    });
  };

  useEffect(() => {
    if (!filters || !apiOpts) return;
    let cancelled = false;
    const f = filters;
    queueMicrotask(() => {
      if (cancelled) return;
      setState({ ...EMPTY, key });
      setMoreError(null);
    });
    (async () => {
      try {
        const db = await fetchDbPage(f);
        if (cancelled) return;
        if (db.available) {
          setState({ key, status: "ready", source: "db", newestFirst: db.messages ?? [], hasMore: !!db.hasMore, nextPage: null });
          return;
        }
        if (!f.sessionId) {
          setState({ ...EMPTY, key, status: "needs-db", reason: db.reason });
          return;
        }
        const page = await apiPage(f, 1);
        if (cancelled) return;
        setState({
          key,
          status: "ready",
          source: "api",
          newestFirst: page.items,
          hasMore: page.page < page.pages,
          nextPage: page.page < page.pages ? page.page + 1 : null,
          reason: db.reason,
        });
      } catch (err) {
        if (!cancelled) setState({ ...EMPTY, key, status: "error", error: formatApiError(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `filters` is summarised by `key`; apiPage only reads apiOpts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, apiOpts]);

  const loadMore = async () => {
    if (!filters || loadingMore || state.key !== key || !state.hasMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      if (state.source === "db") {
        const oldest = state.newestFirst.at(-1);
        const db = await fetchDbPage(filters, oldest ? { before: oldest } : undefined);
        if (!db.available) throw new Error(db.reason ?? "The operator database is unavailable.");
        setState((s) => (s.key !== key ? s : { ...s, newestFirst: appendOlder(s.newestFirst, db.messages ?? []), hasMore: !!db.hasMore }));
      } else if (state.nextPage !== null) {
        const page = await apiPage(filters, state.nextPage);
        const more = page.page < page.pages && page.items.length > 0;
        setState((s) => (s.key !== key ? s : {
          ...s,
          newestFirst: appendOlder(s.newestFirst, page.items),
          hasMore: more,
          nextPage: more ? page.page + 1 : null,
        }));
      }
    } catch (err) {
      setMoreError(formatApiError(err));
    } finally {
      setLoadingMore(false);
    }
  };

  // Live follow: while the view is ready and the tab is visible, check for
  // messages newer than the latest one shown. Reads only.
  const ready = state.key === key && state.status === "ready";
  const source = state.source;
  useEffect(() => {
    if (!filters || !ready) return;
    const f = filters;
    let cancelled = false;
    let busy = false;
    const tick = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const newest = stateRef.current.key === key ? stateRef.current.newestFirst[0] : undefined;
        if (source === "db") {
          const db = await fetchDbPage(f, newest ? { after: newest } : undefined);
          if (cancelled) return;
          if (!db.available) throw new Error(db.reason ?? "The operator database is unavailable.");
          // More new messages than one check returns: merging would leave a gap,
          // so start again from the latest page.
          const latest = newest && db.hasMore ? await fetchDbPage(f) : null;
          if (cancelled) return;
          setState((cur) => {
            if (cur.key !== key) return cur;
            if (latest) return { ...cur, newestFirst: latest.messages ?? [], hasMore: !!latest.hasMore };
            const { list } = mergeNewer(cur.newestFirst, db.messages ?? []);
            return list === cur.newestFirst ? cur : { ...cur, newestFirst: list };
          });
        } else {
          const page = await apiPage(f, 1);
          if (cancelled) return;
          setState((cur) => {
            if (cur.key !== key) return cur;
            const known = new Set(cur.newestFirst.map((m) => m.id));
            // No overlap with what is shown means a gap: restart from this page.
            if (cur.newestFirst.length && page.items.length && !page.items.some((m) => known.has(m.id))) {
              const more = page.page < page.pages;
              return { ...cur, newestFirst: page.items, hasMore: more, nextPage: more ? page.page + 1 : null };
            }
            const { list } = mergeNewer(cur.newestFirst, page.items);
            return list === cur.newestFirst ? cur : { ...cur, newestFirst: list };
          });
        }
        setLiveError(null);
      } catch (err) {
        if (!cancelled) setLiveError({ key, message: formatApiError(err) });
      } finally {
        busy = false;
      }
    };
    const timer = window.setInterval(() => void tick(), LIVE_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // `filters` is summarised by `key`; apiPage only reads apiOpts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, source, apiOpts]);

  const current = state.key === key ? state : { ...EMPTY, key };
  return { ...current, loadingMore, moreError, loadMore, liveError: liveError?.key === key ? liveError.message : null };
}

export function MessagesPage() {
  const { workspaceId } = useActiveWorkspace();
  const apiOpts = useActiveHonchoOptions();
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const { sessionId, peerId, q } = readStreamHash(hash);
  const [refreshKey, setRefreshKey] = useState(0);
  const setFilters = (next: Partial<{ sessionId: string | null; peerId: string | null; q: string }>) => {
    window.location.hash = streamHash({ sessionId, peerId, q, ...next });
  };

  // Sessions and peers for the pickers, plus each peer's configured type.
  const meta = useHonchoQuery<{ sessions: ApiSession[]; peers: ApiPeer[] }>(
    workspaceId ? `sdk/messages-meta/${workspaceId}` : null,
    async (o) => {
      const [sessions, peers] = await Promise.all([
        getSdk(o, workspaceId!)
          .sessions({ size: 100, reverse: true })
          .then((p) => p.items.map((s) => toApiSession(s)))
          .catch(() => [] as ApiSession[]),
        getSdk(o, workspaceId!)
          .peers({ size: 100 })
          .then((p) => p.items.map((peer) => toApiPeer(peer)))
          .catch(() => [] as ApiPeer[]),
      ]);
      return { sessions, peers };
    },
  );

  const filters = useMemo<StreamFilters | null>(
    () => (workspaceId ? { workspaceId, sessionId, peerId, q } : null),
    [workspaceId, sessionId, peerId, q],
  );
  const stream = useMessageStream(filters, refreshKey);

  const kindOf = useMemo(() => {
    const kinds = new Map((meta.data?.peers ?? []).map((p) => [p.id, peerKindOf(p.configuration)] as const));
    return (id: string): PeerKind => kinds.get(id) ?? null;
  }, [meta.data?.peers]);

  // Without the database, the text filter can only look at loaded messages.
  const localFilter = stream.source === "api" && !!q;
  const visible = useMemo(
    () => (localFilter ? stream.newestFirst.filter((m) => matchesText(m.content, q)) : stream.newestFirst),
    [localFilter, stream.newestFirst, q],
  );
  const oneSession = !!sessionId;
  // Newest first: the latest message is the top line.
  const lines = visible;
  // One session is a single list; across sessions, consecutive messages from a
  // session form a group, and a session can be collapsed.
  const rows = useMemo(() => (oneSession ? streamRows(lines, false) : []), [lines, oneSession]);
  const groups = useMemo(() => (oneSession ? [] : groupRuns(lines)), [lines, oneSession]);
  const { collapsed, toggle, expand } = useCollapsedSessions(apiOpts && workspaceId ? collapsedScope(apiOpts.baseUrl, workspaceId) : null);
  const collapsedInView = useMemo(
    () => [...new Set(groups.map((g) => g.sessionId))].filter((id) => collapsed.has(id)),
    [groups, collapsed],
  );
  // Which lines are open, kept here because LOAD_MORE can regroup (and so
  // remount) the bottom group. Cleared when the view changes.
  const [openLines, setOpenLines] = useState<{ key: string; ids: ReadonlySet<string> }>({ key: "", ids: NO_IDS });
  const openIds = openLines.key === stream.key ? openLines.ids : NO_IDS;
  const setLineOpen = (id: string, open: boolean) =>
    setOpenLines((cur) => {
      const ids = new Set(cur.key === stream.key ? cur.ids : NO_IDS);
      if (open) ids.add(id);
      else ids.delete(id);
      return { key: stream.key, ids };
    });
  const totals = summarize(visible);
  const peerCol = useMemo(() => ({ "--peer-col": peerColumnWidth(visible.map((m) => m.peer_id)) }) as CSSProperties, [visible]);

  // The stream opens at the top, on the latest message. New messages arrive
  // above: a reader at the top sees them, a reader further down stays on the
  // same line while a button counts them. LOAD_MORE adds older ones below,
  // which never moves the reader.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const openedFor = useRef<string | null>(null);
  const topLine = useRef<{ id: string; offset: number } | null>(null);
  const [seen, setSeen] = useState<{ key: string; id: string | null }>({ key: "", id: null });
  const markSeen = (key: string, id: string | null) => setSeen((s) => (s.key === key && s.id === id ? s : { key, id }));
  // A line's distance from the top of the scrolled content, or null when not rendered.
  const contentOffset = (box: HTMLElement, id: string) => {
    const node = box.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
    return node ? node.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop : null;
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || stream.status !== "ready") return;
    const key = stream.key;
    const first = lines[0]?.id ?? null;
    const prev = topLine.current;
    if (openedFor.current !== key) {
      el.scrollTop = 0;
      openedFor.current = key;
      queueMicrotask(() => markSeen(key, first));
    } else if (prev && first && first !== prev.id) {
      if (el.scrollTop <= TOP_SLACK_PX) {
        // The reader was at the top: show the new messages.
        el.scrollTop = 0;
        queueMicrotask(() => markSeen(key, first));
      } else {
        // New lines pushed the content down: move with it so the reader's line stays put.
        const now = contentOffset(el, prev.id);
        if (now !== null) el.scrollTop += now - prev.offset;
      }
    }
    topLine.current = first ? { id: first, offset: contentOffset(el, first) ?? 0 } : null;
  }, [lines, stream.status, stream.key]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (el && el.scrollTop <= TOP_SLACK_PX) markSeen(stream.key, lines[0]?.id ?? null);
  };
  const seenId = seen.key === stream.key ? seen.id : null;
  // Lines above the newest one the reader saw at the top are new to them.
  const unseen = seenId ? Math.max(0, lines.findIndex((m) => m.id === seenId)) : 0;
  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  const listRef = useRef<HTMLDivElement | null>(null);
  useTextHighlight(listRef, q ? [q] : "", `${lines.length}:${lines[0]?.id}:${lines.at(-1)?.id}`);

  const sessionOptions = useMemo(() => {
    const ids = (meta.data?.sessions ?? []).map((s) => s.id);
    if (sessionId && !ids.includes(sessionId)) ids.unshift(sessionId);
    return [{ value: "", label: "all sessions" }, ...ids.map((id) => ({ value: id, label: id }))];
  }, [meta.data?.sessions, sessionId]);
  const peerOptions = useMemo(() => {
    const ids = (meta.data?.peers ?? []).map((p) => p.id);
    if (peerId && !ids.includes(peerId)) ids.unshift(peerId);
    return [{ value: "", label: "all peers" }, ...ids.map((id) => ({ value: id, label: id }))];
  }, [meta.data?.peers, peerId]);

  const filtered = !!(peerId || q);
  const readSession = (id: string) => setFilters({ sessionId: id, peerId: null, q: "" });

  return (
    <div className="space-y-3">
      <PageHeader
        title="MESSAGES"
        subtitle="read what peers write as it happens, across a workspace or in one session"
        actions={<RefreshButton label="REFRESH" onClick={() => setRefreshKey((k) => k + 1)} />}
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="relative flex-1 min-w-[240px]">
          <label htmlFor="messages-search" className="sr-only">Search message text</label>
          <Icon name="search" size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <TextInput
            id="messages-search"
            key={q}
            defaultValue={q}
            className="pl-7"
            placeholder="search message text, then press Enter…"
            onKeyDown={(e) => {
              if (e.key === "Enter") setFilters({ q: e.currentTarget.value.trim() });
              if (e.key === "Escape") setFilters({ q: "" });
            }}
          />
        </div>
        <div role="group" aria-label="Session" className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-text-muted">
          <span aria-hidden>session</span>
          <Select
            value={sessionId ?? ""}
            onChange={(id) => setFilters({ sessionId: id || null })}
            options={sessionOptions}
            className="w-[min(22rem,70vw)] normal-case tracking-normal"
            triggerClassName="py-1.5"
          />
        </div>
        <div role="group" aria-label="Peer" className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-text-muted">
          <span aria-hidden>peer</span>
          <Select
            value={peerId ?? ""}
            onChange={(id) => setFilters({ peerId: id || null })}
            options={peerOptions}
            className="w-[min(14rem,60vw)] normal-case tracking-normal"
            triggerClassName="py-1.5"
          />
        </div>
        {filtered ? (
          <Button variant="ghost" size="sm" icon="x" onClick={() => setFilters({ peerId: null, q: "" })}>
            CLEAR_FILTERS
          </Button>
        ) : null}
      </div>

      <section aria-label={oneSession ? `Messages in session ${sessionId}` : "Messages across all sessions"}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 mb-2">
          <p className="flex flex-wrap items-baseline gap-x-2 text-[10px] text-text-muted min-w-0">
            <Icon name={oneSession ? "git-branch" : "message-square"} size={11} className="text-accent self-center" />
            {oneSession ? (
              <>
                <span className="uppercase tracking-wider text-accent">session</span>
                <span className="font-mono text-text-primary break-all">{sessionId}</span>
                <button
                  type="button"
                  onClick={() => setFilters({ sessionId: null })}
                  className="uppercase tracking-wider hover:text-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                >
                  ← ALL_SESSIONS
                </button>
              </>
            ) : (
              <span className="uppercase tracking-wider text-accent">all sessions</span>
            )}
            <span>
              {oneSession ? "· latest first · select a line to open it" : "· grouped by session, latest first · select a session to collapse it, a line to open it"}
            </span>
            {collapsedInView.length ? (
              <button
                type="button"
                onClick={() => expand(collapsedInView)}
                className="uppercase tracking-wider hover:text-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
              >
                · EXPAND_ALL ({collapsedInView.length} collapsed)
              </button>
            ) : null}
          </p>
          {stream.status === "ready" ? (
            <p className="text-[10px] text-text-muted tabular-nums" role="status">
              {visible.length ? (
                <>
                  {totals.count.toLocaleString()} loaded{stream.hasMore ? " · more available" : ""} · {totals.tokens.toLocaleString()} tokens · {totals.peers} peer{totals.peers === 1 ? "" : "s"}
                  {oneSession ? "" : ` · ${totals.sessions} session${totals.sessions === 1 ? "" : "s"}`} ·{" "}
                </>
              ) : null}
              {stream.liveError ? (
                <span className="text-red-400 break-words">live updates failed, retrying: {stream.liveError}</span>
              ) : (
                <span>live, checks every {LIVE_INTERVAL_MS / 1000} s</span>
              )}
            </p>
          ) : null}
        </div>
        {stream.source === "api" && stream.status === "ready" ? (
          <p className="text-[10px] text-text-muted mb-2">
            Read through the Honcho API because the operator database is unavailable{stream.reason ? ` (${stream.reason})` : ""}.
            {localFilter ? " The text search only covers the messages loaded so far." : ""}
          </p>
        ) : null}

        {!workspaceId ? (
          <p className="text-[11px] text-text-muted py-6">Select a workspace in the sidebar.</p>
        ) : stream.status === "needs-db" ? (
          <p className="text-[11px] text-text-muted py-6 max-w-[80ch]">
            Reading across sessions needs the operator database{stream.reason ? ` (${stream.reason})` : ""}. Pick a session above to read
            its messages through the Honcho API.
          </p>
        ) : stream.status === "error" ? (
          <p role="alert" className="text-[11px] text-red-400 break-words py-2">
            Could not load messages: {stream.error}. Check the instance in{" "}
            <a href="#/config" className="underline underline-offset-2 hover:text-text-primary">CONFIG</a>.
          </p>
        ) : stream.status === "loading" ? (
          <div className="border border-border bg-surface" aria-label="Loading messages">
            {[72, 54, 80, 46, 64, 58].map((w) => (
              <div key={w} className="flex items-center gap-3 px-3 py-2 border-b border-border last:border-b-0">
                <div className="h-2.5 w-24 bg-border/60 animate-pulse" />
                <div className="h-2.5 bg-border/40 animate-pulse" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
        ) : lines.length === 0 ? (
          <div className="py-6 text-[11px] text-text-muted flex flex-wrap items-center gap-3">
            {filtered ? (
              <>
                <span>
                  No messages{peerId ? <> from <span className="font-mono text-text-primary">{peerId}</span></> : null}
                  {q ? <> containing &ldquo;<span className="text-text-primary">{q}</span>&rdquo;</> : null}
                  {oneSession ? " in this session" : ""} yet. New ones appear here as they arrive.
                </span>
                <Button variant="ghost" size="sm" icon="x" onClick={() => setFilters({ peerId: null, q: "" })}>CLEAR_FILTERS</Button>
              </>
            ) : (
              <span>
                {oneSession ? "No messages in this session yet." : "No messages in this workspace yet."} New ones appear here as peers
                write them.
              </span>
            )}
          </div>
        ) : (
          <div ref={listRef} className={oneSession ? "border border-border bg-surface" : undefined} style={peerCol}>
            <div
              ref={scrollRef}
              onScroll={onScroll}
              data-testid="message-stream"
              data-transcript-scroll=""
              // The page keeps the reader's place itself when new messages
              // arrive above; browser scroll anchoring would fight it.
              className="max-h-[calc(100dvh-16rem)] overflow-y-auto overscroll-contain [overflow-anchor:none]"
            >
              {oneSession ? <MessageLineHeader grid={LINE_GRID} /> : null}
              {unseen > 0 ? (
                // Zero height, so it floats over the lines (below the column header) without moving them.
                <div className={cn("sticky z-20 h-0 flex items-start justify-center pointer-events-none", oneSession ? "top-1 sm:top-7" : "top-1")}>
                  {/* Opaque, since it floats over the lines. */}
                  <Button size="sm" variant="primary" icon="chevron-up" className="mt-1 pointer-events-auto bg-surface" onClick={jumpToLatest}>
                    {unseen} NEW
                  </Button>
                </div>
              ) : null}
              {oneSession ? (
                <ol aria-label="Messages, newest first">
                  {rows.map(({ message: m, repeatPeer }) => (
                    <MessageLine
                      key={m.id}
                      message={m}
                      kind={kindOf(m.peer_id)}
                      grid={LINE_GRID}
                      repeatPeer={repeatPeer}
                      searchText={q}
                      open={openIds.has(m.id)}
                      onOpenChange={(open) => setLineOpen(m.id, open)}
                    />
                  ))}
                </ol>
              ) : (
                <div className="space-y-2">
                  {groups.map((group) => (
                    <SessionGroupBlock
                      key={group.key}
                      group={group}
                      collapsed={collapsed.has(group.sessionId)}
                      onToggle={() => toggle(group.sessionId)}
                      onRead={readSession}
                      kindOf={kindOf}
                      searchText={q}
                      openIds={openIds}
                      onLineOpen={setLineOpen}
                    />
                  ))}
                </div>
              )}
              {stream.hasMore ? (
                <div className={cn("flex flex-wrap items-center gap-2 py-1.5", oneSession ? "px-3 border-t border-border" : "mt-1")}>
                  <Button size="sm" variant="ghost" icon="chevron-down" onClick={() => void stream.loadMore()} disabled={stream.loadingMore}>
                    {stream.loadingMore ? "LOADING…" : "LOAD_MORE"}
                  </Button>
                  {stream.moreError ? <span role="alert" className="text-[10px] text-red-400 break-words">{stream.moreError}</span> : null}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </section>

      <StatusBar />
    </div>
  );
}

/**
 * One run of consecutive messages from a session, newest first, under a header
 * naming the session, when the run happened, its size and its peers. Selecting
 * the header collapses the session: every group of it on the page closes
 * together, and the headers stay so the reader can still see when it was active.
 */
function SessionGroupBlock({
  group,
  collapsed,
  onToggle,
  onRead,
  kindOf,
  searchText,
  openIds,
  onLineOpen,
}: {
  group: SessionGroup;
  collapsed: boolean;
  onToggle: () => void;
  onRead: (sessionId: string) => void;
  kindOf: (peerId: string) => PeerKind;
  searchText: string;
  openIds: ReadonlySet<string>;
  onLineOpen: (id: string, open: boolean) => void;
}) {
  const rowsId = useId();
  const rows = streamRows(group.messages, false);
  const count = group.messages.length;
  const from = shortStamp(group.messages[count - 1].created_at);
  const to = shortStamp(group.messages[0].created_at);
  return (
    <section data-session-group={group.sessionId} aria-label={`Session ${group.sessionId}`} className="border border-border bg-surface">
      <div
        className={cn(
          "flex items-center gap-x-3 pr-3 border-b transition-colors duration-200 hover:bg-border/20",
          collapsed ? "border-transparent" : "border-border",
        )}
      >
        <button
          type="button"
          data-session-toggle=""
          aria-expanded={!collapsed}
          aria-controls={rowsId}
          onClick={onToggle}
          className="flex-1 min-w-0 flex flex-wrap items-center gap-x-3.5 gap-y-1 py-2 pl-3 text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        >
          <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={11} className="shrink-0 -mr-2 text-text-muted" />
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <Icon name="git-branch" size={11} className="text-accent shrink-0" />
            <span className="sr-only">{collapsed ? "Expand" : "Collapse"} session </span>
            <span
              className={cn("min-w-0 truncate font-mono text-[11px]", collapsed ? "text-text-muted" : "text-text-primary")}
              title={group.sessionId}
            >
              {middleTruncate(group.sessionId, 72)}
            </span>
          </span>
          <span className="text-[10px] text-text-muted tabular-nums">
            {from === to ? to : `${from} – ${to}`} · {count} message{count === 1 ? "" : "s"} · {group.tokens.toLocaleString()} tokens
          </span>
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-muted">
            {group.peers.map((peer) => {
              const kind = kindOf(peer);
              return (
                <span key={peer} className="inline-flex items-center gap-1">
                  {kind ? (
                    <Icon name={kind === "agent" ? "bot" : "user"} size={10} className={kind === "agent" ? "text-purple-400" : "text-blue-400"} />
                  ) : null}
                  {peer}
                </span>
              );
            })}
          </span>
        </button>
        <button
          type="button"
          onClick={() => onRead(group.sessionId)}
          className="shrink-0 text-[10px] uppercase tracking-wider text-text-muted hover:text-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        >
          READ_SESSION →
        </button>
      </div>
      {/* Rows close by animating the grid track to zero; inert keeps hidden lines out of the tab order. */}
      <div
        id={rowsId}
        inert={collapsed}
        className="grid motion-safe:transition-[grid-template-rows] motion-safe:duration-200 ease-out"
        style={{ gridTemplateRows: collapsed ? "0fr" : "1fr" }}
      >
        <ol className="min-h-0 overflow-hidden" aria-label={`${count} message${count === 1 ? "" : "s"}, newest first`}>
          {rows.map(({ message: m, repeatPeer }) => (
            <MessageLine
              key={m.id}
              message={m}
              kind={kindOf(m.peer_id)}
              grid={GROUP_GRID}
              tokensColumn={false}
              repeatPeer={repeatPeer}
              searchText={searchText}
              open={openIds.has(m.id)}
              onOpenChange={(open) => onLineOpen(m.id, open)}
            />
          ))}
        </ol>
      </div>
    </section>
  );
}
