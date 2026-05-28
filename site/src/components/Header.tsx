"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@/components/icons";
import type { RouteKey } from "@/types/honcho";
import { useNav } from "@/lib/nav";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { getSdk } from "@/lib/honcho/sdk";
import { formatApiError } from "@/lib/honcho/useQuery";

export interface HeaderProps {
  current: RouteKey;
  onNavigate?: (key: RouteKey) => void;
}

export function Header({ current }: HeaderProps) {
  const { navigate } = useNav();
  const apiOpts = useActiveHonchoOptions();
  const { workspaceId } = useActiveWorkspace();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
        setQuery("");
        setResults(null);
        setError(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  const runSearch = async () => {
    if (!apiOpts || !workspaceId || query.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const r = await getSdk(apiOpts, workspaceId).search(query.trim());
      setResults(r);
    } catch (err) {
      setError(formatApiError(err));
      setResults(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="h-12 bg-surface border-b border-border flex items-center justify-between px-3 sm:px-4 relative gap-3 z-10">
        <div className="flex items-center gap-2 text-xs">
          <Icon name="terminal" className="text-accent shrink-0" size={14} />
          <button onClick={() => navigate("overview")} className="text-text-muted hover:text-text-primary transition-colors duration-150">honcho</button>
          <span className="text-text-muted">/</span>
          <button onClick={() => navigate("workspaces")} className="text-text-muted hover:text-text-primary transition-colors duration-150">
            {workspaceId ?? "self-hosted"}
          </button>
          <span className="text-text-muted">/</span>
          <span className="text-accent">{current}</span>
        </div>

        <div className="flex-1 max-w-md mx-4">
          <button
            onClick={() => setSearchOpen(true)}
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

        <div className="flex items-center gap-2">
          <span className="hidden sm:flex text-[10px] text-text-muted font-mono">
            {apiOpts?.baseUrl ?? "no instance"}
          </span>
        </div>
      </header>

      <AnimatePresence>
        {searchOpen ? (
          <motion.div
            className="fixed inset-0 bg-void/80 flex items-start justify-center pt-20 z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => {
              setSearchOpen(false);
              setQuery("");
              setResults(null);
              setError(null);
            }}
          >
            <motion.div
              className="bg-surface border border-border w-full max-w-2xl mx-4"
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <Icon name="search" className="text-text-muted" size={14} />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") runSearch();
                  }}
                  placeholder={workspaceId ? `search in ${workspaceId}…` : "select a workspace first"}
                  autoFocus
                  disabled={!workspaceId}
                  className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none disabled:opacity-50"
                />
                <button
                  onClick={runSearch}
                  disabled={!workspaceId || query.trim().length < 2 || busy}
                  className="text-[10px] uppercase tracking-wider text-accent disabled:text-text-muted"
                >
                  {busy ? "…" : "search"}
                </button>
                <button
                  onClick={() => {
                    setSearchOpen(false);
                    setQuery("");
                    setResults(null);
                    setError(null);
                  }}
                  className="text-text-muted hover:text-accent transition-colors duration-150"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>

              <div className="max-h-[400px] overflow-y-auto p-3 text-xs">
                {!workspaceId ? (
                  <div className="text-text-muted">Select a workspace in the sidebar to search.</div>
                ) : error ? (
                  <div className="text-red-400">{error}</div>
                ) : results !== null ? (
                  <pre className="text-text-primary whitespace-pre-wrap break-words">
                    {JSON.stringify(results, null, 2)}
                  </pre>
                ) : (
                  <div className="text-text-muted">
                    Enter a query and press Enter to search workspace{" "}
                    <span className="text-accent">{workspaceId}</span> via{" "}
                    <code>/v3/workspaces/{workspaceId}/search</code>.
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
