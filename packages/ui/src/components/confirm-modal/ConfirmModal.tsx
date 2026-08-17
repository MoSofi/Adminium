// SPDX-License-Identifier: AGPL-3.0-only
import { TriangleAlert } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { Button } from '../button/Button.js';
import { Modal, ModalBody, ModalFooter, ModalHeader, type ModalProps } from '../modal/Modal.js';

export interface ConfirmModalProps extends Omit<ModalProps, 'children' | 'size'> {
  /** Dialog title (e.g. "Delete project"). */
  title: ReactNode;
  /** Consequence copy ("This permanently deletes acme-prod and all 12 tables."). */
  body?: ReactNode;
  /**
   * The exact word/phrase to type (project name, "DELETE", …). The danger
   * button stays disabled until the input matches it exactly.
   */
  confirmWord: string;
  /** Label above the type-to-confirm input, e.g. `Type "acme-prod" to confirm`. */
  promptLabel: ReactNode;
  /** Danger button label (required — i18n). */
  confirmLabel: string;
  /** Cancel button label (required — i18n). */
  cancelLabel: string;
  /** Close-icon accessible label (required — i18n). */
  closeLabel: string;
  /**
   * Confirm handler. Return a promise to get a built-in busy state (spinner
   * on the danger button, inputs locked) until it settles; the caller closes
   * the modal on success.
   */
  onConfirm: () => void | Promise<void>;
  /** Externally-controlled busy state (overrides the built-in one). */
  busy?: boolean | undefined;
  /** Override the header icon (defaults to a danger triangle). */
  icon?: ReactNode;
}

/**
 * ConfirmModal — destructive confirmation with a type-to-confirm input gating
 * the danger button (research/design-system.md §3 Tier 3). The typed value
 * resets whenever the modal closes.
 */
export function ConfirmModal({
  title,
  body,
  confirmWord,
  promptLabel,
  confirmLabel,
  cancelLabel,
  closeLabel,
  onConfirm,
  busy,
  icon,
  open,
  onOpenChange,
  ...modalProps
}: ConfirmModalProps) {
  const inputId = useId();
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);
  const isBusy = busy ?? pending;
  const matches = typed === confirmWord;

  useEffect(() => {
    if (open === false) setTyped('');
  }, [open]);

  const handleConfirm = async () => {
    const result = onConfirm();
    if (result instanceof Promise) {
      setPending(true);
      try {
        await result;
      } finally {
        setPending(false);
      }
    }
  };

  return (
    <Modal
      size="sm"
      {...(open === undefined ? {} : { open })}
      onOpenChange={(next) => {
        if (isBusy && !next) return; // don't dismiss mid-flight
        onOpenChange?.(next);
      }}
      {...modalProps}
    >
      <ModalHeader
        tone="danger"
        icon={icon ?? <TriangleAlert />}
        title={title}
        subtitle={body}
        closeLabel={closeLabel}
      />
      <ModalBody>
        <label htmlFor={inputId} className="mb-1.5 block text-caption font-bold text-fg-muted">
          {promptLabel}
        </label>
        <input
          id={inputId}
          type="text"
          value={typed}
          disabled={isBusy}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          data-part="confirm-input"
          className={cn(
            'h-[34px] w-full rounded-md border border-border-strong bg-surface px-3 font-mono text-body text-fg',
            'outline-none placeholder:text-fg-subtle disabled:opacity-40',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-danger',
          )}
        />
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" disabled={isBusy} onClick={() => onOpenChange?.(false)}>
          {cancelLabel}
        </Button>
        <Button
          variant="destructive"
          disabled={!matches}
          loading={isBusy}
          onClick={() => void handleConfirm()}
        >
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
