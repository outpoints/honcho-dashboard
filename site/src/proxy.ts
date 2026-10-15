import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isGuardedPath } from "@/lib/auth/guard";
import { currentAuthConfig, hasValidSession, NO_STORE } from "@/lib/auth/server";

/**
 * Optional password guard (Next.js 16 `proxy`, formerly `middleware`).
 *
 * No-op unless `DASHBOARD_PASSWORD` is set. When it is, API routes and the
 * `/v3/*`, `/health`, `/openapi.json` passthroughs require the signed session
 * cookie; the page itself loads so the client can render the login screen.
 *
 * This file runs before `next.config.ts` rewrites, so the matcher lists the
 * rewritten public paths explicitly. Keep it free of Node-only imports.
 */
export async function proxy(request: NextRequest) {
  const config = currentAuthConfig();
  if (!config.enabled) return NextResponse.next();
  if (!isGuardedPath(request.nextUrl.pathname)) return NextResponse.next();

  if (!config.ok) {
    return Response.json({ error: config.error }, { status: 500, headers: NO_STORE });
  }
  if (await hasValidSession(request.headers, config.secret)) return NextResponse.next();

  return Response.json(
    { error: "authentication required" },
    { status: 401, headers: NO_STORE },
  );
}

export const config = {
  matcher: ["/api/:path*", "/v3/:path*", "/health", "/openapi.json"],
};
