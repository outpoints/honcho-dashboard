/**
 * Sessions collapsed on the Messages page, per instance and workspace. Kept in
 * sessionStorage, like the conclusion trash: leaving the page and coming back
 * in the same tab keeps them collapsed, and a new tab starts with every
 * session open. Pure functions first, so Node tests can cover them.
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";

const STORAGE_KEY = "honcho-dashboard:messages-collapsed";
const CHANGE_EVENT = "honcho-dashboard:messages-collapsed";
/** Per scope; the oldest entries fall off first. */
export const COLLAPSED_LIMIT = 500;

interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function collapsedScope(baseUrl: string, workspaceId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}::${workspaceId}`;
}

function readAll(store: KeyValueStore): Record<string, string[]> {
  try {
    const parsed = JSON.parse(store.getItem(STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

export function readCollapsed(store: KeyValueStore, scope: string): string[] {
  const ids = readAll(store)[scope];
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

/** Collapse or expand one session; returns the scope's collapsed sessions. */
export function setCollapsed(store: KeyValueStore, scope: string, sessionId: string, collapsed: boolean): string[] {
  const rest = readCollapsed(store, scope).filter((id) => id !== sessionId);
  const ids = collapsed ? [...rest, sessionId].slice(-COLLAPSED_LIMIT) : rest;
  const all = readAll(store);
  if (ids.length) all[scope] = ids;
  else delete all[scope];
  store.setItem(STORAGE_KEY, JSON.stringify(all));
  return ids;
}

/** Expand some sessions, or every session in the scope when `sessionIds` is omitted. */
export function expandSessions(store: KeyValueStore, scope: string, sessionIds?: Iterable<string>): string[] {
  const drop = sessionIds ? new Set(sessionIds) : null;
  const ids = drop ? readCollapsed(store, scope).filter((id) => !drop.has(id)) : [];
  const all = readAll(store);
  if (ids.length) all[scope] = ids;
  else delete all[scope];
  store.setItem(STORAGE_KEY, JSON.stringify(all));
  return ids;
}

// --- React binding (sessionStorage + same-tab change event) -----------------

function storage(): KeyValueStore | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function subscribe(notify: () => void) {
  window.addEventListener(CHANGE_EVENT, notify);
  return () => window.removeEventListener(CHANGE_EVENT, notify);
}

const EMPTY: string[] = [];
let cache: { raw: string | null; scope: string; ids: string[] } | null = null;

function snapshot(scope: string): string[] {
  const store = storage();
  if (!store) return EMPTY;
  const raw = store.getItem(STORAGE_KEY);
  // useSyncExternalStore needs a stable reference until the data changes.
  if (cache && cache.raw === raw && cache.scope === scope) return cache.ids;
  const ids = readCollapsed(store, scope);
  cache = { raw, scope, ids };
  return ids;
}

/**
 * The scope's collapsed sessions and ways to change them. Without storage
 * (privacy mode) changes do nothing and every session stays open.
 */
export function useCollapsedSessions(scope: string | null) {
  const ids = useSyncExternalStore(subscribe, () => (scope ? snapshot(scope) : EMPTY), () => EMPTY);
  const collapsed = useMemo(() => new Set(ids), [ids]);
  const mutate = useCallback(
    (fn: (store: KeyValueStore, scope: string) => void) => {
      const store = storage();
      if (!store || !scope) return;
      try {
        fn(store, scope);
      } catch {
        return; // quota or privacy mode: the session stays as it was
      }
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [scope],
  );
  return {
    collapsed,
    toggle: useCallback((sessionId: string) => mutate((store, s) => setCollapsed(store, s, sessionId, !readCollapsed(store, s).includes(sessionId))), [mutate]),
    expand: useCallback((sessionIds?: Iterable<string>) => mutate((store, s) => expandSessions(store, s, sessionIds)), [mutate]),
  };
}
