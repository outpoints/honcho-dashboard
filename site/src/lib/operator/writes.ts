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

/**
 * Custom header the dashboard's own UI sends with every operator write. A
 * cross-origin page cannot attach a non-safelisted header without a CORS
 * preflight, and /api/operator/db never approves one (no OPTIONS handler, no
 * Access-Control-Allow-* headers), so requiring it blocks CSRF. It does not
 * depend on Origin, Host or Sec-Fetch-Site, so it also works on plain-HTTP
 * installs and behind proxies that rewrite Host.
 */
export const DASHBOARD_HEADER = "X-Honcho-Dashboard";
export const DASHBOARD_HEADER_VALUE = "1";

/** Headers the dashboard UI must send on every operator write. */
export const OPERATOR_WRITE_HEADERS: Record<string, string> = {
  [DASHBOARD_HEADER]: DASHBOARD_HEADER_VALUE,
};

export const DASHBOARD_HEADER_REQUIRED_REASON = `${DASHBOARD_HEADER}: ${DASHBOARD_HEADER_VALUE} header required`;

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

/** True only for the exact header value the dashboard UI sends. */
export function hasDashboardHeader(headers: Headers): boolean {
  return headers.get(DASHBOARD_HEADER) === DASHBOARD_HEADER_VALUE;
}

/**
 * CSRF guard for bodyless POSTs: null when the request carries
 * `X-Honcho-Dashboard: 1`, otherwise a ready-to-return 403. Scripts (curl)
 * must send the header too.
 */
export function requireDashboardHeader(headers: Headers): Response | null {
  return hasDashboardHeader(headers) ? null : forbidden(DASHBOARD_HEADER_REQUIRED_REASON);
}
