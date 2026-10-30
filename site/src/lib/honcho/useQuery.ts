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
  /** Epoch ms of the last successful fetch, or undefined before one. */
  updatedAt: number | undefined;
  refetch: () => void;
}

interface CacheEntry<T> {
  data?: T;
  error?: Error;
  updatedAt?: number;
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
  for (const [cacheKey, entry] of cache) {
    // Cache keys include the active base URL and token before the logical query
    // key. Match against the logical portion so mutations invalidate every
    // consumer of a resource, regardless of which connection is active.
    const separator = cacheKey.lastIndexOf("::");
    const queryKey = separator >= 0 ? cacheKey.slice(separator + 2) : cacheKey;
    if (queryKey.startsWith(prefix)) {
      entry.data = undefined;
      entry.error = undefined;
      for (const sub of entry.subscribers) sub();
    }
  }
}

export function useHonchoQuery<T>(
  key: string | null,
  fetcher: (opts: HonchoClientOptions) => Promise<T>,
  options?: {
    /** Poll period in ms; a function picks it from the latest data (e.g. faster while busy). */
    refreshInterval?: number | ((data: T | undefined) => number | undefined);
    enabled?: boolean;
  },
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
        entry.updatedAt = Date.now();
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

  const entry = fullKey ? getEntry<T>(fullKey) : undefined;
  const data = entry?.data;
  const refresh = options?.refreshInterval;
  const interval = typeof refresh === "function" ? refresh(data) : refresh;

  useEffect(() => {
    if (!enabled || !interval || !fullKey) return;
    const id = setInterval(() => run(), interval);
    return () => clearInterval(id);
  }, [enabled, fullKey, interval, run]);

  const error = entry?.error;
  const isFetching = !!entry?.promise;
  const isLoading = enabled && data === undefined && error === undefined;

  return { data, error, isLoading, isFetching, updatedAt: entry?.updatedAt, refetch: run };
}

export function formatApiError(err: unknown): string {
  if (err instanceof HonchoApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
