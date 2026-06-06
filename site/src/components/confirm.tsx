"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { ConfirmModal } from "@/components/ConfirmModal";

/**
 * Dashboard-wide confirm-on-write. Every action that creates/updates/deletes
 * against the live Honcho instance funnels through `useConfirm()` so the
 * confirmation rule is enforced in exactly one place (see DESIGN_GUIDE.md →
 * "Mutations confirm before write"). Reads never confirm.
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "DELETE_PEER", body: "…", destructive: true }))) return;
 *   await honcho.peers.delete(...);
 */
export interface ConfirmOptions {
  title?: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger tone (delete/remove). Defaults to false → neutral tone for saves/creates. */
  destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(false));

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      // If a confirm is somehow already open, cancel it before opening a new one.
      resolverRef.current?.(false);
      resolverRef.current = resolve;
      setPending(opts);
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setPending(null);
    resolve?.(value);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmModal
        open={pending !== null}
        title={pending?.title ?? "CONFIRM"}
        body={pending?.body ?? ""}
        confirmLabel={pending?.confirmLabel}
        cancelLabel={pending?.cancelLabel}
        destructive={pending?.destructive ?? false}
        onCancel={() => settle(false)}
        onConfirm={() => settle(true)}
      />
    </ConfirmContext.Provider>
  );
}
