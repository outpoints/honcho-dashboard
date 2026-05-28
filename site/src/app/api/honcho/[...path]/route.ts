import { NextRequest } from "next/server";
import { resolveHonchoTarget } from "@/lib/honcho/allowlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "cookie",
  "set-cookie",
]);

async function proxy(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const resolved = resolveHonchoTarget(req.headers);
  if (!resolved.ok) {
    return Response.json({ detail: resolved.reason }, { status: resolved.status });
  }
  const { path } = await ctx.params;
  const segments = (path ?? []).map(encodeURIComponent).join("/");
  if (!segments) {
    return Response.json({ detail: "Missing path" }, { status: 400 });
  }
  const search = req.nextUrl.search;
  const target = `${resolved.baseUrl}/${segments}${search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (HOP_BY_HOP.has(k)) return;
    if (k === "x-honcho-base-url" || k === "x-honcho-token") return;
    if (k.startsWith("x-forwarded-")) return;
    if (k === "origin" || k === "referer") return;
    headers.set(key, value);
  });

  if (resolved.token) headers.set("authorization", `Bearer ${resolved.token}`);

  const method = req.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Network error";
    return Response.json({ detail: `Upstream fetch failed: ${reason}` }, { status: 502 });
  }

  const respHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (HOP_BY_HOP.has(k)) return;
    if (k.startsWith("access-control-")) return;
    respHeaders.set(key, value);
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
