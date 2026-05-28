"use client";

import Image from "next/image";
import { Icon, type IconName } from "@/components/icons";
import { NAV_ITEMS } from "@/lib/data";
import type { RouteKey } from "@/types/honcho";
import { cn } from "@/lib/utils";
import { WorkspaceSelector } from "@/components/WorkspaceSelector";
import { honcho } from "@/lib/honcho/client";
import { useActiveWorkspace } from "@/lib/honcho/config";
import { getSdk } from "@/lib/honcho/sdk";
import { toApiQueueStatus } from "@/lib/honcho/adapters";
import { useHonchoQuery } from "@/lib/honcho/useQuery";
import type { ApiQueueStatus } from "@/lib/honcho/types";

export interface SidebarProps {
  current: RouteKey;
  onNavigate: (key: RouteKey) => void;
}

export function Sidebar({ current, onNavigate }: SidebarProps) {
  const { workspaceId } = useActiveWorkspace();
  const health = useHonchoQuery("health", (o) => honcho.health(o), { refreshInterval: 15000 });
  const wsList = useHonchoQuery("workspaces/list?size=1", (o) =>
    honcho.workspaces.list(o, { size: 1 }),
  );
  const queue = useHonchoQuery<ApiQueueStatus>(
    workspaceId ? `sdk/workspaces/${workspaceId}/queue/status` : null,
    async (o) => toApiQueueStatus(await getSdk(o, workspaceId!).queueStatus()),
    { refreshInterval: 10000 },
  );

  const healthy = !health.error && health.data?.status === "ok";

  return (
    <aside className="hidden md:sticky md:top-0 md:h-screen md:self-start md:flex shrink-0 bg-surface border-r border-border flex-col w-48 relative z-10">
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between gap-3">
          <button className="flex items-center gap-2 text-left" onClick={() => onNavigate("overview")}>
            <div className="w-6 h-6 flex items-center justify-center overflow-hidden">
              <Image src="/images/honcho-logo.svg" alt="Honcho logo" width={24} height={24} className="w-full h-full object-contain" />
            </div>
            <div className="leading-tight">
              <div className="text-[11px] font-semibold tracking-wider">HONCHO</div>
              <div className="text-[8px] text-text-muted tracking-wider">SELF-HOSTED</div>
            </div>
          </button>
        </div>
      </div>

      <div className="px-3 py-2 border-b border-border">
        <div className="text-[9px] text-text-muted uppercase tracking-wider mb-1">workspace</div>
        <WorkspaceSelector />
      </div>

      <nav className="flex-1 py-2 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const isActive = item.key === current;
          return (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors relative",
                isActive
                  ? "text-accent bg-accent/10"
                  : "text-text-muted hover:text-text-primary hover:bg-border/30",
              )}
            >
              <Icon name={item.icon as IconName} size={14} />
              <span className={cn("flex-1 text-left", isActive && "cursor-blink")}>
                {isActive ? `> ${item.label}` : item.label}
              </span>
              {isActive ? <span className="absolute right-0 top-0 bottom-0 w-0.5 bg-accent" /> : null}
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border">
        <div className="text-[10px] text-text-muted mb-2">&gt; instance_status</div>
        <div className="space-y-1">
          <Row label="status" value={
            health.isLoading ? (
              <span className="text-text-muted">…</span>
            ) : healthy ? (
              <span className="text-accent flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-accent" />
                healthy
              </span>
            ) : (
              <span className="text-red-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-red-400" />
                unreachable
              </span>
            )
          } />
          <Row label="workspaces" value={
            wsList.isLoading ? "…" : wsList.error ? "—" : String(wsList.data?.total ?? 0)
          } />
          <Row
            label="queue"
            value={
              !workspaceId ? (
                <span className="text-text-muted">—</span>
              ) : queue.isLoading ? (
                <span className="text-text-muted">…</span>
              ) : queue.error ? (
                <span className="text-text-muted">—</span>
              ) : (
                <span className="text-accent">{queue.data?.pending_work_units ?? 0}</span>
              )
            }
          />
        </div>
      </div>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between text-[10px]">
      <span className="text-text-muted">{label}</span>
      <span className="truncate text-right max-w-[60%]">{value}</span>
    </div>
  );
}
