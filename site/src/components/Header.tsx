"use client";

import { useEffect } from "react";
import { Icon } from "@/components/icons";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { RouteKey } from "@/types/honcho";
import { useNav } from "@/lib/nav";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";

export interface HeaderProps {
  current: RouteKey;
  onNavigate?: (key: RouteKey) => void;
}

export function Header({ current }: HeaderProps) {
  const { navigate } = useNav();
  const apiOpts = useActiveHonchoOptions();
  const { workspaceId } = useActiveWorkspace();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        navigate("search");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <header className="h-12 bg-surface border-b border-border flex items-center justify-between px-3 sm:px-4 relative gap-3 z-10">
        <div className="flex items-center gap-2 text-xs">
          <Icon name="terminal" className="text-accent shrink-0" size={14} />
          <button onClick={() => navigate("fleet")} className="text-text-muted hover:text-text-primary transition-colors duration-150">honcho</button>
          <span className="text-text-muted">/</span>
          <button onClick={() => navigate("workspaces")} className="text-text-muted hover:text-text-primary transition-colors duration-150">
            {workspaceId ?? "self-hosted"}
          </button>
          <span className="text-text-muted">/</span>
          <span className="text-accent">{current}</span>
        </div>

        <div className="flex-1 max-w-md mx-4">
          <button
            onClick={() => navigate("search")}
            className="w-full relative flex items-center gap-2 bg-void border border-border hover:border-border-light px-2.5 py-1.5 transition-colors duration-150 text-left"
          >
            <Icon name="search" className="text-text-muted shrink-0" size={12} />
            <span className="text-text-muted text-xs flex-1 whitespace-nowrap">
              search {workspaceId ? `in ${workspaceId}` : "workspace"}…
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-border text-[10px] text-text-muted leading-none">⌘</kbd>
              <kbd className="px-1.5 py-0.5 bg-border text-[10px] text-text-muted leading-none">K</kbd>
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden sm:flex text-[10px] text-text-muted font-mono">
            {apiOpts?.baseUrl ?? "no instance"}
          </span>
          <ThemeToggle />
        </div>
    </header>
  );
}
