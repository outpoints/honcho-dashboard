/**
 * Server-side glue shared by the proxy (guard), the `/api/auth/*` routes and
 * the data route handlers. Only Web APIs and the pure auth modules are used,
 * so it stays free of Node-only imports (`node:crypto`, `fs`, `pg`).
 */
import { readAuthConfig, type AuthConfig } from "./config";
import { AUTH_REQUIRED_HEADER, AUTH_REQUIRED_VALUE } from "./constants";
import { SESSION_COOKIE_NAME, parseCookie, verifySession } from "./session";

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

/** True when the request carries a valid, unexpired session cookie. */
export async function hasValidSession(
  headers: { get(name: string): string | null },
  secret: string,
): Promise<boolean> {
  const token = parseCookie(headers.get("cookie"), SESSION_COOKIE_NAME);
  return verifySession(secret, token);
}

export const NO_STORE = { "cache-control": "no-store" } as const;

export function authRequiredResponse(): Response {
  return Response.json(
    { error: "authentication required" },
    { status: 401, headers: { ...NO_STORE, [AUTH_REQUIRED_HEADER]: AUTH_REQUIRED_VALUE } },
  );
}

/**
 * Session check for data route handlers (defense in depth behind `proxy.ts`).
 * Returns the 401/500 response to send, or null when the caller may proceed
 * (auth disabled, or a valid session).
 */
export async function requireSession(request: {
  headers: { get(name: string): string | null };
}): Promise<Response | null> {
  const config = currentAuthConfig();
  if (!config.enabled) return null;
  if (!config.ok) {
    return Response.json({ error: config.error }, { status: 500, headers: NO_STORE });
  }
  if (await hasValidSession(request.headers, config.secret)) return null;
  return authRequiredResponse();
}
