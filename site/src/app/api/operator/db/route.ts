import { NextRequest } from "next/server";
import { dbStats, dbThroughput, dbHeatmap, dbConclusionStats, dbSessionStats } from "@/lib/operator/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const view = req.nextUrl.searchParams.get("view") ?? "stats";
  if (view === "throughput") {
    const tf = (req.nextUrl.searchParams.get("timeframe") ?? "24H") as "1H" | "6H" | "24H" | "7D";
    return Response.json(await dbThroughput(tf));
  }
  if (view === "heatmap") {
    return Response.json(await dbHeatmap());
  }
  if (view === "conclusions") {
    const ws = req.nextUrl.searchParams.get("workspace_id") ?? undefined;
    return Response.json(await dbConclusionStats(ws));
  }
  if (view === "sessions") {
    const ws = req.nextUrl.searchParams.get("workspace_id") ?? undefined;
    return Response.json(await dbSessionStats(ws));
  }
  return Response.json(await dbStats());
}
