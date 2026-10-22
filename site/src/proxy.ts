import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isCrossSiteWrite, isGuardedPath } from "@/lib/auth/guard";
import {
  NO_STORE,
  authRequiredResponse,
  currentAuthConfig,
  hasValidSession,
} from "@/lib/auth/server";

/**
 * Optional password guard (Next.js 16 `proxy`, formerly `middleware`).
 *
 * No-op unless `DASHBOARD_PASSWORD` is set. When it is, API routes and the
 * `/v3/*`, `/health`, `/openapi.json` passthroughs require the signed session
 * cookie; the page itself loads so the client can render the login screen.
 * State-changing requests that browsers mark cross-site are rejected.
 *
 * Next applies the `next.config.ts` rewrites case-insensitively and runs this
 * file before them, so the matcher covers every path except Next internals and
 * the favicon, and `isGuardedPath` compares lowercased. Each data route
 * handler also calls `requireSession`, so a path this file misses still fails
 * closed. Keep this file free of Node-only imports.
 */
export async function proxy(request: NextRequest) {
  const config = currentAuthConfig();
  if (!config.enabled) return NextResponse.next();

  const { pathname } = request.nextUrl;
  const h = request.headers;

  if (
    (isGuardedPath(pathname) || pathname.toLowerCase().startsWith("/api/auth/")) &&
    isCrossSiteWrite({
      method: request.method,
      secFetchSite: h.get("sec-fetch-site"),
      origin: h.get("origin"),
      host: h.get("host"),
      forwardedHost: h.get("x-forwarded-host"),
    })
  ) {
    return Response.json({ error: "cross-site request rejected" }, { status: 403, headers: NO_STORE });
  }

  if (!isGuardedPath(pathname)) return NextResponse.next();

  if (!config.ok) {
    return Response.json({ error: config.error }, { status: 500, headers: NO_STORE });
  }
  if (await hasValidSession(h, config.secret)) return NextResponse.next();
  return authRequiredResponse();
}

export const config = {
  // Everything except Next internals and the favicon (case-insensitive paths
  // are handled in isGuardedPath, so do not narrow this to specific prefixes).
  matcher: ["/((?!_next/|favicon\\.ico$).*)"],
};
