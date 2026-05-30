"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Icon, type IconName } from "@/components/icons";
import { cn } from "@/lib/utils";
import { useTheme, type ThemeMode } from "@/lib/theme";
import { useAnchoredPosition, useIsClient } from "@/lib/usePopover";

const OPTIONS: { value: ThemeMode; label: string; icon: IconName }[] = [
  { value: "light", label: "LIGHT", icon: "sun" },
  { value: "dark", label: "DARK", icon: "moon" },
  { value: "system", label: "SYSTEM", icon: "monitor" },
];

const ICON_FOR: Record<ThemeMode, IconName> = {
  light: "sun",
  dark: "moon",
  system: "monitor",
};

// Mirrors Select.tsx so the menu reads as the same component family.
const panelVariants = {
  hidden: { opacity: 0, scaleY: 0.85, y: -4 },
  visible: {
    opacity: 1,
    scaleY: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 500, damping: 30, staggerChildren: 0.02 },
  },
  exit: { opacity: 0, scaleY: 0.9, y: -4, transition: { duration: 0.12 } },
};

const itemVariants = {
  hidden: { opacity: 0, x: -6 },
  visible: { opacity: 1, x: 0 },
  exit: { opacity: 0 },
};

export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  const [open, setOpen] = useState(false);
  const mounted = useIsClient();
  const ref = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const position = useAnchoredPosition(ref, open, "right");

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      // Panel is portaled out of `ref`; check it separately so selecting an
      // option doesn't read as an outside click and close before onClick fires.
      if (ref.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <motion.button
        type="button"
        onClick={() => setOpen((o) => !o)}
        whileTap={{ scale: 0.94 }}
        className="w-7 h-7 flex items-center justify-center border border-border text-text-muted hover:text-text-primary hover:border-border-light transition-colors duration-150"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`THEME: ${mode.toUpperCase()}`}
        title={`Theme: ${mode}`}
      >
        <Icon name={ICON_FOR[mode]} size={13} />
      </motion.button>

      {mounted
        ? createPortal(
            <AnimatePresence>
              {open && position ? (
                <motion.div
                  ref={panelRef}
                  role="listbox"
                  aria-label="THEME"
                  variants={panelVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  style={{
                    position: "fixed",
                    top: position.top,
                    right: position.right,
                    minWidth: 140,
                    transformOrigin: "top right",
                  }}
                  className="z-50 bg-surface border border-border shadow-lg shadow-black/40"
                >
                  {OPTIONS.map((o) => {
                    const selected = o.value === mode;
                    return (
                      <motion.button
                        key={o.value}
                        variants={itemVariants}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          setMode(o.value);
                          setOpen(false);
                        }}
                        whileHover={{ x: 3 }}
                        transition={{ type: "spring", stiffness: 500, damping: 28 }}
                        className={cn(
                          "w-full text-left px-3 py-2 text-[11px] uppercase tracking-wider font-mono flex items-center gap-2 transition-colors duration-150",
                          selected
                            ? "text-accent bg-accent/10"
                            : "text-text-primary hover:bg-border/60",
                        )}
                      >
                        <Icon
                          name={o.icon}
                          size={12}
                          className={cn("shrink-0", selected ? "text-accent" : "text-text-muted")}
                        />
                        <span className="flex-1">{o.label}</span>
                        {selected ? (
                          <Icon name="check" size={11} className="text-accent shrink-0" />
                        ) : (
                          <span className="w-[11px] shrink-0" aria-hidden />
                        )}
                      </motion.button>
                    );
                  })}
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </div>
  );
}
