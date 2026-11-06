/**
 * Server-side gate for the dashboard's only database writes (queue retry).
 *
 * Pure and dependency-free so it can be unit-tested outside Next. Default is
 * disabled: writes run only when HONCHO_OPERATOR_WRITES is explicitly truthy.
 */
import { DASHBOARD_HEADER, DASHBOARD_HEADER_VALUE } from "../auth/constants.ts";

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
 * installs and behind proxies that rewrite Host. The name lives in
 * `src/lib/auth/constants.ts` because the dashboard login guard honours the
 * same header.
 */
export { DASHBOARD_HEADER, DASHBOARD_HEADER_VALUE };

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

/**
 * What the UI knows about the server's write gate, from a `useOperatorQuery`
 * state for `/api/operator/runtime`. `error` wins over `data`: the hook keeps
 * the last good data after a failed refresh, and stale "on" must not enable the
 * retry buttons. Only a confirmed, error-free "on" enables them; the server
 * enforces the gate regardless.
 */
export function serverWriteGate(runtime: {
  data?: { writes_enabled?: boolean } | undefined;
  error?: unknown;
}): { enabled: boolean; hint: string | undefined } {
  if (runtime.error) {
    return { enabled: false, hint: "server write gate unknown (runtime probe failed)" };
  }
  if (!runtime.data) return { enabled: false, hint: "checking server write gate…" };
  if (runtime.data.writes_enabled === true) return { enabled: true, hint: undefined };
  return { enabled: false, hint: "server: HONCHO_OPERATOR_WRITES off" };
}
