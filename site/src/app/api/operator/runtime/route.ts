import { requireSession } from "@/lib/auth/server";
import { runtimeInfo } from "@/lib/operator/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireSession(req);
  if (denied) return denied;
  return Response.json(runtimeInfo());
}
