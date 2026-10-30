"use client";

import { useEffect, useState } from "react";

/** Current time, re-read every `intervalMs`, so relative ages ("12s ago") stay true. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
