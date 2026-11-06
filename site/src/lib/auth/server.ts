/**
 * Server-side glue shared by the proxy (guard), the `/api/auth/*` routes and
 * the data route handlers. Only Web APIs and the pure auth modules are used,
 * so it stays free of Node-only imports (`node:crypto`, `fs`, `pg`).
 */
import { readAuthConfig, type AuthConfig } from "./config.ts";
import { AUTH_REQUIRED_HEADER, AUTH_REQUIRED_VALUE } from "./constants.ts";
import { isCrossSiteWrite } from "./guard.ts";
import { SESSION_COOKIE_NAME, parseCookie, verifySession, type SessionParams } from "./session.ts";

// The proxy and each route are bundled separately, so a module-level flag would
// log once per bundle. A global keeps it to one line per process.
const LOGGED_FLAG = "__honchoDashboardAuthConfigErrorLogged";

/** Read the auth config from the live environment; log a misconfiguration once. */
export function currentAuthConfig(): AuthConfig {
  const config = readAuthConfig(process.env);
  const flags = globalThis as unknown as Record<string, boolean | undefined>;
  if (config.enabled && !config.ok && !flags[LOGGED_FLAG]) {
    flags[LOGGED_FLAG] = true;
    console.error(`[auth] ${config.error}`);
  }
  return config;
}

/** True when the request carries a session cookie that is valid under the current config. */
export async function hasValidSession(
  headers: { get(name: string): string | null },
  session: SessionParams,
): Promise<boolean> {
  const token = parseCookie(headers.get("cookie"), SESSION_COOKIE_NAME);
  return verifySession(session, token);
}

export const NO_STORE = { "cache-control": "no-store" } as const;

export function authRequiredResponse(): Response {
  return Response.json(
    { error: "authentication required" },
    { status: 401, headers: { ...NO_STORE, [AUTH_REQUIRED_HEADER]: AUTH_REQUIRED_VALUE } },
  );
}

/** The slice of `Request` the guards need (`Request` and `NextRequest` both fit). */
export interface GuardedRequest {
  method: string;
  headers: { get(name: string): string | null };
}

/**
 * The 403 to send when `request` is a state-changing request that the browser
 * marks cross-site, or null. Callers decide whether auth is on.
 */
export function rejectCrossSiteWrite(request: GuardedRequest): Response | null {
  const h = request.headers;
  if (
    !isCrossSiteWrite({
      method: request.method,
      secFetchSite: h.get("sec-fetch-site"),
      origin: h.get("origin"),
      host: h.get("host"),
      forwardedHost: h.get("x-forwarded-host"),
    })
  ) {
    return null;
  }
  return Response.json({ error: "cross-site request rejected" }, { status: 403, headers: NO_STORE });
}

/**
 * Guard for data route handlers: the only guard for the Honcho proxy paths
 * (`/api/honcho`, `/v3`), which `proxy.ts` leaves out of its matcher so large
 * bodies are not buffered, and defense in depth for the other routes. Rejects
 * cross-site writes (403), then requests without a valid session (401, or 500
 * when auth is misconfigured). Returns the response to send, or null when the
 * caller may proceed (auth disabled, or an acceptable request with a session).
 * With auth disabled it does nothing at all.
 */
export async function requireSession(request: GuardedRequest): Promise<Response | null> {
  const config = currentAuthConfig();
  if (!config.enabled) return null;
  const crossSite = rejectCrossSiteWrite(request);
  if (crossSite) return crossSite;
  if (!config.ok) {
    return Response.json({ error: config.error }, { status: 500, headers: NO_STORE });
  }
  if (await hasValidSession(request.headers, config)) return null;
  return authRequiredResponse();
}
