"use client";

import Image from "next/image";
import { Icon, type IconName } from "@/components/icons";
import { NAV_ITEMS } from "@/lib/data";
import type { RouteKey } from "@/types/honcho";
import { cn } from "@/lib/utils";

export interface SidebarProps {
  current: RouteKey;
  onNavigate: (key: RouteKey) => void;
}

export function Sidebar({ current, onNavigate }: SidebarProps) {
  return (
    <aside className="hidden md:sticky md:top-0 md:h-screen md:self-start md:flex shrink-0 bg-surface border-r border-border flex-col w-48 relative z-10">
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between gap-3">
          <button className="flex items-center gap-2 text-left">
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
                  : "text-text-muted hover:text-text-primary hover:bg-border/30"
              )}
            >
              <Icon name={item.icon as IconName} size={14} />
              <span className={cn("flex-1 text-left", isActive && "cursor-blink")}>
                {isActive ? `> ${item.label}` : item.label}
              </span>
              {item.badge ? (
                <span className="ml-auto text-[10px] bg-accent/20 text-accent px-1.5 py-0.5">
                  {item.badge}
                </span>
              ) : null}
              {isActive ? (
                <span className="absolute right-0 top-0 bottom-0 w-0.5 bg-accent" />
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border">
        <div className="text-[10px] text-text-muted mb-2">&gt; instance_status</div>
        <div className="space-y-1">
          <div className="flex justify-between text-[10px]">
            <span className="text-text-muted">status</span>
            <span className="text-accent flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-accent" />
              healthy
            </span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-text-muted">peers</span>
            <span>1,304</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-text-muted">queue</span>
            <span className="text-accent">4</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-text-muted">version</span>
            <span>v3.0.5</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
