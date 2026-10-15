/**
 * Failed-login limiter, in memory and therefore per process: it is not shared
 * across replicas and resets on restart. Import-free so it is testable.
 *
 * Attempts are reserved *before* the request body is awaited and released when
 * the login succeeds, so a burst of concurrent slow requests cannot all slip
 * past the check.
 */

export const LOGIN_MAX_FAILURES = 10;
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
  private readonly maxFailures: number;
  private readonly windowMs: number;

  constructor(maxFailures: number = LOGIN_MAX_FAILURES, windowMs: number = LOGIN_WINDOW_MS) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
  }

  private recent(key: string, now: number): number[] {
    const kept = (this.attempts.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (kept.length === 0) this.attempts.delete(key);
    else this.attempts.set(key, kept);
    return kept;
  }

  /** Whether `key` is currently blocked (does not count an attempt). */
  check(key: string, now: number = Date.now()): LimitState {
    const kept = this.recent(key, now);
    if (kept.length < this.maxFailures) return { limited: false, retryAfterSeconds: 0 };
    const retryMs = kept[0] + this.windowMs - now;
    return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)) };
  }

  /**
   * Atomically check and count one attempt. Synchronous on purpose: call it
   * before the first `await` of the request. When not limited, the attempt is
   * recorded as a failure until `release()` is called (on success). When
   * limited, nothing is recorded.
   */
  reserve(key: string, now: number = Date.now()): Reservation {
    const state = this.check(key, now);
    if (state.limited) return { ...state, release: () => undefined };
    if (!this.attempts.has(key) && this.attempts.size >= MAX_TRACKED_KEYS) this.makeRoom(now);
    const list = this.recent(key, now);
    list.push(now);
    this.attempts.set(key, list);
    let released = false;
    return {
      ...state,
      release: () => {
        if (released) return;
        released = true;
        const current = this.attempts.get(key);
        if (!current) return;
        const i = current.indexOf(now);
        if (i >= 0) current.splice(i, 1);
        if (current.length === 0) this.attempts.delete(key);
      },
    };
  }

  /** Forget a client entirely. */
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
