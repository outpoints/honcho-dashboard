"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/Panel";
import { Button, Chip, Field } from "@/components/atoms";
import { Select } from "@/components/Select";
import { HonchoFeatureNotice } from "@/components/HonchoFeatureNotice";
import { useConfirm } from "@/components/confirm";
import { useToast } from "@/components/toast";
import { honcho } from "@/lib/honcho/client";
import type { HonchoClientOptions } from "@/lib/honcho/client";
import type { HonchoCapabilityState } from "@/lib/honcho/capabilities";
import {
  SCOPE_KEY_EXPIRY_OPTIONS,
  describeScopeKeyError,
  scopeKeyExpiresAt,
  type ScopeKeyExpiry,
} from "@/lib/honcho/scopeKeys";

interface MintedKey {
  key: string;
  expiresAt?: string;
}

/**
 * Honcho 3.4 named-scope keys. Remount per workspace/scope (`key` prop) so a
 * minted key never survives a change of target. The key lives only in this
 * component's state: no cache, storage, log, or toast ever receives it.
 */
export function ScopeKeyPanel({
  apiOpts,
  workspaceId,
  scopeId,
  capability,
  canWrite,
}: {
  apiOpts: HonchoClientOptions | null;
  workspaceId: string;
  scopeId: string;
  capability: HonchoCapabilityState;
  canWrite: boolean;
}) {
  const confirm = useConfirm();
  const { push } = useToast();
  const [expiry, setExpiry] = useState<ScopeKeyExpiry>("30d");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<MintedKey | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const available = capability === "available";
  const expiryLabel = SCOPE_KEY_EXPIRY_OPTIONS.find((option) => option.value === expiry)?.label ?? expiry;

  const mint = async () => {
    if (!apiOpts || !available || busy) return;
    const ok = await confirm({
      title: "MINT_SCOPE_KEY",
      confirmLabel: "MINT_KEY",
      body: (
        <>
          Mint a key for scope <span className="text-accent font-mono">{scopeId}</span> in workspace{" "}
          <span className="text-accent font-mono">{workspaceId}</span> ({expiryLabel})? Anyone holding it can
          read and write inside this scope&apos;s member sessions until it expires.
        </>
      ),
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      // Compute expiry after confirmation so a slow confirm doesn't shorten it.
      const expiresAt = scopeKeyExpiresAt(expiry);
      const key = await honcho.keys.createScoped(apiOpts, { workspaceId, scopeId, expiresAt });
      setMinted({ key, expiresAt });
      push({ type: "success", message: `Scope key minted for ${scopeId}` });
    } catch (err) {
      setError(describeScopeKeyError(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted.key);
      setCopied(true);
    } catch {
      push({ type: "error", message: "Could not copy the key. Select the text and copy it manually." });
    }
  };

  return (
    <Panel title="SCOPE_KEY" status={minted ? "active" : "idle"}>
      <div className="space-y-3">
        <p className="text-[11px] text-text-primary leading-relaxed max-w-[75ch]">
          A named-scope key confines a caller to <span className="text-accent font-mono">{scopeId}</span>.
          Recall uses this scope automatically, reads and writes stay inside its member sessions, and new
          sessions the caller creates join the scope. It cannot list the workspace, manage scopes, or mint keys.
        </p>

        {!available ? (
          <HonchoFeatureNotice state={capability} minimum="3.4" feature="Named-scope keys" />
        ) : minted ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="warn" icon="key">SHOWN_ONCE</Chip>
              <span className="text-[11px] text-text-primary">
                Copy it now. The dashboard does not store this key.
              </span>
            </div>
            <output
              aria-label={`Scope key for ${scopeId}`}
              className="block bg-void border border-border px-3 py-2 font-mono text-[11px] text-text-primary break-all select-all"
            >
              {minted.key}
            </output>
            <div className="flex flex-wrap items-center gap-2">
              <Button icon={copied ? "check" : "copy"} onClick={copy}>
                {copied ? "COPIED" : "COPY_KEY"}
              </Button>
              <Button variant="secondary" onClick={() => { setMinted(null); setCopied(false); }}>
                DISMISS
              </Button>
              <span className="text-[10px] text-text-muted">
                {minted.expiresAt
                  ? `expires ${new Date(minted.expiresAt).toLocaleString()}`
                  : "no expiry"}
              </span>
            </div>
          </div>
        ) : canWrite ? (
          <div className="flex flex-wrap items-end gap-3">
            <Field label="EXPIRES" className="w-44">
              <Select<ScopeKeyExpiry>
                value={expiry}
                onChange={setExpiry}
                options={SCOPE_KEY_EXPIRY_OPTIONS}
                disabled={busy}
              />
            </Field>
            <Button icon="key" onClick={mint} disabled={busy || !apiOpts}>
              {busy ? "MINTING…" : "MINT_SCOPE_KEY"}
            </Button>
          </div>
        ) : (
          <Chip tone="muted" icon="key">read-only · enable in CONFIG</Chip>
        )}

        {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}

        {available ? (
          <p className="text-[10px] text-text-muted leading-relaxed max-w-[75ch]">
            Needs an admin key and AUTH_USE_AUTH=true. Upgrade every API replica to 3.4+ first: older
            replicas reject these keys. Keys are stateless, so the only early revocation is rotating
            AUTH_JWT_SECRET, which revokes every key.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
