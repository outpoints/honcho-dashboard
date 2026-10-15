/**
 * Optional dashboard password login: environment parsing and validation.
 *
 * Pure on purpose (no Next imports, no `server-only`, no `process` access):
 * the caller passes the environment in, so the same rules run in the proxy
 * (middleware), in route handlers, and under `node:test`.
 *
 * Auth is opt-in. With no `DASHBOARD_PASSWORD` the feature is off and nothing
 * else here matters. With a password set, `DASHBOARD_SESSION_SECRET` is
 * mandatory: there is no default and it is never derived from the password.
 */

/** Minimum length of `DASHBOARD_SESSION_SECRET`, in characters. */
export const MIN_SECRET_LENGTH = 32;
/** Session lifetime when `DASHBOARD_SESSION_TTL_HOURS` is unset or invalid. */
export const DEFAULT_TTL_HOURS = 168;
/** Upper bound for the session lifetime (one year). */
export const MAX_TTL_HOURS = 24 * 365;

export const SECRET_ERROR_MESSAGE =
  "DASHBOARD_SESSION_SECRET must be set (>=32 chars) when DASHBOARD_PASSWORD is set";

export type AuthConfig =
  | { enabled: false }
  | { enabled: true; ok: false; error: string }
  | { enabled: true; ok: true; password: string; secret: string; ttlSeconds: number };

/**
 * Parse `DASHBOARD_SESSION_TTL_HOURS`. Anything that is not a positive finite
 * number falls back to the default; values above one year are clamped.
 */
export function parseTtlHours(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_TTL_HOURS;
  const trimmed = raw.trim();
  if (trimmed === "") return DEFAULT_TTL_HOURS;
  const hours = Number(trimmed);
  if (!Number.isFinite(hours) || hours <= 0) return DEFAULT_TTL_HOURS;
  return Math.min(hours, MAX_TTL_HOURS);
}

/** True when a password is configured (non-empty). The password is not trimmed. */
export function isAuthEnabled(env: Record<string, string | undefined>): boolean {
  const password = env.DASHBOARD_PASSWORD;
  return typeof password === "string" && password.length > 0;
}

/** Read and validate the auth configuration from an environment object. */
export function readAuthConfig(env: Record<string, string | undefined>): AuthConfig {
  if (!isAuthEnabled(env)) return { enabled: false };
  const secret = env.DASHBOARD_SESSION_SECRET;
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
    return { enabled: true, ok: false, error: SECRET_ERROR_MESSAGE };
  }
  return {
    enabled: true,
    ok: true,
    password: env.DASHBOARD_PASSWORD as string,
    secret,
    ttlSeconds: Math.round(parseTtlHours(env.DASHBOARD_SESSION_TTL_HOURS) * 3600),
  };
}
