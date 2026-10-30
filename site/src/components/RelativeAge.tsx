"use client";

import { formatAge } from "@/lib/syncStatus";
import { useNow } from "@/lib/useNow";

/** "updated 12s ago". Owns its own 1s clock so the parent doesn't re-render every second. */
export function RelativeAge({ at, prefix = "updated" }: { at: number | undefined; prefix?: string }) {
  const now = useNow();
  return <>{prefix} {formatAge(at, now)}</>;
}
