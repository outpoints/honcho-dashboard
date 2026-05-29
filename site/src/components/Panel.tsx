"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export type PanelStatus = "idle" | "active" | "processing";

export interface PanelProps {
  title: string;
  className?: string;
  bodyClassName?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  status?: PanelStatus;
  delay?: number;
}

const STATUS_DOT: Record<PanelStatus, string> = {
  idle: "bg-text-muted",
  active: "bg-accent",
  processing: "bg-yellow-500",
};

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

export function Panel({
  title,
  className,
  bodyClassName,
  actions,
  children,
  status = "active",
  delay = 0,
}: PanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay, ease: EASE }}
      className={cn("bg-surface border border-border", className)}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <motion.span
            className={cn("w-2 h-2", STATUS_DOT[status])}
            animate={status === "processing" ? { opacity: [1, 0.4, 1] } : { opacity: 1 }}
            transition={{ duration: 1, repeat: status === "processing" ? Infinity : 0 }}
            aria-hidden
          />
          <span className="text-text-muted text-xs">[ {title} ]</span>
        </div>
        <div className="flex items-center gap-1">
          {actions ? <div className="mr-2 flex items-center gap-1">{actions}</div> : null}
          <span className="text-text-muted text-xs select-none" aria-hidden>─</span>
          <span className="text-text-muted text-xs select-none" aria-hidden>□</span>
          <span className="text-text-muted text-xs select-none cursor-pointer hover:text-accent transition-colors duration-150">
            ×
          </span>
        </div>
      </div>
      <div className={cn("p-3", bodyClassName)}>{children}</div>
    </motion.div>
  );
}
