"use client";

import { useCallback, useSyncExternalStore } from "react";

export interface HonchoInstance {
  id: string;
  name: string;
  baseUrl: string;
  token?: string;
}

const INSTANCES_KEY = "honcho-dashboard:instances";
const ACTIVE_KEY = "honcho-dashboard:activeId";
const WORKSPACE_KEY = "honcho-dashboard:activeWorkspaceId";

interface Snapshot {
  instances: HonchoInstance[];
  activeId: string | null;
  activeWorkspaceId: string | null;
}

const EMPTY_SNAPSHOT: Snapshot = { instances: [], activeId: null, activeWorkspaceId: null };

function defaultBaseUrl(): string {
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_HONCHO_BASE_URL) {
    return process.env.NEXT_PUBLIC_HONCHO_BASE_URL;
  }
  return "http://localhost:8000";
}

function defaultToken(): string | undefined {
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_HONCHO_TOKEN) {
    return process.env.NEXT_PUBLIC_HONCHO_TOKEN;
  }
  return undefined;
}

function readRaw(): Snapshot {
  if (typeof window === "undefined") return EMPTY_SNAPSHOT;
  let instances: HonchoInstance[] = [];
  try {
    const raw = window.localStorage.getItem(INSTANCES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        instances = parsed.filter(
          (x): x is HonchoInstance =>
            x && typeof x.id === "string" && typeof x.name === "string" && typeof x.baseUrl === "string",
        );
      }
    }
  } catch {
    instances = [];
  }
  const activeId = window.localStorage.getItem(ACTIVE_KEY);
  const activeWorkspaceId = window.localStorage.getItem(WORKSPACE_KEY);

  if (instances.length === 0) {
    const seed: HonchoInstance = {
      id: "default",
      name: "local",
      baseUrl: defaultBaseUrl(),
      token: defaultToken(),
    };
    try {
      window.localStorage.setItem(INSTANCES_KEY, JSON.stringify([seed]));
      window.localStorage.setItem(ACTIVE_KEY, seed.id);
    } catch {
      // localStorage unavailable
    }
    return { instances: [seed], activeId: seed.id, activeWorkspaceId };
  }

  return { instances, activeId, activeWorkspaceId };
}

function sameInstance(a: HonchoInstance, b: HonchoInstance): boolean {
  return a.id === b.id && a.name === b.name && a.baseUrl === b.baseUrl && a.token === b.token;
}

function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  if (a.activeId !== b.activeId) return false;
  if (a.activeWorkspaceId !== b.activeWorkspaceId) return false;
  if (a.instances.length !== b.instances.length) return false;
  for (let i = 0; i < a.instances.length; i++) {
    if (!sameInstance(a.instances[i], b.instances[i])) return false;
  }
  return true;
}

let cachedSnapshot: Snapshot = EMPTY_SNAPSHOT;

function snapshot(): Snapshot {
  if (typeof window === "undefined") return EMPTY_SNAPSHOT;
  const next = readRaw();
  if (sameSnapshot(cachedSnapshot, next)) return cachedSnapshot;
  cachedSnapshot = next;
  return cachedSnapshot;
}

function serverSnapshot(): Snapshot {
  return EMPTY_SNAPSHOT;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  let unbindStorage: (() => void) | undefined;
  if (typeof window !== "undefined") {
    const onStorage = (e: StorageEvent) => {
      if (e.key === INSTANCES_KEY || e.key === ACTIVE_KEY || e.key === WORKSPACE_KEY) notify();
    };
    window.addEventListener("storage", onStorage);
    unbindStorage = () => window.removeEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    unbindStorage?.();
  };
}

function writeInstances(next: HonchoInstance[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(INSTANCES_KEY, JSON.stringify(next));
  notify();
}

function writeActive(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id === null) window.localStorage.removeItem(ACTIVE_KEY);
  else window.localStorage.setItem(ACTIVE_KEY, id);
  notify();
}

function writeWorkspace(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id === null) window.localStorage.removeItem(WORKSPACE_KEY);
  else window.localStorage.setItem(WORKSPACE_KEY, id);
  notify();
}

export function useHonchoInstances() {
  const state = useSyncExternalStore<Snapshot>(subscribe, snapshot, serverSnapshot);

  const setActive = useCallback((id: string) => writeActive(id), []);

  const upsert = useCallback((instance: HonchoInstance) => {
    const current = readRaw().instances;
    const i = current.findIndex((x) => x.id === instance.id);
    const next = i >= 0 ? current.map((x, idx) => (idx === i ? instance : x)) : [...current, instance];
    writeInstances(next);
    if (!readRaw().activeId) writeActive(instance.id);
  }, []);

  const remove = useCallback((id: string) => {
    const current = readRaw().instances;
    const next = current.filter((x) => x.id !== id);
    writeInstances(next);
    if (readRaw().activeId === id) {
      writeActive(next[0]?.id ?? null);
    }
  }, []);

  const active =
    state.instances.find((x) => x.id === state.activeId) ?? state.instances[0] ?? null;

  return {
    instances: state.instances,
    active,
    activeId: state.activeId,
    setActive,
    upsert,
    remove,
  };
}

export function useActiveHonchoOptions(): { baseUrl: string; token?: string } | null {
  const { active } = useHonchoInstances();
  if (!active) return null;
  return { baseUrl: active.baseUrl, token: active.token };
}

export function useActiveWorkspace(): {
  workspaceId: string | null;
  setWorkspaceId: (id: string | null) => void;
} {
  const state = useSyncExternalStore<Snapshot>(subscribe, snapshot, serverSnapshot);
  const setWorkspaceId = useCallback((id: string | null) => writeWorkspace(id), []);
  return { workspaceId: state.activeWorkspaceId, setWorkspaceId };
}
