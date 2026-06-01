"use client";

import { useCallback, useSyncExternalStore } from "react";
import { NAV_ITEMS } from "@/lib/data";
import type { RouteKey } from "@/types/honcho";

/** Base document title shown for every route. */
export const TITLE_BASE = "Honcho Dashboard";

const PREF_KEY = "honcho-dashboard:appendSectionToTitle";
const PREF_EVENT = "honcho-dashboard:title-pref-change";

/** Title-cased section name for a route, derived from its nav label. */
export function sectionTitle(key: RouteKey): string | null {
  const label = NAV_ITEMS.find((n) => n.key === key)?.label;
  if (!label) return null;
  return label
    .toLowerCase()
    .split(/[\s_-]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Compose the document title from the active route and the user's preference. */
export function buildTitle(key: RouteKey, appendSection: boolean): string {
  if (!appendSection) return TITLE_BASE;
  const section = sectionTitle(key);
  return section ? `${TITLE_BASE} - ${section}` : TITLE_BASE;
}

// --- preference store (localStorage, synced across tabs and same-tab writes) ---
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(PREF_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PREF_EVENT, onChange);
  };
}

function getSnapshot(): boolean {
  // On by default: only an explicit opt-out ("false") disables it.
  try {
    return localStorage.getItem(PREF_KEY) !== "false";
  } catch {
    return true;
  }
}

const getServerSnapshot = (): boolean => true;

/** Whether the active section name is appended to the browser tab title. */
export function useAppendSectionToTitle(): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setValue = useCallback((next: boolean) => {
    try {
      localStorage.setItem(PREF_KEY, String(next));
    } catch {
      // ignore persistence failures (private mode, etc.)
    }
    window.dispatchEvent(new Event(PREF_EVENT));
  }, []);
  return [value, setValue];
}
