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

/**
 * Headers every SDK call carries to the same-origin proxy. A saved browser
 * token travels as `X-Honcho-Token`, the only header the proxy reads to decide
 * whether the user's token or the server's `HONCHO_PROXY_TOKEN` applies (the
 * SDK's own `Authorization` is ignored for that decision). Without a token no
 * credential header is sent, so the server token can apply.
 */
export function sdkDefaultHeaders(opts: HonchoClientOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Honcho-Base-Url": opts.baseUrl.replace(/\/+$/, ""),
  };
  if (opts.token) headers["X-Honcho-Token"] = opts.token;
  return headers;
}

export function getSdk(opts: HonchoClientOptions, workspaceId: string): Honcho {
  const key = cacheKey(opts, workspaceId);
  let client = cache.get(key);
  if (!client) {
    client = new Honcho({
      baseURL: proxyOrigin(),
      apiKey: opts.token ?? "unused-token-please-server-ignore",
      workspaceId,
      defaultHeaders: sdkDefaultHeaders(opts),
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
