import { runtimeInfo } from "@/lib/operator/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(runtimeInfo());
}
