// SPDX-License-Identifier: AGPL-3.0-only
import { TriangleAlert } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { Button } from '../button/Button.js';
import { Modal, ModalBody, ModalFooter, ModalHeader, type ModalProps } from '../modal/Modal.js';

/**
 * Both type-to-confirm fields share one declaration so they cannot drift into
 * looking like a primary gate and a footnote — they are equal gates, and the
 * second one is the harder of the two to satisfy.
 */
const fieldClass = cn(
  'h-[34px] w-full rounded-md border border-border-strong bg-surface px-3 font-mono text-body text-fg',
  'outline-none placeholder:text-fg-subtle disabled:opacity-40',
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-danger',
);

const labelClass = 'mb-1.5 block text-caption font-bold text-fg-muted';

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
  /**
   * A second, independent type-to-confirm field (35-schema-authoring.md D18:
   * the Super-Admin door over the row ceiling asks for a second, differently
   * derived token in the same confirm). Both fields must match before the
   * danger button enables, so this is an authorisation to ask for, never a
   * decoration — a caller that renders it without meaning it deadlocks its own
   * dialog. When absent, no second field reaches the DOM at all.
   */
  secondPrompt?:
    | {
        /** Label above the second field, already localised by the caller. */
        label: ReactNode;
        /** The exact string that must be typed. */
        expected: string;
        /** Optional hint rendered under the field when it does not yet match. */
        hint?: ReactNode;
      }
    | undefined;
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
 * the danger button (research/design-system.md §3 Tier 3), optionally a second
 * one (`secondPrompt`, D18). Typed values reset whenever the modal closes.
 */
export function ConfirmModal({
  title,
  body,
  confirmWord,
  promptLabel,
  secondPrompt,
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
  // Each field needs its own id. Reusing `inputId` would point both `htmlFor`
  // attributes at the first input: a screen reader then announces the override
  // field under the first field's label, and `getByLabelText` keeps returning
  // the first input, so the tests stay green while the labelling is wrong.
  const secondInputId = useId();
  const hintId = useId();
  const [typed, setTyped] = useState('');
  const [secondTyped, setSecondTyped] = useState('');
  const [pending, setPending] = useState(false);
  const isBusy = busy ?? pending;

  const secondExpected = secondPrompt?.expected;
  // An empty `expected` would be satisfied by a field nobody touched, which is
  // exactly what a value lost in transit looks like — a response serializer
  // that strips the number, a caller interpolating something never measured.
  // A gate that opens for free is worse than one that cannot open, so an empty
  // target counts as unmet.
  const secondMatches =
    secondExpected !== undefined && secondExpected !== '' && secondTyped === secondExpected;
  const ready = typed === confirmWord && (secondPrompt === undefined || secondMatches);

  const hint = secondPrompt?.hint;
  const showHint = !secondMatches && hint !== undefined && hint !== null && hint !== false;

  useEffect(() => {
    if (open === false) {
      setTyped('');
      setSecondTyped('');
    }
  }, [open]);

  // The second field authorises one specific value. If the caller swaps that
  // value while the dialog stays open — a re-plan behind an open confirm — a
  // match carried over from the previous target would authorise something
  // nobody ever read, so what was typed dies with the value it was typed for.
  useEffect(() => {
    setSecondTyped('');
  }, [secondExpected]);

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
        <label htmlFor={inputId} className={labelClass}>
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
          className={fieldClass}
        />
        {secondPrompt === undefined ? null : (
          // Ruled off rather than stacked: two identical mono inputs in a
          // 410px dialog read as the same challenge asked twice, and the
          // operator answers the second one from muscle memory.
          <div className="mt-4 border-t border-border pt-4">
            <label htmlFor={secondInputId} className={labelClass}>
              {secondPrompt.label}
            </label>
            <input
              id={secondInputId}
              type="text"
              value={secondTyped}
              disabled={isBusy}
              onChange={(event) => setSecondTyped(event.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              // Deliberately not `confirm-input`: page-crud/page-record tests
              // reach the first field with a bare
              // `querySelector('[data-part="confirm-input"]')`, which would
              // silently start matching whichever field came first.
              data-part="confirm-input-second"
              {...(showHint ? { 'aria-describedby': hintId } : {})}
              className={fieldClass}
            />
            {showHint ? (
              <p id={hintId} className="mt-1.5 text-[11.5px] leading-4 text-fg-muted">
                {hint}
              </p>
            ) : null}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" disabled={isBusy} onClick={() => onOpenChange?.(false)}>
          {cancelLabel}
        </Button>
        <Button
          variant="destructive"
          disabled={!ready}
          loading={isBusy}
          onClick={() => void handleConfirm()}
        >
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
