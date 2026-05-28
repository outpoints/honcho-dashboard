"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Field, PillTabs } from "@/components/atoms";
import { Select } from "@/components/Select";
import { useActiveHonchoOptions, useActiveWorkspace } from "@/lib/honcho/config";
import { formatApiError, useHonchoQuery } from "@/lib/honcho/useQuery";
import { getSdk } from "@/lib/honcho/sdk";
import {
  toApiPeer,
  toApiPeerContext,
  toApiSession,
  toApiSessionContext,
} from "@/lib/honcho/adapters";
import type { ApiPeer, ApiSession } from "@/lib/honcho/types";

type Mode = "peer" | "session";

function readSubjectFromHash(): { mode: Mode; id: string } | null {
  if (typeof window === "undefined") return null;
  const peer = window.location.hash.match(/[?&]peer=([^&]+)/);
  const session = window.location.hash.match(/[?&]session=([^&]+)/);
  if (peer) return { mode: "peer", id: decodeURIComponent(peer[1]) };
  if (session) return { mode: "session", id: decodeURIComponent(session[1]) };
  return null;
}

export function ContextPage() {
  const apiOpts = useActiveHonchoOptions();
  const { workspaceId } = useActiveWorkspace();
  const [mode, setMode] = useState<Mode>("peer");
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [payload, setPayload] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initial = readSubjectFromHash();
    if (initial) {
      setMode(initial.mode);
      setSubjectId(initial.id);
    }
  }, []);

  const peers = useHonchoQuery<{ items: ApiPeer[]; total: number }>(
    workspaceId ? `sdk/workspaces/${workspaceId}/peers/list?ctx` : null,
    async (o) => {
      const page = await getSdk(o, workspaceId!).peers({ size: 100 });
      return { items: page.items.map((p) => toApiPeer(p)), total: page.total };
    },
  );
  const sessions = useHonchoQuery<{ items: ApiSession[]; total: number }>(
    workspaceId ? `sdk/workspaces/${workspaceId}/sessions/list?ctx` : null,
    async (o) => {
      const page = await getSdk(o, workspaceId!).sessions({ size: 100 });
      return { items: page.items.map((s) => toApiSession(s)), total: page.total };
    },
  );

  const fetchContext = async () => {
    if (!apiOpts || !workspaceId || !subjectId) return;
    setBusy(true);
    setError(null);
    setPayload(null);
    try {
      const sdk = getSdk(apiOpts, workspaceId);
      if (mode === "peer") {
        const peer = await sdk.peer(subjectId);
        const ctx = await peer.context();
        setPayload(toApiPeerContext(ctx));
      } else {
        const ses = await sdk.session(subjectId);
        const ctx = await ses.context();
        setPayload(toApiSessionContext(ctx));
      }
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const options =
    mode === "peer" ? peers.data?.items ?? [] : sessions.data?.items ?? [];

  return (
    <div className="space-y-3">
      <PageHeader
        title="CONTEXT"
        subtitle={workspaceId ? `view computed context in ${workspaceId}` : "select a workspace"}
        actions={
          <Button onClick={fetchContext} disabled={!subjectId || busy}>
            {busy ? "FETCHING…" : "FETCH_CONTEXT"}
          </Button>
        }
      />

      <Panel title="SUBJECT">
        <div className="space-y-3">
          <PillTabs
            items={[
              { key: "peer", label: "PEER" },
              { key: "session", label: "SESSION" },
            ]}
            current={mode}
            onChange={(m) => {
              setMode(m as Mode);
              setSubjectId(null);
              setPayload(null);
              setError(null);
            }}
          />
          <Field label={mode === "peer" ? "PEER_ID" : "SESSION_ID"}>
            <Select
              value={subjectId ?? ""}
              onChange={(v) => setSubjectId(v || null)}
              options={options.map((item) => ({ value: item.id, label: item.id }))}
              disabled={!workspaceId || options.length === 0}
              placeholder={options.length === 0 ? "(no items)" : `select a ${mode}…`}
            />
          </Field>
        </div>
      </Panel>

      {error ? (
        <Panel title="ERROR" status="processing">
          <div className="text-xs text-red-400">{error}</div>
        </Panel>
      ) : payload ? (
        <Panel title={mode === "peer" ? "PEER_CONTEXT" : "SESSION_CONTEXT"}>
          <pre className="text-[11px] text-text-primary whitespace-pre-wrap break-words leading-relaxed">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </Panel>
      ) : (
        <Panel title="API_NOTE">
          <div className="text-[11px] text-text-muted leading-relaxed">
            Calls{" "}
            <span className="text-accent">
              {mode === "peer"
                ? "GET /v3/workspaces/{ws}/peers/{id}/context"
                : "GET /v3/workspaces/{ws}/sessions/{id}/context"}
            </span>
            . Returns the computed peer card, representation, recent messages, and any session
            summary — whatever the server has assembled for this subject.
          </div>
        </Panel>
      )}

      <StatusBar />
    </div>
  );
}
