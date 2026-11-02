/**
 * Connection settings for the operator database pool.
 *
 * Pure and dependency-free (no `pg`, no `server-only`) so it can be unit-tested
 * outside Next. When operator writes are off the pool is opened with the
 * Postgres startup option `-c default_transaction_read_only=on`, so the server
 * refuses writes even if application code ever tried one. When writes are on the
 * DSN is used as given.
 */

export const READ_ONLY_PG_OPTION = "-c default_transaction_read_only=on";

export interface OperatorPoolTarget {
  connectionString: string;
  /**
   * Only set when the DSN cannot carry the option itself (not parseable as a
   * URL). pg lets values inside the connection string override config values, so
   * for URL DSNs the option is merged into the string instead.
   */
  options?: string;
}

/** The DSN Honcho uses may be a SQLAlchemy-style `postgresql+psycopg://` URL. */
export function normalizeDsn(dsn: string): string {
  return dsn.replace(/^postgresql\+psycopg:\/\//, "postgresql://");
}

/** Append our setting after any `options` the DSN already has. Postgres applies
 * `-c` settings in order, so ours wins over a DSN that sets it to `off`. */
export function withReadOnlyOption(existing: string | null | undefined): string {
  const current = (existing ?? "").trim();
  if (!current) return READ_ONLY_PG_OPTION;
  if (current === READ_ONLY_PG_OPTION || current.endsWith(` ${READ_ONLY_PG_OPTION}`)) return current;
  return `${current} ${READ_ONLY_PG_OPTION}`;
}

export function operatorPoolTarget(dsn: string, writesEnabled: boolean): OperatorPoolTarget {
  const normalized = normalizeDsn(dsn);
  if (writesEnabled) return { connectionString: normalized };

  // Mirror pg-connection-string: a URL with credentials and an empty host
  // (`postgresql://u:p@/db?host=/socket`) only parses with a placeholder host.
  const PLACEHOLDER = "___DUMMY___";
  let url: URL;
  let placeholder = false;
  try {
    url = new URL(normalized);
  } catch {
    try {
      url = new URL(normalized.replace("@/", `@${PLACEHOLDER}/`));
      placeholder = true;
    } catch {
      // Not a URL DSN (e.g. the "/socket/dir dbname" form, which cannot carry
      // options). pg would reject anything else on its own.
      return { connectionString: normalized, options: READ_ONLY_PG_OPTION };
    }
  }
  url.searchParams.set("options", withReadOnlyOption(url.searchParams.get("options")));
  let out = url.toString();
  if (placeholder) out = out.replace(`@${PLACEHOLDER}/`, "@/");
  return { connectionString: out };
}
