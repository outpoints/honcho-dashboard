/**
 * Connection settings for the operator database pool.
 *
 * Pure and dependency-free (no `pg` at runtime, no `server-only`) so it can be
 * unit-tested outside Next. When operator writes are off the pool is opened with
 * the Postgres startup option `-c default_transaction_read_only=on`, so the
 * server refuses writes even if application code ever tried one. When writes are
 * on the DSN is used as given.
 *
 * Some poolers refuse startup options they do not track (PgBouncer before 1.26
 * rejects the connection with `unsupported startup parameter`). For those,
 * `withReadOnlyFallback` reopens the pool without the option and warns once, so
 * an upgrade never takes the operator panels down; the route gate still refuses
 * writes in code.
 */
import type { QueryResult, QueryResultRow } from "pg";

export const READ_ONLY_PG_OPTION = "-c default_transaction_read_only=on";

/** The slice of `pg.Pool` the operator modules use. */
export interface OperatorPool {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
  end(): Promise<void>;
}

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

/**
 * True for the error a pooler raises when it refuses a startup option it does
 * not know. Seen as `unsupported startup parameter: options` (PgBouncer 1.18) and
 * `unsupported startup parameter in options: default_transaction_read_only`
 * (PgBouncer 1.20 to 1.25), SQLSTATE 08P01 in both. Anything else, including a
 * connection refused or a bad password, is not this case.
 */
export function isUnsupportedStartupParameter(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { message, code } = err as { message?: unknown; code?: unknown };
  if (typeof message === "string" && /unsupported startup (parameter|option)/i.test(message)) return true;
  // Poolers word it differently; the protocol-violation SQLSTATE on a startup
  // option is the same refusal. Postgres itself never raises it for our option.
  return code === "08P01" && typeof message === "string" && /startup|option|parameter/i.test(message);
}

export const READ_ONLY_FALLBACK_WARNING =
  `HONCHO_DATABASE_URL: the server refused the read-only startup option (${READ_ONLY_PG_OPTION}); ` +
  "PgBouncer before 1.26 does this by default. Reconnected without it, so Postgres no longer " +
  "enforces read-only for the dashboard; writes are still refused in code while " +
  "HONCHO_OPERATOR_WRITES is off. To keep the enforcement, use PgBouncer 1.26+ or add " +
  "default_transaction_read_only to its track_extra_parameters.";

/**
 * Wrap a pool opened with the read-only startup option. The first query that
 * fails with `unsupported startup parameter` swaps in a pool from `openPlain()`
 * (the DSN as given) and retries once there; later queries go straight to it.
 * Concurrent failures share one swap and one warning. Any other error, before or
 * after the swap, propagates unchanged.
 */
export function withReadOnlyFallback(
  pool: OperatorPool,
  openPlain: () => OperatorPool,
  warn: (message: string) => void = (message) => console.warn(message),
): OperatorPool & { readonly fellBack: boolean } {
  let current = pool;
  let swapping: Promise<void> | null = null;

  const swap = async () => {
    const old = current;
    current = openPlain();
    warn(READ_ONLY_FALLBACK_WARNING);
    await old.end().catch(() => undefined);
  };

  return {
    get fellBack() {
      return swapping !== null;
    },
    async query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
      try {
        return await current.query<R>(text, values);
      } catch (err) {
        if (!isUnsupportedStartupParameter(err)) throw err;
        swapping ??= swap();
        await swapping;
        return current.query<R>(text, values);
      }
    },
    end: () => current.end(),
  };
}
