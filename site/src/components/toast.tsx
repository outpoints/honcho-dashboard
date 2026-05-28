"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/utils";

export type ToastType = "success" | "error" | "info";

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toasts: Toast[];
  push: (t: Omit<Toast, "id">) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toasts: [],
  push: () => undefined,
  dismiss: () => undefined,
});

export function useToast() {
  return useContext(ToastContext);
}

const TONE: Record<ToastType, { border: string; iconName: "check" | "x-circle" | "alert-circle"; iconClass: string }> = {
  success: { border: "border-accent/50", iconName: "check", iconClass: "text-accent" },
  error: { border: "border-red-400/50", iconName: "x-circle", iconClass: "text-red-400" },
  info: { border: "border-blue-400/50", iconName: "alert-circle", iconClass: "text-blue-400" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((cur) => [...cur, { ...t, id }]);
      window.setTimeout(() => dismiss(id), 3500);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toasts, push, dismiss }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        <AnimatePresence mode="popLayout">
          {toasts.map((t) => {
            const tone = TONE[t.type];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, x: 50, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 50, scale: 0.95 }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
                className={cn("pointer-events-auto flex items-center gap-2 px-3 py-2 bg-surface border shadow-lg", tone.border)}
              >
                <Icon name={tone.iconName} size={14} className={tone.iconClass} />
                <span className="text-xs text-text-primary">{t.message}</span>
                <button
                  onClick={() => dismiss(t.id)}
                  className="ml-2 text-text-muted hover:text-text-primary transition-colors"
                  aria-label="Dismiss"
                >
                  <Icon name="x" size={12} />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
