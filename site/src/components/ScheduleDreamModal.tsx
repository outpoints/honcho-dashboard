"use client";

import { useState } from "react";
import { Button, Field, TextInput } from "@/components/atoms";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import { useConfirm } from "@/components/confirm";
import { useToast } from "@/components/toast";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { getSdk } from "@/lib/honcho/sdk";
import { formatApiError, useHonchoQuery } from "@/lib/honcho/useQuery";

/** The modal offers a peer list only when the whole workspace fits in one page this size. */
const PEER_PICK_LIMIT = 100;

export interface ScheduleDreamDefaults {
  observer?: string | null;
  observed?: string | null;
}

/**
 * SCHEDULE_DREAM, shared by Reasoning and Dreams. Fields start from `initial`
 * on mount: give the modal a new `key` each time it opens so a previous
 * draft never carries over. Renders nothing writable unless the caller
 * checked `useWriteActions()`; the write itself still confirms.
 */
export function ScheduleDreamModal({
  open,
  onClose,
  onScheduled,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  onScheduled?: (observer: string) => void;
  initial?: ScheduleDreamDefaults;
}) {
  const apiOpts = useActiveHonchoOptions();
  const { workspaceId } = useActiveWorkspace();
  const { push } = useToast();
  const confirm = useConfirm();
  const [observer, setObserver] = useState(initial?.observer ?? "");
  const [observed, setObserved] = useState(initial?.observed ?? "");
  const [session, setSession] = useState("");
  const [busy, setBusy] = useState(false);
  // Pick peers from the workspace when its whole peer list fits; type an id otherwise.
  const peers = useHonchoQuery<{ ids: string[]; complete: boolean }>(
    open && workspaceId ? `sdk/workspaces/${workspaceId}/peers/list?schedule` : null,
    async (o) => {
      const page = await getSdk(o, workspaceId!).peers({ size: PEER_PICK_LIMIT });
      return { ids: page.items.map((peer) => peer.id), complete: page.total <= page.items.length };
    },
  );
  // Pick from a list while it loads (starting from the defaults) and once it is known whole; fall back to typing.
  const pickable = !peers.error && (peers.isLoading || peers.data?.complete === true);
  const peerIds = pickable ? [...(peers.data?.ids ?? [])] : null;
  if (peerIds) for (const id of [initial?.observer, initial?.observed]) if (id && !peerIds.includes(id)) peerIds.push(id);

  const submit = async () => {
    if (!apiOpts || !workspaceId || busy) return;
    const who = observer.trim();
    if (!who) {
      push({ type: "error", message: "Observer peer id is required" });
      return;
    }
    const ok = await confirm({
      title: "SCHEDULE_DREAM",
      confirmLabel: "SCHEDULE",
      body: (
        <>
          Queue a dream consolidation pass for <span className="text-accent font-mono">{who}</span> in{" "}
          <span className="text-accent font-mono">{workspaceId}</span> on the live instance?
        </>
      ),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await getSdk(apiOpts, workspaceId).scheduleDream({
        observer: who,
        ...(observed.trim() ? { observed: observed.trim() } : {}),
        ...(session.trim() ? { session: session.trim() } : {}),
      });
      push({ type: "success", message: `Dream scheduled for ${who}` });
      onScheduled?.(who);
      onClose();
    } catch (err) {
      push({ type: "error", message: formatApiError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="SCHEDULE_DREAM"
      open={open}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            CANCEL
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy}>
            {busy ? "SCHEDULING…" : "SCHEDULE"}
          </Button>
        </>
      }
    >
      <div className="text-[11px] text-text-muted">
        Queues a consolidation pass over a peer&apos;s representation in{" "}
        <span className="text-accent font-mono">{workspaceId}</span>.
      </div>
      <Field label="OBSERVER" hint="Required. The peer whose view gets dreamed on.">
        {peerIds ? (
          <Select
            value={observer}
            onChange={setObserver}
            options={peerIds.map((id) => ({ value: id, label: id }))}
            placeholder="— pick a peer —"
            ariaLabel={`Observer: ${observer || "none picked"}`}
          />
        ) : (
          <TextInput
            autoFocus
            placeholder="e.g., peer_alice_001"
            value={observer}
            onChange={(e) => setObserver(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) submit();
            }}
          />
        )}
      </Field>
      <Field label="OBSERVED" hint="Optional. The peer that view is about. Leave it unset for the observer's view of itself.">
        {peerIds ? (
          <Select
            value={observed}
            onChange={setObserved}
            options={[{ value: "", label: "— not set —" }, ...peerIds.map((id) => ({ value: id, label: id }))]}
            placeholder="— not set —"
            ariaLabel={`Observed: ${observed || "not set"}`}
          />
        ) : (
          <TextInput placeholder="(optional)" value={observed} onChange={(e) => setObserved(e.target.value)} />
        )}
      </Field>
      <Field label="SESSION" hint="Optional. Limits the dream to one session.">
        <TextInput placeholder="(optional)" value={session} onChange={(e) => setSession(e.target.value)} />
      </Field>
    </Modal>
  );
}
