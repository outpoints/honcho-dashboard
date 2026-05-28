import { NextRequest } from "next/server";
import {
  dbStats,
  dbThroughput,
  dbHeatmap,
  dbConclusionStats,
  dbSessionStats,
  dbRecentMessages,
  dbReasoningTasks,
  dbWebhookStats,
  dbPeerDetail,
} from "@/lib/operator/db";

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
  if (view === "messages") {
    const ws = req.nextUrl.searchParams.get("workspace_id");
    if (!ws) return Response.json({ available: false, reason: "workspace_id required" });
    const sessionId = req.nextUrl.searchParams.get("session_id") ?? undefined;
    const q = req.nextUrl.searchParams.get("q") ?? undefined;
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? 100);
    return Response.json(await dbRecentMessages(ws, { sessionId, q, limit }));
  }
  if (view === "reasoning") {
    const ws = req.nextUrl.searchParams.get("workspace_id");
    if (!ws) return Response.json({ available: false, reason: "workspace_id required" });
    const status = req.nextUrl.searchParams.get("status") ?? undefined;
    const taskType = req.nextUrl.searchParams.get("task_type") ?? undefined;
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? 150);
    return Response.json(await dbReasoningTasks(ws, { status, taskType, limit }));
  }
  if (view === "webhooks") {
    const ws = req.nextUrl.searchParams.get("workspace_id");
    if (!ws) return Response.json({ available: false, reason: "workspace_id required" });
    return Response.json(await dbWebhookStats(ws));
  }
  if (view === "peer_detail") {
    const ws = req.nextUrl.searchParams.get("workspace_id");
    const peer = req.nextUrl.searchParams.get("peer_id");
    if (!ws || !peer) return Response.json({ available: false, reason: "workspace_id and peer_id required" });
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? 12);
    return Response.json(await dbPeerDetail(ws, peer, limit));
  }
  return Response.json(await dbStats());
}
