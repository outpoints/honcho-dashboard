import { NO_STORE } from "@/lib/auth/server";
import { clearedSessionCookie, isSecureRequest } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Clear the session cookie. Safe to call with or without a session. */
export function POST(req: Request) {
  const secure = isSecureRequest(req.headers.get("x-forwarded-proto"), new URL(req.url).protocol);
  return new Response(null, {
    status: 204,
    headers: { ...NO_STORE, "set-cookie": clearedSessionCookie(secure) },
  });
}
