/**
 * Messages page helpers. Pure, so Node tests can cover them.
 *
 * Both sources page newest first: the operator database with a
 * (created_at, id) cursor, the Honcho API with page numbers. The page shows
 * them that way too, the latest at the top, for one session or the whole
 * workspace, and adds new messages above as they arrive.
 */

export const STREAM_PAGE = 50;
/** Live follow checks for new messages this often while the tab is visible. */
export const LIVE_INTERVAL_MS = 5000;
/** At most this many new messages per check; more means the view reloads. */
export const LIVE_PAGE = 200;

export interface StreamFilters {
  workspaceId: string;
  sessionId: string | null;
  peerId: string | null;
  /** Text search, already trimmed; empty for none. */
  q: string;
}

export interface StreamMessage {
  id: string;
  peer_id: string;
  session_id: string;
  content: string;
  token_count: number;
  created_at: string;
}

type Cursor = Pick<StreamMessage, "id" | "created_at">;

/**
 * Operator-database URL for one page: the latest page, the page older than the
 * oldest message shown (`before`), or the messages newer than the latest one
 * shown (`after`, for live follow).
 */
export function streamUrl(filters: StreamFilters, cursor?: { before: Cursor } | { after: Cursor }): string {
  const after = cursor && "after" in cursor ? cursor.after : null;
  const usp = new URLSearchParams({ view: "messages", workspace_id: filters.workspaceId, limit: String(after ? LIVE_PAGE : STREAM_PAGE) });
  if (filters.sessionId) usp.set("session_id", filters.sessionId);
  if (filters.peerId) usp.set("peer_id", filters.peerId);
  if (filters.q) usp.set("q", filters.q);
  if (after) {
    usp.set("after_at", after.created_at);
    usp.set("after_id", after.id);
  } else if (cursor && "before" in cursor) {
    usp.set("before_at", cursor.before.created_at);
    usp.set("before_id", cursor.before.id);
  }
  return `/api/operator/db?${usp.toString()}`;
}

/**
 * Add messages a live check found to a newest-first list: unseen ones go in
 * front, in the order the server returned them (newest first). Lines already
 * shown never move. Re-sorting here would break timestamp ties by a different
 * rule than the database's collation and reshuffle lines under the reader.
 */
export function mergeNewer<T extends StreamMessage>(newestFirst: T[], found: T[]): { list: T[]; added: number } {
  const seen = new Set(newestFirst.map((m) => m.id));
  const fresh = found.filter((m) => !seen.has(m.id));
  if (fresh.length === 0) return { list: newestFirst, added: 0 };
  return { list: [...fresh, ...newestFirst], added: fresh.length };
}

export interface StreamRow<T extends StreamMessage = StreamMessage> {
  message: T;
  /** Draw a divider naming the session above this line. */
  sessionStart: boolean;
  /** Same peer as the line above in the same session: the name steps back. */
  repeatPeer: boolean;
}

/**
 * Lines in display order. Across sessions, a divider marks each point where the
 * session changes from the line above, including the first line; one session
 * needs none.
 */
export function streamRows<T extends StreamMessage>(oldestFirst: T[], acrossSessions: boolean): StreamRow<T>[] {
  return oldestFirst.map((message, i) => {
    const prev = oldestFirst[i - 1];
    const sessionStart = acrossSessions && (!prev || prev.session_id !== message.session_id);
    return { message, sessionStart, repeatPeer: !!prev && !sessionStart && prev.peer_id === message.peer_id };
  });
}

export interface SessionGroup<T extends StreamMessage = StreamMessage> {
  /**
   * The oldest message's id. Live follow adds newer messages to the top group
   * without changing its key; only LOAD_MORE can extend the bottom group.
   */
  key: string;
  sessionId: string;
  /** Newest first, like the page. */
  messages: T[];
  tokens: number;
  /** Peers in the order they first appear, newest first. */
  peers: string[];
}

/**
 * Consecutive messages from one session, newest first, form a group. When
 * sessions interleave, a session appears in several groups; nothing is moved
 * out of time order to merge them.
 */
export function groupRuns<T extends StreamMessage>(newestFirst: T[]): SessionGroup<T>[] {
  const groups: SessionGroup<T>[] = [];
  for (const m of newestFirst) {
    const last = groups.at(-1);
    if (last && last.sessionId === m.session_id) {
      last.messages.push(m);
      last.key = m.id;
      last.tokens += Number.isFinite(m.token_count) ? m.token_count : 0;
      if (!last.peers.includes(m.peer_id)) last.peers.push(m.peer_id);
    } else {
      groups.push({
        key: m.id,
        sessionId: m.session_id,
        messages: [m],
        tokens: Number.isFinite(m.token_count) ? m.token_count : 0,
        peers: [m.peer_id],
      });
    }
  }
  return groups;
}

/** Messages page filters live in the hash, so a link reproduces the view. */
export function readStreamHash(hash: string): { sessionId: string | null; peerId: string | null; q: string } {
  const usp = new URLSearchParams(hash.split("?")[1] ?? "");
  return {
    sessionId: usp.get("session") || null,
    peerId: usp.get("peer") || null,
    q: (usp.get("q") ?? "").trim(),
  };
}

export function streamHash(next: { sessionId: string | null; peerId: string | null; q: string }): string {
  const usp = new URLSearchParams();
  if (next.sessionId) usp.set("session", next.sessionId);
  if (next.peerId) usp.set("peer", next.peerId);
  if (next.q.trim()) usp.set("q", next.q.trim());
  const query = usp.toString();
  return query ? `#/messages?${query}` : "#/messages";
}

/** Case-insensitive literal match, the same rule as the database search. */
export function matchesText(content: string, q: string): boolean {
  return !q || content.toLowerCase().includes(q.toLowerCase());
}

/** Totals for what is on screen; the page says these cover loaded messages only. */
export function summarize(messages: Pick<StreamMessage, "peer_id" | "session_id" | "token_count">[]) {
  const peers = new Set<string>();
  const sessions = new Set<string>();
  let tokens = 0;
  for (const m of messages) {
    peers.add(m.peer_id);
    sessions.add(m.session_id);
    tokens += Number.isFinite(m.token_count) ? m.token_count : 0;
  }
  return { count: messages.length, tokens, peers: peers.size, sessions: sessions.size };
}

/**
 * Shorten a long id in the middle, keeping both ends: session ids often share
 * a long prefix and differ only at the end.
 */
export function middleTruncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const keep = max - 1;
  const head = Math.ceil(keep * 0.6);
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
}

/**
 * While searching, a one-line preview starts just before the first match, so
 * the reason a long message matched is visible. Plain text: a slice through
 * markdown would leave stray markers. Null when the match is already near the
 * start (or absent), so the normal preview is used.
 */
export function snippetAround(content: string, q: string, lead = 40): string | null {
  if (!q) return null;
  const flat = content.replace(/\s+/g, " ").trim();
  const at = flat.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0 || at <= lead * 1.5) return null;
  // Start on a word boundary near `lead` characters before the match.
  let start = at - lead;
  const space = flat.indexOf(" ", start);
  if (space > -1 && space < at) start = space + 1;
  return `…${flat.slice(start)}`;
}

/** Peer names longer than this truncate, with the full id in their title. */
export const PEER_COLUMN_MAX_CHARS = 24;

/**
 * Width of the peer column for the names shown, so a list of short names does
 * not leave a gap before the message. Lines are separate grids, so the width is
 * computed once and shared through a CSS variable to keep every line aligned.
 * The name is 11px JetBrains Mono (0.6em per character); 32px covers the
 * chevron, the type-icon slot and their gaps.
 */
export function peerColumnWidth(peerIds: Iterable<string>): string {
  let longest = 4; // never narrower than the PEER column label
  for (const id of peerIds) longest = Math.max(longest, id.length);
  const chars = Math.min(longest, PEER_COLUMN_MAX_CHARS) + 1; // one character of slack
  return `${Math.ceil(chars * 0.6 * 11) + 32}px`;
}

