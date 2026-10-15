/**
 * Failed-login limiter, in memory and therefore per process: it is not shared
 * across replicas and resets on restart. Import-free so it is testable.
 */

export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/** Hard cap on tracked clients so a flood of spoofed IPs cannot grow memory without bound. */
const MAX_TRACKED_KEYS = 10_000;

export interface LimitState {
  limited: boolean;
  /** Seconds until the oldest counted failure leaves the window (0 when not limited). */
  retryAfterSeconds: number;
}

export class LoginLimiter {
  private readonly failures = new Map<string, number[]>();
  private readonly maxFailures: number;
  private readonly windowMs: number;

  constructor(maxFailures: number = LOGIN_MAX_FAILURES, windowMs: number = LOGIN_WINDOW_MS) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
  }

  private recent(key: string, now: number): number[] {
    const kept = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (kept.length === 0) this.failures.delete(key);
    else this.failures.set(key, kept);
    return kept;
  }

  /** Whether `key` is currently blocked. */
  check(key: string, now: number = Date.now()): LimitState {
    const kept = this.recent(key, now);
    if (kept.length < this.maxFailures) return { limited: false, retryAfterSeconds: 0 };
    const retryMs = kept[0] + this.windowMs - now;
    return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)) };
  }

  /** Record a failed attempt. */
  fail(key: string, now: number = Date.now()): void {
    if (!this.failures.has(key) && this.failures.size >= MAX_TRACKED_KEYS) this.prune(now);
    if (!this.failures.has(key) && this.failures.size >= MAX_TRACKED_KEYS) {
      // Still full of live entries: evict the oldest-inserted client.
      const oldest = this.failures.keys().next().value;
      if (oldest !== undefined) this.failures.delete(oldest);
    }
    const kept = this.recent(key, now);
    kept.push(now);
    this.failures.set(key, kept);
  }

  /** Forget a client (after a successful login). */
  reset(key: string): void {
    this.failures.delete(key);
  }

  private prune(now: number): void {
    for (const key of [...this.failures.keys()]) this.recent(key, now);
  }
}

/** Client identity: first `x-forwarded-for` hop, else `x-real-ip`, else "unknown". */
export function clientKey(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0].trim();
  if (forwarded) return forwarded;
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  return "unknown";
}
