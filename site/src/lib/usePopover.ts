"use client";

import { useCallback, useRef, useSyncExternalStore, type RefObject } from "react";

export interface AnchoredPosition {
  top: number;
  left?: number;
  right?: number;
  minWidth: number;
}

const emptySubscribe = () => () => {};

/** True only after client hydration — gates `createPortal`, which needs `document`. */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/**
 * Tracks an anchor element's viewport rect so a portaled popover can be placed
 * with `position: fixed`. Modeled as an external store (the DOM layout) so it
 * re-measures on scroll (capture phase → nested scrollers included too) and on
 * resize while `open`, and measures synchronously during render so the panel
 * never paints a frame at a stale position.
 *
 * Anchored popovers are portaled to <body> rather than rendered inline: an
 * absolutely-positioned panel is trapped inside its ancestor's stacking context
 * and clipped by any `overflow` ancestor, so a menu opened from the sidebar
 * (its own `z-10` context, sibling to the main content's `z-10`) could never
 * paint above the content plane regardless of its own z-index.
 *
 * Returns `null` on the server, before the anchor mounts, and while closed.
 */
export function useAnchoredPosition(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  align: "left" | "right" = "left",
  gap = 4,
): AnchoredPosition | null {
  const cache = useRef<AnchoredPosition | null>(null);

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!open) return () => {};
      window.addEventListener("scroll", onChange, true);
      window.addEventListener("resize", onChange);
      return () => {
        window.removeEventListener("scroll", onChange, true);
        window.removeEventListener("resize", onChange);
      };
    },
    [open],
  );

  const getSnapshot = useCallback((): AnchoredPosition | null => {
    const el = anchorRef.current;
    if (!open || !el) return null;
    const r = el.getBoundingClientRect();
    const next: AnchoredPosition =
      align === "right"
        ? { top: r.bottom + gap, right: window.innerWidth - r.right, minWidth: r.width }
        : { top: r.bottom + gap, left: r.left, minWidth: r.width };
    // Return the cached reference when nothing moved so useSyncExternalStore
    // doesn't see a new object every render (which would loop forever).
    const prev = cache.current;
    if (
      prev &&
      prev.top === next.top &&
      prev.left === next.left &&
      prev.right === next.right &&
      prev.minWidth === next.minWidth
    ) {
      return prev;
    }
    cache.current = next;
    return next;
  }, [anchorRef, open, align, gap]);

  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
