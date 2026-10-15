import { currentAuthConfig } from "@/lib/auth/server";
import { processLogin } from "@/lib/auth/login";
import { LoginLimiter } from "@/lib/auth/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-process state: not shared across replicas, reset on restart.
const limiter = new LoginLimiter();

export function POST(req: Request) {
  return processLogin(req, currentAuthConfig(), limiter);
}
