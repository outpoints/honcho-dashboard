"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icons";

export interface ModalProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function Modal({ title, open, onClose, children, footer, className }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            className="absolute inset-0 bg-void/80 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            className={cn("relative w-full max-w-2xl bg-surface border border-border-light shadow-2xl", className)}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-accent" />
                <span className="text-xs text-text-muted">[ {title} ]</span>
              </div>
              <button onClick={onClose} className="text-text-muted hover:text-accent transition-colors duration-150">
                <Icon name="x" size={14} />
              </button>
            </div>
            <div className="p-4 space-y-4">{children}</div>
            {footer ? (
              <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
                {footer}
              </div>
            ) : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
