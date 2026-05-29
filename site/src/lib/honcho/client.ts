/**
 * Thin raw client for **verified gaps** in `@honcho-ai/sdk`.
 *
 * Most data flows should use the SDK via `getSdk(opts, workspaceId)` in `./sdk.ts`.
 * Only the endpoints below are exposed here, and only because the SDK either:
 *   - doesn't expose them at all (health, openapi, webhooks),
 *   - would require a workspace context we don't have yet
 *     (workspaces.list/create/delete — Honcho() is workspace-scoped and
 *     get-or-creates on first use),
 *   - or organizes them differently than our UI needs
 *     (conclusions: SDK scopes per (observer, observed) — we want workspace-wide).
 *
 * If a new endpoint can be reached through the SDK, prefer that over adding here.
 */
import {
  HonchoApiError,
  type ApiConclusion,
  type ApiWebhookEndpoint,
  type ApiWorkspace,
  type Page,
} from "./types";

export interface HonchoClientOptions {
  baseUrl: string;
  token?: string;
  signal?: AbortSignal;
}

export interface ListParams {
  page?: number;
  size?: number;
  filter?: Record<string, unknown>;
}

function normalizeBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function describeDetail(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object") return "";
  const detail = (parsed as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        if (!d || typeof d !== "object") return String(d);
        const e = d as { msg?: string; loc?: unknown[]; type?: string };
        const loc = Array.isArray(e.loc) ? e.loc.join(".") : "";
        return [loc, e.msg ?? e.type].filter(Boolean).join(": ");
      })
      .join("; ");
  }
  return "";
}

function buildProxyUrl(path: string): string {
  const clean = path.startsWith("/") ? path.slice(1) : path;
  return `/api/honcho/${clean}`;
}

async function request<T>(
  opts: HonchoClientOptions,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const url = buildProxyUrl(path);
  const headers: Record<string, string> = {
    "X-Honcho-Base-Url": normalizeBase(opts.baseUrl),
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers["X-Honcho-Token"] = opts.token;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: opts.signal,
      cache: "no-store",
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "network error";
    throw new HonchoApiError(0, url, `Network error: ${reason}`);
  }

  if (!res.ok) {
    let parsed: unknown;
    let text = "";
    try {
      text = await res.text();
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    const detail = describeDetail(parsed) || text || res.statusText;
    throw new HonchoApiError(res.status, url, `HTTP ${res.status}: ${detail}`, parsed);
  }

  if (res.status === 204) return undefined as T;
  const ctype = res.headers.get("content-type") ?? "";
  if (ctype.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

function listBody(params: ListParams = {}): Record<string, unknown> {
  return { ...(params.filter ?? {}) };
}

function listQuery(params: ListParams = {}): string {
  const usp = new URLSearchParams();
  if (params.page) usp.set("page", String(params.page));
  if (params.size) usp.set("size", String(params.size));
  const s = usp.toString();
  return s ? `?${s}` : "";
}

function ws(workspaceId: string) {
  return `/v3/workspaces/${encodeURIComponent(workspaceId)}`;
}

// === VERIFIED GAPS ===

export const honcho = {
  /** Gap: SDK has no `/health` endpoint. */
  health(opts: HonchoClientOptions) {
    return request<{ status: string }>(opts, "GET", "/health");
  },

  /** Gap: SDK's `/openapi.json` isn't exposed; diagnostics needs version. */
  openapi(opts: HonchoClientOptions) {
    return request<{ info?: { title?: string; version?: string } }>(opts, "GET", "/openapi.json");
  },

  /**
   * Gap: Honcho SDK is workspace-scoped — `new Honcho({workspaceId})` get-or-creates
   * the workspace on first use, which is the wrong UX for management screens.
   */
  workspaces: {
    list(opts: HonchoClientOptions, params: ListParams = {}) {
      return request<Page<ApiWorkspace>>(
        opts,
        "POST",
        `/v3/workspaces/list${listQuery(params)}`,
        listBody(params),
      );
    },
    create(
      opts: HonchoClientOptions,
      body: { id: string; metadata?: Record<string, unknown>; configuration?: Record<string, unknown> },
    ) {
      return request<ApiWorkspace>(opts, "POST", "/v3/workspaces", body);
    },
    update(
      opts: HonchoClientOptions,
      workspaceId: string,
      body: { metadata?: Record<string, unknown>; configuration?: Record<string, unknown> },
    ) {
      return request<ApiWorkspace>(opts, "PUT", ws(workspaceId), body);
    },
    delete(opts: HonchoClientOptions, workspaceId: string) {
      return request<void>(opts, "DELETE", ws(workspaceId));
    },
  },

  /**
   * Gap: SDK organizes conclusions per `(observer, observed)` peer pair
   * (`peer.conclusionsOf(target)`). Our UI lists conclusions workspace-wide.
   */
  conclusions: {
    list(opts: HonchoClientOptions, workspaceId: string, params: ListParams = {}) {
      return request<Page<ApiConclusion>>(
        opts,
        "POST",
        `${ws(workspaceId)}/conclusions/list${listQuery(params)}`,
        listBody(params),
      );
    },
    query(opts: HonchoClientOptions, workspaceId: string, body: { query: string; limit?: number }) {
      return request<Page<ApiConclusion>>(opts, "POST", `${ws(workspaceId)}/conclusions/query`, body);
    },
    delete(opts: HonchoClientOptions, workspaceId: string, conclusionId: string) {
      return request<void>(
        opts,
        "DELETE",
        `${ws(workspaceId)}/conclusions/${encodeURIComponent(conclusionId)}`,
      );
    },
  },

  /** Gap: SDK doesn't expose webhook endpoints. */
  webhooks: {
    list(opts: HonchoClientOptions, workspaceId: string) {
      return request<Page<ApiWebhookEndpoint>>(opts, "GET", `${ws(workspaceId)}/webhooks`);
    },
    create(opts: HonchoClientOptions, workspaceId: string, body: { url: string }) {
      return request<ApiWebhookEndpoint>(opts, "POST", `${ws(workspaceId)}/webhooks`, body);
    },
    delete(opts: HonchoClientOptions, workspaceId: string, endpointId: string) {
      return request<void>(
        opts,
        "DELETE",
        `${ws(workspaceId)}/webhooks/${encodeURIComponent(endpointId)}`,
      );
    },
    test(opts: HonchoClientOptions, workspaceId: string) {
      return request<unknown>(opts, "GET", `${ws(workspaceId)}/webhooks/test`);
    },
  },
};
