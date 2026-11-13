"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Button } from "@/components/atoms";
import { MessageLine, MessageLineHeader, type PeerKind } from "@/components/MessageLine";
import { honcho, type HonchoClientOptions } from "@/lib/honcho/client";
import type { ApiMessage } from "@/lib/honcho/types";
import { formatApiError } from "@/lib/honcho/useQuery";
import { useListTotal } from "@/lib/honcho/useListTotal";
import { peerColumnWidth } from "@/lib/messageStream";
import { appendOlder, TRANSCRIPT_PAGE } from "@/lib/sessionTranscript";

interface TranscriptState {
  status: "loading" | "ready" | "error";
  newestFirst: ApiMessage[];
  total: number;
  /** Next (older) page to request, or null when the server has no more. */
  nextPage: number | null;
  error?: string;
}

const nextPageOf = (page: { page: number; pages: number }) => (page.page < page.pages ? page.page + 1 : null);

// Peer | message | tokens | time on wider screens; on phones the peer and time
// share the first line and the message takes the second.
const LINE_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[var(--peer-col,9rem)_minmax(0,1fr)_3.5rem_6.5rem] gap-x-3 gap-y-0.5";

/**
 * A session's conversation inside its expanded row: newest first, one line per
 * message, and a line opens in place to show the full message. Opens on the
 * latest page; LOAD_MORE adds older pages below, so the reader never moves.
 */
export function SessionTranscript({
  apiOpts,
  workspaceId,
  sessionId,
  peerKind,
  refreshKey = 0,
}: {
  apiOpts: HonchoClientOptions | null;
  workspaceId: string;
  sessionId: string;
  peerKind: (peerId: string) => PeerKind;
  refreshKey?: number;
}) {
  const [state, setState] = useState<TranscriptState>({ status: "loading", newestFirst: [], total: 0, nextPage: null });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const listTotal = useListTotal();

  useEffect(() => {
    if (!apiOpts) return;
    let cancelled = false;
    (async () => {
      try {
        // Raw list read: the SDK's session() would get-or-create the session first.
        const page = await honcho.sessions.messages(apiOpts, workspaceId, sessionId, {
          page: 1,
          size: TRANSCRIPT_PAGE,
          reverse: true,
        });
        if (cancelled) return;
        setOlderError(null);
        setState({ status: "ready", newestFirst: page.items, total: page.total, nextPage: nextPageOf(page) });
      } catch (err) {
        if (!cancelled) setState((s) => ({ ...s, status: "error", error: formatApiError(err) }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiOpts, workspaceId, sessionId, refreshKey]);

  const lines = state.newestFirst;

  const shown = state.newestFirst.length;
  // New messages written since the first read push older ones to later pages;
  // the overlap is dropped by id, so nothing is skipped or shown twice.
  const older = state.nextPage === null ? 0 : Math.max(0, state.total - shown);

  const loadOlder = async () => {
    const pageNumber = state.nextPage;
    if (!apiOpts || pageNumber === null || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await honcho.sessions.messages(apiOpts, workspaceId, sessionId, {
        page: pageNumber,
        size: TRANSCRIPT_PAGE,
        reverse: true,
      });
      setState((s) => ({
        ...s,
        total: page.total,
        nextPage: page.items.length ? nextPageOf(page) : null,
        newestFirst: appendOlder(s.newestFirst, page.items),
      }));
    } catch (err) {
      setOlderError(formatApiError(err));
    } finally {
      setLoadingOlder(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
        <span className="text-[10px] text-text-muted uppercase tracking-wider">
          MESSAGES{state.status === "ready" ? ` (${shown === state.total ? shown : `${shown} of ${listTotal.format(state.total)}`})` : ""}
        </span>
        {state.status === "ready" && shown > 0 ? (
          <span className="text-[10px] text-text-muted">Latest first. Select a line to read the whole message.</span>
        ) : null}
      </div>

      {state.status === "loading" ? (
        <div className="border border-border bg-surface" aria-label="Loading conversation">
          {[72, 54, 80, 46, 64].map((w) => (
            <div key={w} className="flex items-center gap-3 px-3 py-2 border-b border-border last:border-b-0">
              <div className="h-2.5 w-20 bg-border/60 animate-pulse" />
              <div className="h-2.5 bg-border/40 animate-pulse" style={{ width: `${w}%` }} />
            </div>
          ))}
        </div>
      ) : state.status === "error" ? (
        <p role="alert" className="text-[11px] text-red-400 break-words">
          Could not load this conversation: {state.error}. Check the instance in{" "}
          <a href="#/config" className="underline underline-offset-2 hover:text-text-primary">CONFIG</a>.
        </p>
      ) : shown === 0 ? (
        <p className="text-[11px] text-text-muted">
          No messages in this session yet. Messages appear here as peers write to it.
        </p>
      ) : (
        <div
          data-testid="session-transcript"
          data-transcript-scroll
          className="max-h-[22rem] overflow-y-auto overscroll-contain border border-border bg-surface"
          style={{ "--peer-col": peerColumnWidth(lines.map((m) => m.peer_id)) } as CSSProperties}
        >
          <MessageLineHeader grid={LINE_GRID} />
          <ol aria-label="Conversation, newest first">
            {lines.map((message, i) => (
              <MessageLine
                key={message.id}
                message={message}
                kind={peerKind(message.peer_id)}
                grid={LINE_GRID}
                repeatPeer={i > 0 && lines[i - 1].peer_id === message.peer_id}
              />
            ))}
          </ol>
          {older > 0 ? (
            <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-t border-border">
              <Button size="sm" variant="ghost" icon="chevron-down" onClick={loadOlder} disabled={loadingOlder}>
                {loadingOlder ? "LOADING…" : listTotal.isLowerBound(state.total) ? "LOAD_MORE" : `LOAD_MORE (${older})`}
              </Button>
              {olderError ? (
                <span role="alert" className="text-[10px] text-red-400 break-words">{olderError}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
