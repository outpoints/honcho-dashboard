/**
 * Which requests the auth guard protects. Pure and import-free so the rules
 * are testable and safe for the proxy bundle.
 *
 * Page requests (`/`) are deliberately not guarded: the page holds no data and
 * must load so the client can render the login screen. Everything that returns
 * data is an API route, a rewrite to the Honcho proxy, or the Honcho health
 * and OpenAPI passthroughs.
 *
 * Paths are compared lowercased: Next.js applies the `next.config.ts` rewrites
 * (`/v3/*`, `/health`, `/openapi.json`) case-insensitively, so `/V3/...` and
 * `/HEALTH` reach the Honcho proxy and must be guarded like their lowercase
 * forms. Exempt paths are lowercased too; none of them is a rewrite source or
 * serves data, so treating `/API/Healthz` as exempt is harmless.
 */

/** Paths that must stay reachable without a session. */
const EXEMPT_EXACT = new Set(["/api/healthz", "/favicon.ico"]);
const EXEMPT_PREFIXES = ["/api/auth/", "/_next/"];

function normalize(pathname: string): string {
  // Lowercase, collapse duplicate slashes, drop trailing slashes (not the root).
  const collapsed = pathname.toLowerCase().replace(/\/{2,}/g, "/");
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, "") : collapsed;
}

/** True when the path is exempt from authentication. */
export function isExemptPath(pathname: string): boolean {
  const p = normalize(pathname);
  if (EXEMPT_EXACT.has(p)) return true;
  return EXEMPT_PREFIXES.some((prefix) => p.startsWith(prefix));
}

/** True when the path serves data and needs a valid session when auth is on. */
export function isGuardedPath(pathname: string): boolean {
  const p = normalize(pathname);
  if (isExemptPath(p)) return false;
  return (
    p === "/api" ||
    p.startsWith("/api/") ||
    p === "/v3" ||
    p.startsWith("/v3/") ||
    p === "/health" ||
    p === "/openapi.json"
  );
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface CrossSiteInput {
  method: string;
  secFetchSite?: string | null;
  origin?: string | null;
  host?: string | null;
  forwardedHost?: string | null;
}

/**
 * CSRF check for state-changing methods. Returns true when the request should
 * be rejected as cross-site.
 *
 * - `Sec-Fetch-Site` present: only `same-origin` and `none` pass (`same-site`
 *   is a different origin and is rejected).
 * - Else `Origin` present: its host must equal `X-Forwarded-Host` (first
 *   value) or `Host`.
 * - Neither header (curl, server-to-server): passes. The cookie is
 *   `SameSite=Lax`, so browsers do not attach it to cross-site POSTs anyway;
 *   this is a second layer.
 */
export function isCrossSiteWrite(input: CrossSiteInput): boolean {
  if (!UNSAFE_METHODS.has(input.method.toUpperCase())) return false;
  const site = input.secFetchSite?.trim().toLowerCase();
  if (site) return site !== "same-origin" && site !== "none";
  const origin = input.origin?.trim();
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return true; // "null" or unparsable
  }
  const allowed = [input.forwardedHost?.split(",")[0], input.host]
    .map((h) => h?.trim().toLowerCase())
    .filter((h): h is string => !!h);
  return !allowed.includes(originHost);
}
