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
/** Lower bound for the session lifetime: shorter values are clamped up to one minute. */
export const MIN_TTL_SECONDS = 60;
/** Reverse proxies assumed in front of the dashboard when `DASHBOARD_TRUSTED_PROXIES` is unset. */
export const DEFAULT_TRUSTED_PROXIES = 1;
/** Upper bound for `DASHBOARD_TRUSTED_PROXIES`. */
export const MAX_TRUSTED_PROXIES = 10;

export const SECRET_ERROR_MESSAGE =
  "DASHBOARD_SESSION_SECRET must be set (>=32 chars) when DASHBOARD_PASSWORD is set";

export type AuthConfig =
  | { enabled: false }
  | { enabled: true; ok: false; error: string }
  | {
      enabled: true;
      ok: true;
      password: string;
      secret: string;
      ttlSeconds: number;
      /** Number of reverse proxies appending to `X-Forwarded-For` (for the login limiter). */
      trustedProxies: number;
    };

/**
 * Parse `DASHBOARD_SESSION_TTL_HOURS`. Anything that is not a positive finite
 * number falls back to the default; values above one year are clamped, and
 * values below one minute are raised to one minute (a session that expires
 * before the next request is never useful).
 */
export function parseTtlHours(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_TTL_HOURS;
  const trimmed = raw.trim();
  if (trimmed === "") return DEFAULT_TTL_HOURS;
  const hours = Number(trimmed);
  if (!Number.isFinite(hours) || hours <= 0) return DEFAULT_TTL_HOURS;
  return Math.min(Math.max(hours, MIN_TTL_SECONDS / 3600), MAX_TTL_HOURS);
}

/**
 * Parse `DASHBOARD_TRUSTED_PROXIES`: a whole number from 1 to 10. Anything
 * else falls back to 1 (the address appended by the nearest proxy).
 */
export function parseTrustedProxies(raw: string | undefined): number {
  const trimmed = raw?.trim() ?? "";
  if (!/^[0-9]{1,3}$/.test(trimmed)) return DEFAULT_TRUSTED_PROXIES;
  const n = Number(trimmed);
  if (n < 1) return DEFAULT_TRUSTED_PROXIES;
  return Math.min(n, MAX_TRUSTED_PROXIES);
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
    ttlSeconds: Math.max(
      MIN_TTL_SECONDS,
      Math.round(parseTtlHours(env.DASHBOARD_SESSION_TTL_HOURS) * 3600),
    ),
    trustedProxies: parseTrustedProxies(env.DASHBOARD_TRUSTED_PROXIES),
  };
}
