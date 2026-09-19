import { readTraceFile } from "@/lib/operator/traceFile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await readTraceFile(process.env.HONCHO_TRACE_FILE), {
    headers: { "Cache-Control": "no-store" },
  });
}
