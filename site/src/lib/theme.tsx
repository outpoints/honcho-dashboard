"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "honcho-dashboard:theme";
const THEME_EVENT = "honcho-dashboard:theme-change";
const MQ = "(prefers-color-scheme: dark)";

/**
 * Blocking script injected into <head> so the resolved theme is applied to
 * <html data-theme> before first paint. Without this there is a flash of the
 * default theme on load for users whose choice differs from it. Kept tiny and
 * dependency-free; it mirrors the resolution logic below.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(
  THEME_STORAGE_KEY,
)};var m=localStorage.getItem(k);if(m!=="light"&&m!=="dark"&&m!=="system")m="system";var r=m==="system"?(window.matchMedia("${MQ}").matches?"dark":"light"):m;document.documentElement.setAttribute("data-theme",r);}catch(e){document.documentElement.setAttribute("data-theme","dark");}})();`;

// --- mode store (localStorage, synced across tabs and same-tab writes) ---
function subscribeMode(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(THEME_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(THEME_EVENT, onChange);
  };
}
function getModeSnapshot(): ThemeMode {
  let v: string | null = null;
  try {
    v = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    v = null;
  }
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}
const getModeServerSnapshot = (): ThemeMode => "system";

// --- OS-preference store ---
function subscribeSystem(onChange: () => void) {
  const mq = window.matchMedia(MQ);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const getSystemSnapshot = (): boolean => window.matchMedia(MQ).matches;
const getSystemServerSnapshot = (): boolean => true; // assume dark default on server

interface ThemeContextValue {
  /** The user's selected mode, persisted across sessions. */
  mode: ThemeMode;
  /** The concrete theme currently applied (system resolved to light/dark). */
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const mode = useSyncExternalStore(
    subscribeMode,
    getModeSnapshot,
    getModeServerSnapshot,
  );
  const systemDark = useSyncExternalStore(
    subscribeSystem,
    getSystemSnapshot,
    getSystemServerSnapshot,
  );
  const resolved: ResolvedTheme =
    mode === "system" ? (systemDark ? "dark" : "light") : mode;

  // Apply to the DOM (writes to an external system, not React state). The boot
  // script set data-theme pre-paint, so this is a no-op on first mount; later
  // changes get a scoped 250ms color crossfade via the `.theme-transition` class.
  useEffect(() => {
    const el = document.documentElement;
    if (el.getAttribute("data-theme") === resolved) return;
    el.classList.add("theme-transition");
    el.setAttribute("data-theme", resolved);
    const t = window.setTimeout(
      () => el.classList.remove("theme-transition"),
      250,
    );
    return () => window.clearTimeout(t);
  }, [resolved]);

  const setMode = useCallback((next: ThemeMode) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // ignore persistence failures (private mode, etc.)
    }
    window.dispatchEvent(new Event(THEME_EVENT));
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

/** Concrete light/dark for client surfaces that paint with JS (canvas, charts). */
export function useResolvedTheme(): ResolvedTheme {
  return useTheme().resolved;
}
