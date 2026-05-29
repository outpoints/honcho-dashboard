"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { GridCanvas } from "@/components/GridCanvas";
import { Icon } from "@/components/icons";
import { NAV_ITEMS } from "@/lib/data";
import type { RouteKey } from "@/types/honcho";
import { cn } from "@/lib/utils";

import { OverviewPage } from "@/components/pages/OverviewPage";
import { FleetPage } from "@/components/pages/FleetPage";
import { WorkspacesPage } from "@/components/pages/WorkspacesPage";
import { PeersPage } from "@/components/pages/PeersPage";
import { SessionsPage } from "@/components/pages/SessionsPage";
import { MessagesPage } from "@/components/pages/MessagesPage";
import { ReasoningPage } from "@/components/pages/ReasoningPage";
import { ContextPage } from "@/components/pages/ContextPage";
import { WebhooksPage } from "@/components/pages/WebhooksPage";
import { InstancePage } from "@/components/pages/InstancePage";
import { DiagnosticsPage } from "@/components/pages/DiagnosticsPage";
import { IntegrationsPage } from "@/components/pages/IntegrationsPage";
import { ConfigPage } from "@/components/pages/ConfigPage";
import { NavContext } from "@/lib/nav";
import { ToastProvider } from "@/components/toast";

const RENDER: Record<RouteKey, React.ComponentType> = {
  overview: OverviewPage,
  fleet: FleetPage,
  workspaces: WorkspacesPage,
  peers: PeersPage,
  sessions: SessionsPage,
  messages: MessagesPage,
  reasoning: ReasoningPage,
  context: ContextPage,
  webhooks: WebhooksPage,
  instance: InstancePage,
  diagnostics: DiagnosticsPage,
  integrations: IntegrationsPage,
  config: ConfigPage,
};

function readHashRoute(): RouteKey {
  if (typeof window === "undefined") return "fleet";
  const raw = window.location.hash.replace(/^#\/?/, "").split(/[?&]/)[0];
  return (NAV_ITEMS.find((n) => n.key === raw)?.key as RouteKey) || "fleet";
}

function subscribeHash(notify: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
}

const SERVER_HASH: RouteKey = "fleet";

export function AppShell() {
  const current = useSyncExternalStore<RouteKey>(
    subscribeHash,
    readHashRoute,
    () => SERVER_HASH,
  );
  const [menuOpen, setMenuOpen] = useState(false);

  const onNavigate = useCallback((key: RouteKey) => {
    if (typeof window !== "undefined") {
      window.location.hash = `#/${key}`;
    }
    setMenuOpen(false);
  }, []);

  const Page = RENDER[current] ?? FleetPage;

  return (
    <NavContext.Provider value={{ navigate: onNavigate, current }}>
    <ToastProvider>
    <div className="min-h-screen flex">
      <GridCanvas />
      <Sidebar current={current} onNavigate={onNavigate} />
      <MobileDrawer current={current} onNavigate={onNavigate} open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        <MobileTopBar onMenu={() => setMenuOpen(true)} />
        <Header current={current} />
        <main className="flex-1 p-3 sm:p-4 overflow-auto">
          <Page />
        </main>
      </div>
    </div>
    </ToastProvider>
    </NavContext.Provider>
  );
}

function MobileTopBar({ onMenu }: { onMenu: () => void }) {
  return (
    <div className="md:hidden flex items-center justify-between gap-3 px-3 h-10 bg-surface border-b border-border z-10">
      <button onClick={onMenu} className="w-8 h-8 flex items-center justify-center border border-border-light text-text-muted hover:text-text-primary">
        <Icon name="layers" size={14} />
      </button>
      <div className="flex items-center gap-2">
        <Image src="/images/honcho-logo.svg" alt="Honcho" width={20} height={20} className="w-5 h-5 object-contain" />
        <div className="leading-tight">
          <div className="text-[11px] font-semibold tracking-wider">HONCHO</div>
          <div className="text-[8px] text-text-muted tracking-wider">SELF-HOSTED</div>
        </div>
      </div>
      <div className="w-8 h-8" />
    </div>
  );
}

function MobileDrawer({
  current,
  onNavigate,
  open,
  onClose,
}: {
  current: RouteKey;
  onNavigate: (k: RouteKey) => void;
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-void/80" onClick={onClose} />
      <aside className="absolute top-0 left-0 bottom-0 w-64 bg-surface border-r border-border flex flex-col">
        <div className="flex items-center justify-between p-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Image src="/images/honcho-logo.svg" alt="Honcho" width={24} height={24} className="w-6 h-6 object-contain" />
            <div className="leading-tight">
              <div className="text-xs font-semibold tracking-wider">HONCHO</div>
              <div className="text-[9px] text-text-muted tracking-wider">SELF-HOSTED</div>
            </div>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><Icon name="x" size={14} /></button>
        </div>
        <nav className="flex-1 py-2 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const isActive = item.key === current;
            return (
              <button
                key={item.key}
                onClick={() => onNavigate(item.key)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors",
                  isActive
                    ? "text-accent bg-accent/10"
                    : "text-text-muted hover:text-text-primary hover:bg-border/30"
                )}
              >
                <Icon name={item.icon as "activity"} size={14} />
                <span className={cn("flex-1 text-left", isActive && "cursor-blink")}>{isActive ? `> ${item.label}` : item.label}</span>
                {item.badge ? (
                  <span className="ml-auto text-[10px] bg-accent/20 text-accent px-1.5 py-0.5">{item.badge}</span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </aside>
    </div>
  );
}
