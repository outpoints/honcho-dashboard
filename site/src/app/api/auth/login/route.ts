import { LoginLimiter, clientKey } from "@/lib/auth/rateLimit";
import { currentAuthConfig, NO_STORE } from "@/lib/auth/server";
import { constantTimeEqual, isSecureRequest, sessionCookie, signSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-process state: not shared across replicas, reset on restart.
const limiter = new LoginLimiter();

export async function POST(req: Request) {
  const config = currentAuthConfig();
  if (!config.enabled) {
    return Response.json({ error: "authentication is not enabled" }, { status: 404, headers: NO_STORE });
  }
  if (!config.ok) {
    return Response.json({ error: config.error }, { status: 500, headers: NO_STORE });
  }

  const key = clientKey(req.headers);
  const limit = limiter.check(key);
  if (limit.limited) {
    return Response.json(
      { error: "too many failed attempts, try again later" },
      { status: 429, headers: { ...NO_STORE, "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  let password: unknown;
  try {
    password = ((await req.json()) as { password?: unknown } | null)?.password;
  } catch {
    password = undefined;
  }

  if (typeof password !== "string" || !(await constantTimeEqual(password, config.password))) {
    limiter.fail(key);
    return Response.json({ error: "invalid password" }, { status: 401, headers: NO_STORE });
  }

  limiter.reset(key);
  const token = await signSession(config.secret, config.ttlSeconds);
  const secure = isSecureRequest(req.headers.get("x-forwarded-proto"), new URL(req.url).protocol);
  return new Response(null, {
    status: 204,
    headers: { ...NO_STORE, "set-cookie": sessionCookie(token, config.ttlSeconds, secure) },
  });
}
