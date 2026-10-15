import { currentAuthConfig, hasValidSession, NO_STORE } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `{enabled, authenticated}`. With auth disabled everyone is effectively
 * allowed, so `authenticated` is true; a misconfigured server reports false.
 */
export async function GET(req: Request) {
  const config = currentAuthConfig();
  if (!config.enabled) {
    return Response.json({ enabled: false, authenticated: true }, { headers: NO_STORE });
  }
  const authenticated = config.ok && (await hasValidSession(req.headers, config.secret));
  return Response.json({ enabled: true, authenticated }, { headers: NO_STORE });
}
