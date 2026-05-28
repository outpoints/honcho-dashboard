"use client";

import { useCallback, useEffect, useState } from "react";
import { useActiveHonchoOptions } from "@/lib/honcho/config";

export interface OperatorQueryState<T> {
  data: T | undefined;
  error: Error | undefined;
  isLoading: boolean;
  refetch: () => void;
}

export function useOperatorQuery<T>(
  path: string | null,
  options?: { refreshInterval?: number; withHonchoHeaders?: boolean },
): OperatorQueryState<T> {
  const apiOpts = useActiveHonchoOptions();
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<Error | undefined>();
  const [isLoading, setIsLoading] = useState(false);

  const baseUrl = apiOpts?.baseUrl ?? "";
  const token = apiOpts?.token ?? "";
  const withHonchoHeaders = !!options?.withHonchoHeaders;

  const run = useCallback((): (() => void) | undefined => {
    if (!path) return;
    const headers: Record<string, string> = {};
    if (withHonchoHeaders && baseUrl) {
      headers["X-Honcho-Base-Url"] = baseUrl.replace(/\/+$/, "");
      if (token) headers["X-Honcho-Token"] = token;
    }
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setIsLoading(true);
      fetch(path, { headers, signal: controller.signal, cache: "no-store" })
        .then(async (res) => {
          const text = await res.text();
          let body: unknown;
          try {
            body = text ? JSON.parse(text) : undefined;
          } catch {
            body = text;
          }
          if (!res.ok) {
            const detail =
              (body && typeof body === "object" && "detail" in body
                ? String((body as { detail: unknown }).detail)
                : text) || res.statusText;
            throw new Error(`HTTP ${res.status}: ${detail}`);
          }
          if (controller.signal.aborted) return;
          setData(body as T);
          setError(undefined);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setError(err instanceof Error ? err : new Error(String(err)));
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false);
        });
    });
    return () => controller.abort();
  }, [path, baseUrl, token, withHonchoHeaders]);

  useEffect(() => {
    if (!path) return;
    return run();
  }, [path, run]);

  useEffect(() => {
    if (!path || !options?.refreshInterval) return;
    const id = setInterval(() => run(), options.refreshInterval);
    return () => clearInterval(id);
  }, [path, options?.refreshInterval, run]);

  return { data, error, isLoading, refetch: run };
}
