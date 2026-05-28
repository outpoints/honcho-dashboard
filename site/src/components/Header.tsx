"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@/components/icons";
import type { RouteKey } from "@/types/honcho";
import { PEERS, SESSIONS } from "@/lib/data";
import { useNav } from "@/lib/nav";

export interface HeaderProps {
  current: RouteKey;
  onNavigate?: (key: RouteKey) => void;
}

type SearchResult =
  | { type: "peer"; id: string; name: string; subtitle: string }
  | { type: "session"; id: string; name: string; subtitle: string };

export function Header({ current }: HeaderProps) {
  const { navigate } = useNav();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  const results = useMemo<SearchResult[]>(() => {
    if (query.trim().length < 2) return [];
    const q = query.toLowerCase();
    const peerMatches: SearchResult[] = PEERS
      .filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
      .map((p) => ({ type: "peer", id: p.id, name: p.name, subtitle: `@${p.workspace} · ${p.type}` }));
    const sessionMatches: SearchResult[] = SESSIONS
      .filter((s) => s.id.toLowerCase().includes(q) || s.peers.some((peer) => peer.toLowerCase().includes(q)))
      .map((s) => ({ type: "session", id: s.id, name: s.id, subtitle: `@${s.workspace} · ${s.peers.join(", ")}` }));
    return [...peerMatches, ...sessionMatches].slice(0, 12);
  }, [query]);

  return (
    <>
      <header className="h-12 bg-surface border-b border-border flex items-center justify-between px-3 sm:px-4 relative gap-3 z-10">
        <div className="flex items-center gap-2 text-xs">
          <Icon name="terminal" className="text-accent shrink-0" size={14} />
          <button onClick={() => navigate("overview")} className="text-text-muted hover:text-text-primary transition-colors duration-150">honcho</button>
          <span className="text-text-muted">/</span>
          <button onClick={() => navigate("overview")} className="text-text-muted hover:text-text-primary transition-colors duration-150">self-hosted</button>
          <span className="text-text-muted">/</span>
          <span className="text-accent">{current}</span>
        </div>

        <div className="flex-1 max-w-md mx-4">
          <button
            onClick={() => setSearchOpen(true)}
            className="w-full relative flex items-center gap-2 bg-void border border-border hover:border-border-light px-2.5 py-1.5 transition-colors duration-150 text-left"
          >
            <Icon name="search" className="text-text-muted shrink-0" size={12} />
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.65 }}
              className="text-text-muted text-xs flex-1 whitespace-nowrap"
            >
              search peers, sessions...
            </motion.span>
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.8 }}
              className="flex items-center gap-1"
            >
              <kbd className="px-1.5 py-0.5 bg-border text-[10px] text-text-muted leading-none">⌘</kbd>
              <kbd className="px-1.5 py-0.5 bg-border text-[10px] text-text-muted leading-none">K</kbd>
            </motion.span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button className="relative w-8 h-8 flex items-center justify-center border border-border hover:border-border-light text-text-muted hover:text-accent transition-colors duration-150">
            <Icon name="bell" size={14} />
            <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-accent" />
          </button>
          <button className="flex items-center gap-1.5 px-2 h-8 border border-border hover:border-border-light text-text-muted hover:text-text-primary text-xs transition-colors duration-150">
            <Icon name="user" size={14} />
            <span>admin</span>
          </button>
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
            }}
          >
            <motion.div
              className="bg-surface border border-border w-full max-w-lg mx-4"
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
                  placeholder="Search peers, sessions..."
                  autoFocus
                  className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
                />
                <button
                  onClick={() => {
                    setSearchOpen(false);
                    setQuery("");
                  }}
                  className="text-text-muted hover:text-accent transition-colors duration-150"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>

              <AnimatePresence initial={false}>
                {results.length > 0 ? (
                  <motion.div
                    key="results"
                    className="max-h-[300px] overflow-y-auto"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    {results.map((r) => (
                      <button
                        key={`${r.type}-${r.id}`}
                        onClick={() => {
                          setSearchOpen(false);
                          setQuery("");
                          navigate(r.type === "peer" ? "peers" : "sessions");
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-border/30 text-left transition-colors duration-150"
                      >
                        <span
                          className={`text-[9px] px-1 py-0.5 uppercase tracking-wider ${
                            r.type === "peer" ? "bg-accent/20 text-accent" : "bg-purple-400/20 text-purple-400"
                          }`}
                        >
                          {r.type}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-text-primary">{r.name}</div>
                          <div className="text-[10px] text-text-muted truncate">{r.subtitle}</div>
                        </div>
                      </button>
                    ))}
                  </motion.div>
                ) : query.length > 1 ? (
                  <div className="px-3 py-4 text-center text-sm text-text-muted">
                    {`No results found for "${query}"`}
                  </div>
                ) : (
                  <div className="px-3 py-4 text-center text-xs text-text-muted">
                    Type to search peers and sessions...
                  </div>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
