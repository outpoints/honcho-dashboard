"use client";

import { useState } from "react";
import { Panel } from "@/components/Panel";
import { Markdown } from "@/components/Markdown";
import { Button, Chip } from "@/components/atoms";
import { useConfirm } from "@/components/confirm";
import { useToast } from "@/components/toast";
import { honcho, type HonchoClientOptions } from "@/lib/honcho/client";
import { formatApiError } from "@/lib/honcho/useQuery";
import type { TrashedConclusion } from "@/lib/conclusionTrash";

/**
 * Conclusions deleted from this tab. RESTORE recreates one through the normal
 * create endpoint (new ID, stored as explicit); FORGET drops the local copy.
 */
export function ConclusionTrashPanel({
  items,
  apiOpts,
  workspaceId,
  canWrite,
  onRemove,
  onClear,
  onRestored,
}: {
  items: TrashedConclusion[];
  apiOpts: HonchoClientOptions | null;
  workspaceId: string;
  canWrite: boolean;
  onRemove: (id: string) => void;
  onClear: () => void;
  onRestored: () => void;
}) {
  const confirm = useConfirm();
  const { push } = useToast();
  const [restoring, setRestoring] = useState<string | null>(null);

  if (items.length === 0) return null;

  const restore = async (item: TrashedConclusion) => {
    if (!apiOpts) return;
    const c = item.conclusion;
    const ok = await confirm({
      title: "RESTORE_CONCLUSION",
      confirmLabel: "RESTORE",
      body: (
        <>
          Recreate this conclusion about <span className="text-accent font-mono">{c.observed_id}</span> in{" "}
          <span className="text-accent font-mono">{workspaceId}</span>? Honcho stores it as a new explicit conclusion
          with a new ID{c.level && c.level !== "explicit" ? `; its original ${c.level} level and provenance are not kept` : ""}.
        </>
      ),
    });
    if (!ok) return;
    setRestoring(c.id);
    try {
      await honcho.conclusions.create(apiOpts, workspaceId, [{
        content: c.content,
        observer_id: c.observer_id,
        observed_id: c.observed_id,
        session_id: c.session_id ?? null,
      }]);
      onRemove(c.id);
      onRestored();
      push({ type: "success", message: "Conclusion restored as a new explicit conclusion" });
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    } finally {
      setRestoring(null);
    }
  };

  return (
    <Panel
      title="TRASH"
      status="idle"
      actions={
        <div className="flex items-center gap-2">
          <Chip tone="muted">{items.length} in this tab</Chip>
          <Button size="sm" variant="ghost" icon="x" onClick={onClear}>EMPTY_TRASH</Button>
        </div>
      }
    >
      <p className="text-[10px] text-text-muted mb-3 max-w-[75ch]">
        Copies of conclusions deleted in this browser tab. They are cleared when the tab closes and never sent anywhere
        until you restore one.
      </p>
      <ul className="space-y-2">
        {items.map((item) => {
          const c = item.conclusion;
          return (
            <li key={c.id} className="flex flex-wrap sm:flex-nowrap items-start gap-3 border border-border bg-void/30 px-3 py-2.5">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-[10px] text-text-muted">
                  {c.level ? <Chip tone="muted">{c.level}</Chip> : null}
                  <span className="font-mono text-accent">{c.observer_id}</span>
                  <span aria-hidden>→</span>
                  <span className="font-mono text-text-primary">{c.observed_id}</span>
                  <span>· deleted {new Date(item.deleted_at).toLocaleTimeString()}</span>
                </div>
                <div className="line-clamp-2 text-xs text-text-primary">
                  <Markdown inline text={c.content} />
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {canWrite ? (
                  <Button size="sm" variant="outline" icon="refresh" onClick={() => restore(item)} disabled={restoring !== null || !apiOpts}>
                    {restoring === c.id ? "RESTORING…" : "RESTORE"}
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => onRemove(c.id)} disabled={restoring === c.id} aria-label={`Forget trashed conclusion ${c.id}`}>
                  FORGET
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
