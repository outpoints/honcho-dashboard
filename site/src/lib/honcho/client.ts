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
 *   - or cannot carry the dashboard's per-instance proxy headers
 *     (the SDK's multipart file-upload transport omits default headers).
 *   - or must probe an optional API without the SDK's get-or-create workspace
 *     side effect (the pre-3.1 compatibility check).
 *
 * If a new endpoint can be reached through the SDK, prefer that over adding here.
 */
import {
  HonchoApiError,
  type ApiConclusion,
  type ApiMessage,
  type ApiPeer,
  type ApiQueueStatus,
  type ApiSession,
  type ApiScope,
  type ApiWebhookEndpoint,
  type ApiWorkspace,
  type Page,
} from "./types.ts";
import { parseDeriverMetrics } from "./deriverMetrics.ts";
import { parseScopeKeyResponse, scopeKeyPath } from "./scopeKeys.ts";

export interface HonchoClientOptions {
  baseUrl: string;
  token?: string;
  signal?: AbortSignal;
}

export interface ListParams {
  page?: number;
  size?: number;
  filters?: Record<string, unknown>;
  reverse?: boolean;
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
    await throwResponseError(res, url);
  }

  if (res.status === 204) return undefined as T;
  const ctype = res.headers.get("content-type") ?? "";
  if (ctype.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

async function throwResponseError(res: Response, url: string): Promise<never> {
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

async function requestMultipart<T>(
  opts: HonchoClientOptions,
  path: string,
  body: FormData,
): Promise<T> {
  const url = buildProxyUrl(path);
  const headers: Record<string, string> = {
    "X-Honcho-Base-Url": normalizeBase(opts.baseUrl),
  };
  if (opts.token) headers["X-Honcho-Token"] = opts.token;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: opts.signal,
      cache: "no-store",
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "network error";
    throw new HonchoApiError(0, url, `Network error: ${reason}`);
  }

  if (!res.ok) await throwResponseError(res, url);
  return (await res.json()) as T;
}

function listBody(params: ListParams = {}): Record<string, unknown> {
  return params.filters ? { filters: params.filters } : {};
}

function listQuery(params: ListParams = {}): string {
  const usp = new URLSearchParams();
  if (params.page) usp.set("page", String(params.page));
  if (params.size) usp.set("size", String(params.size));
  if (params.reverse !== undefined) usp.set("reverse", String(params.reverse));
  const s = usp.toString();
  return s ? `?${s}` : "";
}

function ws(workspaceId: string) {
  return `/v3/workspaces/${encodeURIComponent(workspaceId)}`;
}

// === VERIFIED GAPS ===

export const honcho = {
  /** Gap: SDK does not expose instance-wide operational backlog metrics. */
  async deriverMetrics(opts: HonchoClientOptions) {
    return parseDeriverMetrics(await request<unknown>(opts, "GET", "/deriver/metrics"));
  },
  /** Gap: SDK has no `/health` endpoint. */
  health(opts: HonchoClientOptions) {
    return request<{ status: string }>(opts, "GET", "/health");
  },

  /** Gap: SDK's `/openapi.json` isn't exposed; diagnostics needs version, capabilities need schemas. */
  openapi(opts: HonchoClientOptions) {
    return request<{ info?: { title?: string; version?: string }; components?: { schemas?: Record<string, unknown> } }>(opts, "GET", "/openapi.json");
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

  /** Gap: SDK read helpers ensure (get-or-create) the workspace and peer. */
  peers: {
    list(opts: HonchoClientOptions, workspaceId: string, params: ListParams = {}) {
      return request<Page<ApiPeer>>(opts, "POST", `${ws(workspaceId)}/peers/list${listQuery(params)}`, listBody(params));
    },
    async card(opts: HonchoClientOptions, workspaceId: string, peerId: string) {
      const result = await request<{ peer_card: string[] | null }>(opts, "GET", `${ws(workspaceId)}/peers/${encodeURIComponent(peerId)}/card`);
      return result.peer_card;
    },
    sessions(opts: HonchoClientOptions, workspaceId: string, peerId: string, params: ListParams = {}) {
      return request<Page<ApiSession>>(opts, "POST", `${ws(workspaceId)}/peers/${encodeURIComponent(peerId)}/sessions${listQuery(params)}`, listBody(params));
    },
    search(opts: HonchoClientOptions, workspaceId: string, peerId: string, body: { query: string; limit?: number }) {
      return request<ApiMessage[]>(opts, "POST", `${ws(workspaceId)}/peers/${encodeURIComponent(peerId)}/search`, body);
    },
    /**
     * Gap: SDK `peer(id)` get-or-creates before `representation()`. This read
     * 404s for an unknown peer instead. Global, or this peer's view of `target`.
     */
    async representation(opts: HonchoClientOptions, workspaceId: string, peerId: string, body: { target?: string } = {}) {
      const result = await request<{ representation?: unknown }>(opts, "POST",
        `${ws(workspaceId)}/peers/${encodeURIComponent(peerId)}/representation`, body);
      return typeof result?.representation === "string" ? result.representation : "";
    },
    /**
     * Gap: SDK peer config types are camelCase and keep only the keys they model.
     * Workspace import must write the stored API shape back unchanged.
     */
    create(
      opts: HonchoClientOptions,
      workspaceId: string,
      body: { id: string; metadata?: Record<string, unknown>; configuration?: Record<string, unknown> },
    ) {
      return request<ApiPeer>(opts, "POST", `${ws(workspaceId)}/peers`, body);
    },
  },

  /**
   * Gap: SDK `session(id)` get-or-creates, and its config/message types drop
   * stored keys and `created_at`. Workspace export needs non-creating reads;
   * import needs exact bodies (timestamps, per-peer session config).
   */
  sessions: {
    list(opts: HonchoClientOptions, workspaceId: string, params: ListParams = {}) {
      return request<Page<ApiSession>>(opts, "POST", `${ws(workspaceId)}/sessions/list${listQuery(params)}`, listBody(params));
    },
    peers(opts: HonchoClientOptions, workspaceId: string, sessionId: string, params: ListParams = {}) {
      return request<Page<ApiPeer>>(opts, "GET", `${ws(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/peers${listQuery(params)}`);
    },
    peerConfig(opts: HonchoClientOptions, workspaceId: string, sessionId: string, peerId: string) {
      return request<{ observe_me?: boolean | null; observe_others?: boolean | null }>(opts, "GET",
        `${ws(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/peers/${encodeURIComponent(peerId)}/config`);
    },
    messages(opts: HonchoClientOptions, workspaceId: string, sessionId: string, params: ListParams = {}) {
      return request<Page<ApiMessage>>(opts, "POST",
        `${ws(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/messages/list${listQuery(params)}`, listBody(params));
    },
    create(
      opts: HonchoClientOptions,
      workspaceId: string,
      body: {
        id: string;
        metadata?: Record<string, unknown>;
        configuration?: Record<string, unknown>;
        peers?: Record<string, { observe_me?: boolean | null; observe_others?: boolean | null }>;
      },
    ) {
      return request<ApiSession>(opts, "POST", `${ws(workspaceId)}/sessions`, body);
    },
    addMessages(
      opts: HonchoClientOptions,
      workspaceId: string,
      sessionId: string,
      messages: {
        peer_id: string;
        content: string;
        metadata?: Record<string, unknown>;
        configuration?: Record<string, unknown>;
        created_at?: string;
      }[],
    ) {
      return request<ApiMessage[]>(opts, "POST", `${ws(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/messages`, { messages });
    },
  },

  /** Keep the always-mounted shell from recreating a deleted active workspace. */
  queue: {
    status(opts: HonchoClientOptions, workspaceId: string) {
      return request<ApiQueueStatus>(opts, "GET", `${ws(workspaceId)}/queue/status`);
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
    query(
      opts: HonchoClientOptions,
      workspaceId: string,
      body: {
        query: string;
        top_k?: number;
        distance?: number;
        filters?: Record<string, unknown>;
      },
    ) {
      return request<ApiConclusion[]>(opts, "POST", `${ws(workspaceId)}/conclusions/query`, body);
    },
    delete(opts: HonchoClientOptions, workspaceId: string, conclusionId: string) {
      return request<void>(
        opts,
        "DELETE",
        `${ws(workspaceId)}/conclusions/${encodeURIComponent(conclusionId)}`,
      );
    },
    /** Honcho stores created conclusions as `explicit`, with new IDs. */
    create(
      opts: HonchoClientOptions,
      workspaceId: string,
      conclusions: { content: string; observer_id: string; observed_id: string; session_id?: string | null }[],
    ) {
      return request<ApiConclusion[]>(opts, "POST", `${ws(workspaceId)}/conclusions`, { conclusions });
    },
  },

  compatibility: {
    /**
     * Probe the smallest scopes response without invoking the SDK's workspace
     * get-or-create behavior. Used only when OpenAPI has no comparable version.
     */
    probeScopes(opts: HonchoClientOptions, workspaceId: string) {
      return request<Page<ApiScope>>(
        opts,
        "POST",
        `${ws(workspaceId)}/scopes/list?page=1&size=1`,
      );
    },
  },

  /** Gap: SDK session(id) get-or-creates the session even for message reads. */
  messages: {
    async get(opts: HonchoClientOptions, workspaceId: string, sessionId: string, messageId: string) {
      const message = await request<ApiMessage>(opts, "GET",
        `${ws(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}`);
      if (!message || typeof message.content !== "string") throw new Error("Invalid message response from Honcho");
      return message;
    },
  },

  /**
   * Integration gap: SDK multipart uploads omit `defaultHeaders`, so they
   * cannot identify the selected upstream through our multi-instance proxy.
   */
  sessionFiles: {
    upload(
      opts: HonchoClientOptions,
      workspaceId: string,
      sessionId: string,
      body: {
        file: File;
        peerId: string;
        metadata?: Record<string, unknown>;
      },
    ) {
      const form = new FormData();
      form.append("file", body.file, body.file.name);
      form.append("peer_id", body.peerId);
      if (body.metadata) form.append("metadata", JSON.stringify(body.metadata));
      return requestMultipart<ApiMessage[]>(
        opts,
        `${ws(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/messages/upload`,
        form,
      );
    },
  },

  /**
   * Gap: the SDK has no key-minting call. Honcho 3.4 named-scope keys only; the
   * caller gates on the `scopeKeys` capability and the write-actions toggle.
   * Returns the key string so it never passes through query caches.
   */
  keys: {
    async createScoped(
      opts: HonchoClientOptions,
      input: { workspaceId: string; scopeId: string; expiresAt?: string },
    ): Promise<string> {
      return parseScopeKeyResponse(await request<unknown>(opts, "POST", scopeKeyPath(input)));
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
