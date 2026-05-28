"use client";

import { Honcho } from "@honcho-ai/sdk";
import type { HonchoClientOptions } from "./client";

const cache = new Map<string, Honcho>();

function cacheKey(opts: HonchoClientOptions, workspaceId: string): string {
  return `${opts.baseUrl}::${opts.token ?? ""}::${workspaceId}`;
}

function proxyOrigin(): string {
  // The SDK calls `new URL(path, baseURL)`; with a path starting with `/` it
  // discards baseURL's path. We pass the bare origin and rely on a Next.js
  // rewrite (`next.config.ts`) to map `/v3/...` and `/health` to our proxy.
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost";
}

export function getSdk(opts: HonchoClientOptions, workspaceId: string): Honcho {
  const key = cacheKey(opts, workspaceId);
  let client = cache.get(key);
  if (!client) {
    client = new Honcho({
      baseURL: proxyOrigin(),
      apiKey: opts.token ?? "unused-token-please-server-ignore",
      workspaceId,
      defaultHeaders: {
        "X-Honcho-Base-Url": opts.baseUrl.replace(/\/+$/, ""),
      },
      maxRetries: 1,
      timeout: 30000,
    });
    cache.set(key, client);
  }
  return client;
}

export function invalidateSdk(): void {
  cache.clear();
}
