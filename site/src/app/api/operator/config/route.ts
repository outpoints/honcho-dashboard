import { operatorConfig } from "@/lib/operator/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(operatorConfig());
}
