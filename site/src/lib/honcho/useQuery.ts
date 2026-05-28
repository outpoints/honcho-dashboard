"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveHonchoOptions } from "./config";
import type { HonchoClientOptions } from "./client";
import { HonchoApiError } from "./types";

export interface QueryState<T> {
  data: T | undefined;
  error: Error | undefined;
  isLoading: boolean;
  isFetching: boolean;
  refetch: () => void;
}

interface CacheEntry<T> {
  data?: T;
  error?: Error;
  promise?: Promise<unknown>;
  subscribers: Set<() => void>;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getEntry<T>(key: string): CacheEntry<T> {
  let entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) {
    entry = { subscribers: new Set() };
    cache.set(key, entry);
  }
  return entry;
}

export function invalidate(prefix: string): void {
  for (const [key, entry] of cache) {
    if (key.startsWith(prefix)) {
      entry.data = undefined;
      entry.error = undefined;
      for (const sub of entry.subscribers) sub();
    }
  }
}

export function useHonchoQuery<T>(
  key: string | null,
  fetcher: (opts: HonchoClientOptions) => Promise<T>,
  options?: { refreshInterval?: number; enabled?: boolean },
): QueryState<T> {
  const apiOpts = useActiveHonchoOptions();
  const enabled = (options?.enabled ?? true) && key !== null && apiOpts !== null;
  const fullKey = key && apiOpts ? `${apiOpts.baseUrl}::${apiOpts.token ?? ""}::${key}` : null;

  const [, force] = useState(0);
  const tick = useCallback(() => force((n) => n + 1), []);
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const run = useCallback(() => {
    if (!fullKey || !apiOpts) return;
    const entry = getEntry<T>(fullKey);
    const controller = new AbortController();
    const promise = fetcherRef.current({ ...apiOpts, signal: controller.signal })
      .then((data) => {
        entry.data = data;
        entry.error = undefined;
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        entry.error =
          err instanceof Error ? err : new Error(typeof err === "string" ? err : "Unknown error");
        entry.data = undefined;
      })
      .finally(() => {
        entry.promise = undefined;
        for (const sub of entry.subscribers) sub();
      });
    entry.promise = promise;
    for (const sub of entry.subscribers) sub();
    return () => controller.abort();
  }, [fullKey, apiOpts]);

  useEffect(() => {
    if (!enabled || !fullKey) return;
    const entry = getEntry<T>(fullKey);
    entry.subscribers.add(tick);
    if (entry.data === undefined && entry.error === undefined && !entry.promise) {
      run();
    }
    return () => {
      entry.subscribers.delete(tick);
    };
  }, [enabled, fullKey, run, tick]);

  useEffect(() => {
    if (!enabled || !options?.refreshInterval || !fullKey) return;
    const id = setInterval(() => run(), options.refreshInterval);
    return () => clearInterval(id);
  }, [enabled, fullKey, options?.refreshInterval, run]);

  const entry = fullKey ? getEntry<T>(fullKey) : undefined;
  const data = entry?.data;
  const error = entry?.error;
  const isFetching = !!entry?.promise;
  const isLoading = enabled && data === undefined && error === undefined;

  return { data, error, isLoading, isFetching, refetch: run };
}

export function formatApiError(err: unknown): string {
  if (err instanceof HonchoApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
