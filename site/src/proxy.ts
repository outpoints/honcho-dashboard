import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isGuardedPath } from "@/lib/auth/guard";
import {
  NO_STORE,
  authRequiredResponse,
  currentAuthConfig,
  hasValidSession,
  rejectCrossSiteWrite,
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
 * file before them, and `isGuardedPath` compares lowercased.
 *
 * The matcher deliberately leaves out `/api/honcho` and `/v3` (the SDK entry
 * that is rewritten to `/api/honcho/v3`). Next buffers only the first 10 MB
 * of the body of any path a proxy matches
 * (`experimental.proxyClientMaxBodySize`) and truncates the rest silently,
 * even when the proxy just returns `next()`, which would corrupt large Honcho
 * uploads. Those paths are guarded by `requireSession` in the Honcho proxy
 * route handler instead, which also runs the CSRF check and fails closed. The
 * exclusions are spelled case-insensitively because the rewrites are, so a
 * `/V3/...` upload is not buffered either; the handler is the only way to
 * reach the upstream, so no spelling skips the guard.
 *
 * Do not add a path to this matcher that carries large bodies. Keep this file
 * free of Node-only imports.
 */
export async function proxy(request: NextRequest) {
  const config = currentAuthConfig();
  if (!config.enabled) return NextResponse.next();

  const { pathname } = request.nextUrl;
  const h = request.headers;

  if (isGuardedPath(pathname) || pathname.toLowerCase().startsWith("/api/auth/")) {
    const crossSite = rejectCrossSiteWrite(request);
    if (crossSite) return crossSite;
  }

  if (!isGuardedPath(pathname)) return NextResponse.next();

  if (!config.ok) {
    return Response.json({ error: config.error }, { status: 500, headers: NO_STORE });
  }
  if (await hasValidSession(h, config.secret)) return NextResponse.next();
  return authRequiredResponse();
}

export const config = {
  // Everything except Next internals, the favicon and the two Honcho proxy
  // entries (see above; the classes spell `api/honcho` and `v3` in any case).
  matcher: [
    "/((?!_next/|favicon\\.ico$|[aA][pP][iI]/[hH][oO][nN][cC][hH][oO](?:/|$)|[vV]3(?:/|$)).*)",
  ],
};
