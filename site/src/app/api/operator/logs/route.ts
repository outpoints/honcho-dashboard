import { NextRequest } from "next/server";
import { tailLogs } from "@/lib/operator/logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 200);
  return Response.json(await tailLogs(Number.isFinite(limit) ? limit : 200));
}
