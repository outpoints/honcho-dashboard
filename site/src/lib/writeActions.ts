"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Master gate for mutating actions. Default OFF: while disabled, every
 * create/update/delete control across the dashboard is hidden/disabled so no
 * write can fire against the live Honcho instance by accident. Enabling it is a
 * deliberate, warned choice (see ConfigPage). localStorage-backed and reactive
 * across tabs + same-tab writes (mirrors the theme store in `lib/theme.tsx`).
 */
export const WRITE_ACTIONS_KEY = "honcho-dashboard:writeActions";
const WRITE_ACTIONS_EVENT = "honcho-dashboard:writeActions-change";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(WRITE_ACTIONS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(WRITE_ACTIONS_EVENT, onChange);
  };
}

function getSnapshot(): boolean {
  try {
    return localStorage.getItem(WRITE_ACTIONS_KEY) === "true";
  } catch {
    return false;
  }
}

const getServerSnapshot = (): boolean => false;

export function useWriteActions(): { enabled: boolean; setEnabled: (next: boolean) => void } {
  const enabled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setEnabled = useCallback((next: boolean) => {
    try {
      localStorage.setItem(WRITE_ACTIONS_KEY, next ? "true" : "false");
    } catch {
      // ignore persistence failures (private mode, etc.)
    }
    window.dispatchEvent(new Event(WRITE_ACTIONS_EVENT));
  }, []);
  return { enabled, setEnabled };
}
