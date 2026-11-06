/**
 * Failed-login limiter, in memory and therefore per process: it is not shared
 * across replicas and resets on restart. Import-free so it is testable.
 *
 * Two limits apply to every attempt, both over the same sliding window:
 *
 * - per client address: {@link LOGIN_MAX_FAILURES} failures;
 * - across all clients: {@link LOGIN_GLOBAL_MAX_FAILURES} failures. Without a
 *   reverse proxy the client picks its own `X-Forwarded-For`, so it can change
 *   its "address" on every request and never reach the per-client limit; the
 *   global limit bounds guessing regardless of what the headers say.
 *
 * Both are sliding windows: each failure stops counting after the window, so a
 * limit lifts on its own once the guessing stops. The price of a global limit
 * is that a sustained flood of bad attempts keeps everyone, the operator
 * included, locked out of *logging in* (existing sessions are unaffected). The
 * global number is three times the per-client one so a single client, which is
 * stopped at its own limit first, cannot lock the others out.
 *
 * Attempts are reserved *before* the request body is awaited and released when
 * the login succeeds, so a burst of concurrent slow requests cannot all slip
 * past the check.
 */

/** Failed logins allowed per client address within {@link LOGIN_WINDOW_MS}. */
export const LOGIN_MAX_FAILURES = 10;
/** Failed logins allowed across all clients within {@link LOGIN_WINDOW_MS}. */
export const LOGIN_GLOBAL_MAX_FAILURES = 30;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/** Hard cap on tracked clients so a flood of spoofed IPs cannot grow memory without bound. */
const MAX_TRACKED_KEYS = 10_000;

export interface LimitState {
  limited: boolean;
  /** Seconds until the oldest counted attempt leaves the window (0 when not limited). */
  retryAfterSeconds: number;
}

export interface Reservation extends LimitState {
  /** Pass to {@link LoginLimiter.release} when the attempt succeeded. */
  release: () => void;
}

export class LoginLimiter {
  private readonly attempts = new Map<string, number[]>();
  private globalAttempts: number[] = [];
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly globalMaxFailures: number;

  constructor(
    maxFailures: number = LOGIN_MAX_FAILURES,
    windowMs: number = LOGIN_WINDOW_MS,
    globalMaxFailures: number = LOGIN_GLOBAL_MAX_FAILURES,
  ) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.globalMaxFailures = globalMaxFailures;
  }

  private recent(key: string, now: number): number[] {
    const kept = (this.attempts.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (kept.length === 0) this.attempts.delete(key);
    else this.attempts.set(key, kept);
    return kept;
  }

  private recentGlobal(now: number): number[] {
    this.globalAttempts = this.globalAttempts.filter((t) => now - t < this.windowMs);
    return this.globalAttempts;
  }

  private blockedFor(kept: number[], max: number, now: number): number {
    if (kept.length < max) return 0;
    return Math.max(1, Math.ceil((kept[0] + this.windowMs - now) / 1000));
  }

  /** Whether `key` is currently blocked, per client or globally (does not count an attempt). */
  check(key: string, now: number = Date.now()): LimitState {
    const retryAfterSeconds = Math.max(
      this.blockedFor(this.recent(key, now), this.maxFailures, now),
      this.blockedFor(this.recentGlobal(now), this.globalMaxFailures, now),
    );
    return { limited: retryAfterSeconds > 0, retryAfterSeconds };
  }

  /**
   * Atomically check and count one attempt. Synchronous on purpose: call it
   * before the first `await` of the request. When not limited, the attempt is
   * recorded as a failure (for the client and globally) until `release()` is
   * called (on success). When limited, nothing is recorded.
   */
  reserve(key: string, now: number = Date.now()): Reservation {
    const state = this.check(key, now);
    if (state.limited) return { ...state, release: () => undefined };
    if (!this.attempts.has(key) && this.attempts.size >= MAX_TRACKED_KEYS) this.makeRoom(now);
    const list = this.recent(key, now);
    list.push(now);
    this.attempts.set(key, list);
    this.recentGlobal(now).push(now);
    let released = false;
    return {
      ...state,
      release: () => {
        if (released) return;
        released = true;
        const current = this.attempts.get(key);
        if (current) {
          const i = current.indexOf(now);
          if (i >= 0) current.splice(i, 1);
          if (current.length === 0) this.attempts.delete(key);
        }
        const g = this.globalAttempts.indexOf(now);
        if (g >= 0) this.globalAttempts.splice(g, 1);
      },
    };
  }

  /** Forget a client entirely (its share of the global count stays until it ages out). */
  reset(key: string): void {
    this.attempts.delete(key);
  }

  private makeRoom(now: number): void {
    for (const key of [...this.attempts.keys()]) this.recent(key, now);
    if (this.attempts.size >= MAX_TRACKED_KEYS) {
      // Still full of live entries: evict the oldest-inserted client.
      const oldest = this.attempts.keys().next().value;
      if (oldest !== undefined) this.attempts.delete(oldest);
    }
  }
}

/**
 * Client identity for the limiter.
 *
 * `X-Forwarded-For` is a list each proxy appends to; everything left of the
 * proxy's own entry is client-controlled and spoofable. So take the address
 * the trusted proxy appended: the `trustedProxies`-th entry from the right
 * (1 = last). Fall back to `x-real-ip`, then "unknown". This is only reliable
 * when the reverse proxy sets or appends the forwarded headers itself.
 */
export function clientKey(
  headers: { get(name: string): string | null },
  trustedProxies: number = 1,
): string {
  const hops = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  if (hops.length > 0) {
    const n = Math.max(1, Math.floor(trustedProxies));
    return hops[Math.max(0, hops.length - n)];
  }
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  return "unknown";
}
