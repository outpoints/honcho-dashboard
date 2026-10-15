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
