"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/utils";

/**
 * Honcho 3.4+ returns a server-assigned `uid` next to the client-chosen `id`.
 * Older servers omit it, so this renders nothing rather than a placeholder.
 */
export function ServerUid({
  uid,
  label = "uid",
  className,
}: {
  uid?: string | null;
  label?: string;
  className?: string;
}) {
  const { push } = useToast();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!uid) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(uid);
      setCopied(true);
    } catch {
      push({ type: "error", message: "Could not copy the UID. The browser blocked clipboard access." });
    }
  };

  return (
    <div className={cn("flex items-center justify-between gap-2 min-w-0 text-[11px]", className)}>
      <span className="text-text-muted shrink-0" title="Immutable identifier Honcho assigns. The ID is the name the client chose.">
        {label}
      </span>
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="font-mono text-text-primary truncate" title={uid}>{uid}</span>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${label}`}
          className="shrink-0 inline-flex items-center justify-center w-5 h-5 text-text-muted hover:text-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent transition-colors duration-150"
        >
          <Icon name={copied ? "check" : "copy"} size={11} />
        </button>
        <span className="sr-only" role="status">{copied ? "UID copied" : ""}</span>
      </span>
    </div>
  );
}
