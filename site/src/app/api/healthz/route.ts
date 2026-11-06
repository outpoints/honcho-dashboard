export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Unauthenticated liveness probe for container health checks. */
export function GET() {
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
