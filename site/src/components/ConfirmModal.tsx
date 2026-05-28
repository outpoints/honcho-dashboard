"use client";

import { Modal } from "@/components/Modal";
import { Button } from "@/components/atoms";

export interface ConfirmModalProps {
  open: boolean;
  title?: string;
  body: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmModal({
  open,
  title = "CONFIRM_REMOVE",
  body,
  confirmLabel = "CONFIRM",
  cancelLabel = "CANCEL",
  destructive = true,
  onCancel,
  onConfirm,
}: ConfirmModalProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "warning" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
      className="max-w-md"
    >
      <div className="text-xs text-text-muted leading-relaxed">{body}</div>
    </Modal>
  );
}
