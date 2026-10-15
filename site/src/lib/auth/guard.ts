/**
 * Which request paths the auth guard protects. Pure and import-free so the
 * rules are testable and safe for the proxy (Edge-compatible) bundle.
 *
 * Page requests (`/`) are deliberately not guarded: the page holds no data and
 * must load so the client can render the login screen. Everything that returns
 * data is an API route, a rewrite to the Honcho proxy, or the Honcho health
 * and OpenAPI passthroughs.
 */

/** API paths that must stay reachable without a session. */
const EXEMPT_EXACT = new Set(["/api/healthz"]);
const EXEMPT_PREFIXES = ["/api/auth/", "/_next/"];
const EXEMPT_FILES = new Set(["/favicon.ico"]);

function normalize(pathname: string): string {
  // Collapse duplicate slashes and drop trailing slashes (not the root).
  const collapsed = pathname.replace(/\/{2,}/g, "/");
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, "") : collapsed;
}

/** True when the path is exempt from authentication. */
export function isExemptPath(pathname: string): boolean {
  const p = normalize(pathname);
  if (EXEMPT_EXACT.has(p) || EXEMPT_FILES.has(p)) return true;
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
