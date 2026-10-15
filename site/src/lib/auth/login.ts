/**
 * Login request handling, kept free of Next imports so the limiter behaviour
 * (including concurrent attempts) is testable under `node:test`.
 */
import type { AuthConfig } from "./config.ts";
import { clientKey, type LoginLimiter } from "./rateLimit.ts";
import { constantTimeEqual, isSecureRequest, sessionCookie, signSession } from "./session.ts";

const NO_STORE = { "cache-control": "no-store" } as const;

/** The slice of `Request` the login flow needs. */
export interface LoginRequest {
  url: string;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export async function processLogin(
  req: LoginRequest,
  config: AuthConfig,
  limiter: LoginLimiter,
  now: () => number = Date.now,
): Promise<Response> {
  if (!config.enabled) {
    return Response.json({ error: "authentication is not enabled" }, { status: 404, headers: NO_STORE });
  }
  if (!config.ok) {
    return Response.json({ error: config.error }, { status: 500, headers: NO_STORE });
  }

  // Reserve the attempt synchronously, before the first await, so concurrent
  // requests (slow bodies, parallel guesses) cannot all pass the check.
  const reservation = limiter.reserve(clientKey(req.headers, config.trustedProxies), now());
  if (reservation.limited) {
    return Response.json(
      { error: "too many failed attempts, try again later" },
      { status: 429, headers: { ...NO_STORE, "retry-after": String(reservation.retryAfterSeconds) } },
    );
  }

  let password: unknown;
  try {
    password = ((await req.json()) as { password?: unknown } | null)?.password;
  } catch {
    password = undefined;
  }

  if (typeof password !== "string" || !(await constantTimeEqual(password, config.password))) {
    return Response.json({ error: "invalid password" }, { status: 401, headers: NO_STORE });
  }

  reservation.release();
  const token = await signSession(config.secret, config.ttlSeconds, now());
  const secure = isSecureRequest(req.headers.get("x-forwarded-proto"), new URL(req.url).protocol);
  return new Response(null, {
    status: 204,
    headers: { ...NO_STORE, "set-cookie": sessionCookie(token, config.ttlSeconds, secure) },
  });
}
