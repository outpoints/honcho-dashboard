import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/server";
import { diagnose } from "@/lib/operator/diagnostics";
import { resolveHonchoTarget } from "@/lib/honcho/allowlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await requireSession(req);
  if (denied) return denied;
  const resolved = resolveHonchoTarget(req.headers);
  if (!resolved.ok) {
    return Response.json({ detail: resolved.reason }, { status: resolved.status });
  }
  return Response.json(await diagnose(resolved.baseUrl, resolved.token));
}
