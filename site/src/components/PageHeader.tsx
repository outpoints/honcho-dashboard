"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { honcho } from "@/lib/honcho/client";
import { useHonchoQuery } from "@/lib/honcho/useQuery";

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
  showClock?: boolean;
}

function useClock() {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const fmt = () => {
      const d = new Date();
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      setNow(`${hh}:${mm}:${ss}`);
    };
    fmt();
    const id = setInterval(fmt, 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function PageHeader({ title, subtitle, actions, className, showClock = true }: PageHeaderProps) {
  const now = useClock();
  // Real Honcho version from the connected instance (openapi `info.version`),
  // shared/cached across page headers. Falls back to hiding the badge when the
  // instance is unreachable or no version is reported.
  const versionQuery = useHonchoQuery("openapi-version", (o) => honcho.openapi(o), {
    refreshInterval: 0,
  });
  const version = versionQuery.data?.info?.version;
  return (
    <div className={cn("space-y-2 mb-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="font-pixel text-2xl text-text-primary tracking-wider">{title}</h1>
          {version ? (
            <span className="text-[10px] text-text-muted bg-border px-2 py-0.5">v{version}</span>
          ) : null}
          <span className="flex items-center gap-1 px-1.5 py-0.5 bg-accent/10 border border-accent/30">
            <span className="w-1.5 h-1.5 bg-accent" aria-hidden />
            <span className="text-[9px] text-accent uppercase tracking-wider">SELF-HOSTED</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          {actions}
          {showClock ? (
            <span className="font-pixel text-xl text-text-muted tracking-wider tabular-nums">
              {now || "--:--:--"}
            </span>
          ) : null}
        </div>
      </div>
      {subtitle ? (
        <p className="text-text-muted text-xs">&gt; {subtitle}</p>
      ) : null}
    </div>
  );
}
