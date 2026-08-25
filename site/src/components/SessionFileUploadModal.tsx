"use client";

import { useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { Button, Field, TextInput } from "@/components/atoms";
import { Select } from "@/components/Select";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { honcho } from "@/lib/honcho/client";
import type { HonchoClientOptions } from "@/lib/honcho/client";
import {
  FILE_UPLOAD_ACCEPT,
  prepareUploadFile,
  supportedUploadContentType,
} from "@/lib/honcho/fileUpload";
import { formatApiError } from "@/lib/honcho/useQuery";
import { parseOptionalJsonObject } from "@/lib/json";

export interface SessionFileUploadModalProps {
  open: boolean;
  onClose: () => void;
  apiOpts: HonchoClientOptions | null;
  workspaceId: string;
  sessionId: string;
  peers: string[];
  onUploaded: (messageCount: number) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SessionFileUploadModal({
  open,
  onClose,
  apiOpts,
  workspaceId,
  sessionId,
  peers,
  onUploaded,
}: SessionFileUploadModalProps) {
  const { push } = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [peerId, setPeerId] = useState("");
  const [metadataJson, setMetadataJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const peerOptions = peers.map((peer) => ({ value: peer, label: peer }));
  const effectivePeer = peers.includes(peerId) ? peerId : peers.length === 1 ? peers[0] : "";

  const reset = () => {
    setFile(null);
    setPeerId("");
    setMetadataJson("");
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const chooseFile = (next: File | undefined) => {
    if (!next) return;
    if (!supportedUploadContentType(next.name, next.type)) {
      setFile(null);
      setError("Unsupported file. Choose a PDF, JSON document, or text/code file.");
      return;
    }
    setFile(next);
    setError(null);
  };

  const upload = async () => {
    if (!apiOpts || !file || !effectivePeer || busy) return;
    const prepared = prepareUploadFile(file);
    if (!prepared) {
      setError("Unsupported file. Choose a PDF, JSON document, or text/code file.");
      return;
    }

    const metadata = parseOptionalJsonObject(metadataJson, "Metadata");
    if (!metadata.ok) {
      setError(metadata.error);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const created = await honcho.sessionFiles.upload(apiOpts, workspaceId, sessionId, {
        file: prepared,
        peerId: effectivePeer,
        metadata: metadata.value,
      });
      push({
        type: "success",
        message: `Uploaded ${file.name} as ${created.length} message${created.length === 1 ? "" : "s"}`,
      });
      onUploaded(created.length);
      reset();
      onClose();
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="UPLOAD_SESSION_FILE"
      open={open}
      onClose={close}
      className="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            CANCEL
          </Button>
          <Button variant="solid" icon="upload" onClick={upload} disabled={!apiOpts || !file || !effectivePeer || busy}>
            {busy ? "UPLOADING…" : "UPLOAD_FILE"}
          </Button>
        </>
      }
    >
      <div className="text-[11px] text-text-muted leading-relaxed">
        Upload into session <span className="text-accent font-mono">{sessionId}</span>. Honcho extracts the document, splits it into messages, and queues those messages for reasoning.
      </div>

      <Field label="AUTHOR_PEER" hint="The peer whose messages the extracted chunks become.">
        <Select
          value={effectivePeer}
          onChange={setPeerId}
          options={peerOptions}
          placeholder={peers.length ? "select a session peer…" : "this session has no peers"}
          disabled={busy || peers.length === 0}
        />
      </Field>

      <Field label="DOCUMENT" hint="PDF, JSON, and text/code files are supported.">
        <div
          className="border border-dashed border-border-light bg-void/40 p-4 text-center transition-colors hover:border-accent/60"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (!busy) chooseFile(event.dataTransfer.files[0]);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept={FILE_UPLOAD_ACCEPT}
            className="sr-only"
            onChange={(event) => chooseFile(event.target.files?.[0])}
            disabled={busy}
            aria-label="Choose a document to upload"
          />
          {file ? (
            <div className="flex flex-col items-center gap-2">
              <Icon name="book" size={22} className="text-accent" />
              <div className="text-xs text-text-primary break-all">{file.name}</div>
              <div className="text-[10px] text-text-muted tabular-nums">
                {file.type || "type inferred from extension"} · {formatBytes(file.size)}
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
                CHOOSE_DIFFERENT_FILE
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Icon name="upload" size={22} className="text-text-muted" />
              <div className="text-xs text-text-primary">Drop a document here</div>
              <div className="text-[10px] text-text-muted">or select one from this device</div>
              <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
                CHOOSE_FILE
              </Button>
            </div>
          )}
        </div>
      </Field>

      <Field label="MESSAGE_METADATA" hint='Optional JSON object applied to each generated message, for example {"source":"manual-upload"}.'>
        <TextInput
          value={metadataJson}
          onChange={(event) => setMetadataJson(event.target.value)}
          placeholder='{"source":"manual-upload"}'
          spellCheck={false}
          disabled={busy}
        />
      </Field>

      <div className="flex items-start gap-2 text-[10px] text-text-muted">
        <Icon name="alert-circle" size={11} className="mt-px shrink-0" />
        <span>The original file is processed in memory and is not stored by Honcho; only extracted message content is retained.</span>
      </div>

      {peers.length === 0 ? (
        <div className="text-xs text-yellow-400">Add a peer to this session before uploading a document.</div>
      ) : null}
      {error ? <div className="text-xs text-red-400">{error}</div> : null}
    </Modal>
  );
}
