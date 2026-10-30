"use client";

/**
 * Tab-scoped trash for deleted conclusions.
 *
 * Honcho deletes conclusions permanently. Before the dashboard sends a delete
 * it keeps a copy here so the operator can recreate it. Restoring posts a new
 * conclusion: Honcho assigns a new ID and stores it as explicit, so the
 * original level and provenance are gone. The copy lives in sessionStorage,
 * keyed by instance and workspace, and disappears when the tab closes; deleted
 * memory is never kept beyond the session that deleted it.
 */
import { useCallback, useSyncExternalStore } from "react";
import type { ApiConclusion } from "./honcho/types";

const STORAGE_KEY = "honcho-dashboard:conclusion-trash";
const CHANGE_EVENT = "honcho-dashboard:conclusion-trash";
/** Per instance and workspace; the oldest entries fall off first. */
export const TRASH_LIMIT = 200;

export interface TrashedConclusion {
  conclusion: ApiConclusion;
  deleted_at: string;
}

type TrashMap = Record<string, TrashedConclusion[]>;

interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function trashScope(baseUrl: string, workspaceId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}::${workspaceId}`;
}

function readAll(store: KeyValueStore): TrashMap {
  try {
    const parsed = JSON.parse(store.getItem(STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as TrashMap : {};
  } catch {
    return {};
  }
}

export function readTrash(store: KeyValueStore, scope: string): TrashedConclusion[] {
  const items = readAll(store)[scope];
  return Array.isArray(items)
    ? items.filter((item) => item && typeof item.conclusion?.id === "string" && typeof item.conclusion.content === "string")
    : [];
}

function writeScope(store: KeyValueStore, scope: string, items: TrashedConclusion[]) {
  const all = readAll(store);
  if (items.length) all[scope] = items;
  else delete all[scope];
  store.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function pushTrash(store: KeyValueStore, scope: string, conclusion: ApiConclusion, now = new Date()): TrashedConclusion[] {
  const items = [
    { conclusion, deleted_at: now.toISOString() },
    ...readTrash(store, scope).filter((item) => item.conclusion.id !== conclusion.id),
  ].slice(0, TRASH_LIMIT);
  writeScope(store, scope, items);
  return items;
}

export function dropTrash(store: KeyValueStore, scope: string, id?: string): TrashedConclusion[] {
  const items = id === undefined ? [] : readTrash(store, scope).filter((item) => item.conclusion.id !== id);
  writeScope(store, scope, items);
  return items;
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

const EMPTY: TrashedConclusion[] = [];
let cache: { raw: string | null; scope: string; items: TrashedConclusion[] } | null = null;

function snapshot(scope: string): TrashedConclusion[] {
  const store = storage();
  if (!store) return EMPTY;
  const raw = store.getItem(STORAGE_KEY);
  // useSyncExternalStore needs a stable reference until the data changes.
  if (cache && cache.raw === raw && cache.scope === scope) return cache.items;
  const items = readTrash(store, scope);
  cache = { raw, scope, items };
  return items;
}

export function useConclusionTrash(scope: string | null) {
  const items = useSyncExternalStore(
    subscribe,
    () => (scope ? snapshot(scope) : EMPTY),
    () => EMPTY,
  );
  const mutate = useCallback((fn: (store: KeyValueStore, scope: string) => void) => {
    const store = storage();
    if (!store || !scope) return false;
    try {
      fn(store, scope);
    } catch {
      return false; // quota or privacy mode: the caller decides what to tell the operator
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  }, [scope]);
  return {
    items,
    add: (conclusion: ApiConclusion) => mutate((store, s) => pushTrash(store, s, conclusion)),
    remove: (id: string) => mutate((store, s) => dropTrash(store, s, id)),
    clear: () => mutate((store, s) => dropTrash(store, s)),
  };
}
