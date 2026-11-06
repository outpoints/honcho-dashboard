import { authStatusBody, NO_STORE } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `{enabled, authenticated, error?}`; see `authStatusBody`. */
export async function GET(req: Request) {
  return Response.json(await authStatusBody(req.headers), { headers: NO_STORE });
}
