import { NextRequest } from "next/server";
import {
  dbStats,
  dbThroughput,
  dbHeatmap,
  dbConclusionStats,
  dbSessionStats,
  dbRecentMessages,
  dbReasoningTasks,
  dbRetryReasoningTask,
  dbRetryAllFailedReasoningTasks,
  dbWebhookStats,
  dbPeerDetail,
  dbPeerSummaries,
  dbQueueFailures,
} from "@/lib/operator/db";
import { requireOperatorWrites, requireSameOrigin } from "@/lib/operator/writes";

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
    const sp = req.nextUrl.searchParams;
    const sessionId = sp.get("session_id") ?? undefined;
    const peerId = sp.get("peer_id") ?? undefined;
    const q = sp.get("q") ?? undefined;
    const limit = Number(sp.get("limit") ?? 100);
    const beforeAt = sp.get("before_at");
    const beforeId = sp.get("before_id");
    const before = beforeAt && beforeId && !Number.isNaN(Date.parse(beforeAt)) ? { at: beforeAt, id: beforeId } : undefined;
    const afterAt = sp.get("after_at");
    const afterId = sp.get("after_id");
    const after = afterAt && afterId && !Number.isNaN(Date.parse(afterAt)) ? { at: afterAt, id: afterId } : undefined;
    return Response.json(await dbRecentMessages(ws, { sessionId, peerId, q, limit, before, after }));
  }
  if (view === "reasoning") {
    const ws = req.nextUrl.searchParams.get("workspace_id");
    if (!ws) return Response.json({ available: false, reason: "workspace_id required" });
    const status = req.nextUrl.searchParams.get("status") ?? undefined;
    const taskType = req.nextUrl.searchParams.get("task_type") ?? undefined;
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? 150);
    return Response.json(await dbReasoningTasks(ws, { status, taskType, limit }));
  }
  if (view === "queue_failures") {
    const ws = req.nextUrl.searchParams.get("workspace_id");
    if (!ws) return Response.json({ available: false, reason: "workspace_id required" });
    return Response.json(await dbQueueFailures(ws));
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
  if (view === "peer_summaries") {
    // Repeated `workspace_id` params scope the read; none means every workspace.
    const ids = req.nextUrl.searchParams.getAll("workspace_id").filter(Boolean).slice(0, 200);
    return Response.json(await dbPeerSummaries(ids.length ? ids : null));
  }
  return Response.json(await dbStats());
}

export async function POST(req: NextRequest) {
  // Checked before anything else: this is the only mutating endpoint, and the
  // client-side write toggle is not a security boundary.
  const disabled = requireOperatorWrites();
  if (disabled) return disabled;
  // Bodyless POST with no custom header: refuse cross-site browser requests (CSRF).
  const crossSite = requireSameOrigin(req.headers, req.url);
  if (crossSite) return crossSite;
  const action = req.nextUrl.searchParams.get("action");
  if (action === "retry_reasoning") {
    const ws = req.nextUrl.searchParams.get("workspace_id");
    const id = req.nextUrl.searchParams.get("id");
    if (!ws || !id) {
      return Response.json({ ok: false, reason: "workspace_id and id required" }, { status: 400 });
    }
    const result = await dbRetryReasoningTask(ws, id);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  }
  if (action === "retry_all_failed_reasoning") {
    const ws = req.nextUrl.searchParams.get("workspace_id");
    if (!ws) {
      return Response.json({ ok: false, reason: "workspace_id required" }, { status: 400 });
    }
    const result = await dbRetryAllFailedReasoningTasks(ws);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  }
  return Response.json({ ok: false, reason: "unknown action" }, { status: 400 });
}
