"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/utils";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
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
  className,
  triggerClassName,
  panelClassName,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
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

  const current = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <motion.button
        type="button"
        onClick={() => setOpen((o) => !o)}
        whileTap={{ scale: 0.98 }}
        className={cn(
          "w-full bg-void border border-border px-3 py-2 text-sm text-text-primary outline-none focus:border-accent transition-colors duration-150 flex items-center justify-between gap-2",
          triggerClassName,
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={cn(!current && placeholder ? "text-text-muted" : "")}>
          {current?.label ?? placeholder ?? "Select..."}
        </span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 22 }}
          className="flex items-center"
        >
          <Icon name="chevron-down" size={12} className="text-text-muted" />
        </motion.span>
      </motion.button>

      <AnimatePresence>
        {open ? (
          <motion.div
            role="listbox"
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            style={{ transformOrigin: "top", minWidth: "max(100%, max-content)" }}
            className={cn(
              "absolute z-50 left-0 mt-1 bg-surface border border-border shadow-lg shadow-black/40",
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
                  whileHover={{ x: 3, backgroundColor: "rgba(26, 26, 26, 0.6)" }}
                  transition={{ type: "spring", stiffness: 500, damping: 28 }}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm whitespace-nowrap",
                    selected ? "text-accent bg-accent/10" : "text-text-primary",
                  )}
                >
                  {o.label}
                </motion.button>
              );
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
