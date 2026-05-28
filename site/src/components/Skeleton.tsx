"use client";

import { motion } from "framer-motion";
import { Panel } from "@/components/Panel";
import { cn } from "@/lib/utils";

export interface SkeletonProps {
  className?: string;
  delay?: number;
}

export function SkeletonBar({ className, delay = 0 }: SkeletonProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, delay }}
      className={cn("h-3 bg-border/60 animate-pulse", className)}
    />
  );
}

export function PanelCardSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <Panel title="LOADING…" delay={delay} status="processing">
      <div className="space-y-2">
        <SkeletonBar />
        <SkeletonBar className="w-2/3" />
        <SkeletonBar className="w-1/2" />
        <div className="h-8 bg-border/30 animate-pulse mt-4" />
      </div>
    </Panel>
  );
}

export function PanelGridSkeleton({
  count = 6,
  cols = "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
}: {
  count?: number;
  cols?: string;
}) {
  return (
    <div className={cn("grid gap-3", cols)}>
      {Array.from({ length: count }).map((_, i) => (
        <PanelCardSkeleton key={i} delay={i * 0.04} />
      ))}
    </div>
  );
}

export function SkeletonRowList({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.04, duration: 0.2 }}
          className="px-3 py-3 bg-void/40 border border-border space-y-1.5"
        >
          <div className="h-3 bg-border/60 animate-pulse w-1/3" />
          <div className="h-2 bg-border/40 animate-pulse w-3/4" />
        </motion.div>
      ))}
    </div>
  );
}
