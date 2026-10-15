/**
 * Server-side gate for the dashboard's only database writes (queue retry).
 *
 * Pure and dependency-free so it can be unit-tested outside Next. Default is
 * disabled: writes run only when HONCHO_OPERATOR_WRITES is explicitly truthy.
 */
export const OPERATOR_WRITES_ENV = "HONCHO_OPERATOR_WRITES";

export const OPERATOR_WRITES_DISABLED_REASON =
  "operator writes are disabled; set HONCHO_OPERATOR_WRITES=true to allow retrying reasoning tasks";

const TRUTHY = new Set(["1", "true", "yes"]);

export function operatorWritesEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env[OPERATOR_WRITES_ENV];
  if (typeof raw !== "string") return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}

export const CROSS_SITE_REJECTED_REASON = "cross-site request rejected";

function forbidden(reason: string): Response {
  return Response.json({ ok: false, reason }, { status: 403 });
}

/**
 * Route guard: null when writes are enabled, otherwise a ready-to-return 403.
 * Call it first in every mutating handler.
 */
export function requireOperatorWrites(
  env: Record<string, string | undefined> = process.env,
): Response | null {
  return operatorWritesEnabled(env) ? null : forbidden(OPERATOR_WRITES_DISABLED_REASON);
}

/**
 * CSRF check for bodyless POSTs that carry no custom header. Browsers send
 * Sec-Fetch-Site (and Origin on cross-origin POSTs). Sec-Fetch-Site decides when
 * present; Origin is compared with Host/X-Forwarded-Host only when it is absent; non-browser clients such
 * as curl send neither and are allowed, since CSRF only concerns browsers.
 */
export function isSameOriginRequest(headers: Headers, requestUrl: string): boolean {
  // Sec-Fetch-Site is set by the browser and cannot be forged by page script, and
  // it stays correct behind proxies that rewrite Host. Decide on it alone.
  const site = headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin" || site === "none";

  // Older browsers: fall back to comparing Origin with the Host we were reached on.
  const origin = headers.get("origin");
  if (origin !== null) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return false; // includes the opaque "null" origin
    }
    const hosts = [headers.get("host"), headers.get("x-forwarded-host")]
      .filter((h): h is string => !!h)
      .map((h) => h.split(",")[0].trim());
    if (hosts.length === 0) {
      try {
        hosts.push(new URL(requestUrl).host);
      } catch {
        return false;
      }
    }
    if (!hosts.includes(originHost)) return false;
  }
  return true;
}

/** Route guard: null for same-origin/non-browser requests, otherwise a 403. */
export function requireSameOrigin(headers: Headers, requestUrl: string): Response | null {
  return isSameOriginRequest(headers, requestUrl) ? null : forbidden(CROSS_SITE_REJECTED_REASON);
}
