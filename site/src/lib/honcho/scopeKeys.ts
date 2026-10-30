/**
 * Honcho 3.4 named-scope API keys (`POST /v3/keys?workspace_id=…&scope_id=…`).
 *
 * The key is a stateless JWT bound to one workspace and one named scope, with
 * the dedicated `honcho:named-scope` audience. Older servers reject that
 * audience, so a mixed or rolled-back fleet refuses the key instead of
 * widening it. Minting needs an admin key and `AUTH_USE_AUTH=true`.
 *
 * The dashboard shows a minted key once and never stores, logs, or toasts it.
 */
import { HonchoApiError } from "./types.ts";

export type ScopeKeyExpiry = "24h" | "7d" | "30d" | "90d" | "never";

export const SCOPE_KEY_EXPIRY_OPTIONS: { value: ScopeKeyExpiry; label: string }[] = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "never", label: "no expiry" },
];

const HOURS: Record<Exclude<ScopeKeyExpiry, "never">, number> = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
  "90d": 24 * 90,
};

/** ISO timestamp for the chosen preset, or undefined for a key without `exp`. */
export function scopeKeyExpiresAt(preset: ScopeKeyExpiry, now: Date = new Date()): string | undefined {
  if (preset === "never") return undefined;
  return new Date(now.getTime() + HOURS[preset] * 3_600_000).toISOString();
}

/** Same name rule the dashboard uses when creating scopes. */
const SCOPE_NAME = /^[A-Za-z0-9_-]+$/;

export function scopeKeyPath(input: { workspaceId: string; scopeId: string; expiresAt?: string }): string {
  const workspaceId = input.workspaceId.trim();
  const scopeId = input.scopeId.trim();
  if (!workspaceId) throw new Error("A scope key needs a workspace");
  if (!SCOPE_NAME.test(scopeId)) throw new Error("A scope key needs an existing scope name");
  const query = new URLSearchParams({ workspace_id: workspaceId, scope_id: scopeId });
  if (input.expiresAt) {
    const at = Date.parse(input.expiresAt);
    if (!Number.isFinite(at)) throw new Error("Expiry is not a valid date");
    query.set("expires_at", new Date(at).toISOString());
  }
  return `/v3/keys?${query.toString()}`;
}

/** Accept only the documented `{ "key": "<jwt>" }` body. */
export function parseScopeKeyResponse(value: unknown): string {
  const key = value !== null && typeof value === "object" ? (value as { key?: unknown }).key : undefined;
  if (typeof key !== "string" || key.split(".").length !== 3) {
    throw new Error("Honcho returned an unexpected key response. No key was shown.");
  }
  return key;
}

/** Explain the expected refusals in operator terms; fall back to the server's detail. */
export function describeScopeKeyError(error: unknown): string {
  if (error instanceof HonchoApiError) {
    if (error.status === 405) {
      return "This server has authentication disabled (AUTH_USE_AUTH=false), so it does not mint keys. Every request is already allowed.";
    }
    if (error.status === 401 || error.status === 403) {
      return "Minting keys needs an admin key. The token configured for this instance is not one.";
    }
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
