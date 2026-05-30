"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { useAnchoredPosition, useIsClient } from "@/lib/usePopover";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  panelClassName?: string;
}

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

export function Select<T extends string = string>({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
  triggerClassName,
  panelClassName,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const mounted = useIsClient();
  const ref = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const current = options.find((o) => o.value === value);
  const effectiveOpen = open && !disabled;
  const position = useAnchoredPosition(ref, effectiveOpen);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      // The panel is portaled out of `ref`, so it must be checked separately —
      // otherwise a mousedown on an option reads as "outside" and closes the
      // menu before the option's click handler can fire.
      if (ref.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <motion.button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        whileTap={disabled ? undefined : { scale: 0.98 }}
        className={cn(
          "w-full bg-void border border-border px-3 py-2 text-xs text-text-primary outline-none focus:border-accent transition-colors duration-150 flex items-center justify-between gap-2 font-mono",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          triggerClassName,
        )}
        aria-haspopup="listbox"
        aria-expanded={effectiveOpen}
      >
        <span
          className={cn(
            "truncate text-left",
            !current && placeholder ? "text-text-muted" : "",
          )}
        >
          {current?.label ?? placeholder ?? "Select..."}
        </span>
        <motion.span
          animate={{ rotate: effectiveOpen ? 180 : 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 22 }}
          className="flex items-center shrink-0"
        >
          <Icon name="chevron-down" size={12} className="text-text-muted" />
        </motion.span>
      </motion.button>

      {mounted
        ? createPortal(
            <AnimatePresence>
              {effectiveOpen && position ? (
                <motion.div
                  ref={panelRef}
                  role="listbox"
                  variants={panelVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  style={{
                    position: "fixed",
                    top: position.top,
                    left: position.left,
                    minWidth: position.minWidth,
                    transformOrigin: "top",
                  }}
                  className={cn(
                    "z-50 bg-surface border border-border shadow-lg shadow-black/40 max-h-[320px] overflow-y-auto",
                    panelClassName,
                  )}
                >
                  {options.map((o) => {
                    const selected = o.value === value;
                    return (
                      <motion.button
                        key={o.value}
                        variants={itemVariants}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          onChange(o.value);
                          setOpen(false);
                        }}
                        whileHover={{ x: 3 }}
                        transition={{ type: "spring", stiffness: 500, damping: 28 }}
                        className={cn(
                          "w-full text-left px-3 py-2 text-xs whitespace-nowrap font-mono flex items-center gap-2 transition-colors duration-150",
                          selected ? "text-accent bg-accent/10" : "text-text-primary hover:bg-border/60",
                        )}
                      >
                        {selected ? (
                          <Icon name="check" size={11} className="text-accent shrink-0" />
                        ) : (
                          <span className="w-[11px] shrink-0" aria-hidden />
                        )}
                        <span className="truncate">{o.label}</span>
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
