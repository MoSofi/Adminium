// SPDX-License-Identifier: AGPL-3.0-only
import { Button } from '@adminium/ui';
import { useMaybeT } from '../../lib/i18n.js';
import { Plus } from 'lucide-react';
import { useRef, useState } from 'react';

import { inlineComposeCardConfigSchema, inlineComposeCardDemoData } from './boards-config.js';
import { bindingSourceOf } from './board-lib.js';
import type { InlineComposeCardConfig } from './boards-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { inlineComposeCardConfigSchema, inlineComposeCardDemoData };
export type { InlineComposeCardConfig };

/**
 * `inline-compose-card` (annex) — the in-column quick-add: an accent-bordered
 * card with a text input and Add/Cancel, with Enter to commit and Escape to
 * cancel (Project Board). The new record gets the column's sane defaults.
 *
 * It emits a `mutate` INSERT *intent* — the widget never writes. The host runs
 * the insert through the CRUD API (undo + audit) and the board re-renders from
 * the next payload, so there is no optimistic row here to fall out of sync
 * with the server's generated id/timestamps.
 *
 * It clears itself when the insert HOLDS. A host that hands back the save's
 * promise has the typed title kept — and not editable — until that answers: a
 * refused insert leaves it in the box, to be corrected or sent again, where
 * clearing at once lost it with nothing said. A host that hands back nothing
 * is taken at its word and the box clears at once, as before.
 *
 * `keepOpen` (the default) leaves the composer open after Add so a planning
 * session can type card after card — the behaviour the comp demonstrates.
 */

export interface InlineComposeCardProps {
  placeholder?: string | undefined;
  addLabel?: string | undefined;
  cancelLabel?: string | undefined;
  openLabel?: string | undefined;
  /** Start expanded (a dedicated compose slot) vs. behind the add affordance. */
  defaultOpen?: boolean | undefined;
  /** Keep the composer open after a successful add, for rapid entry. */
  keepOpen?: boolean | undefined;
  /** Nothing can be added just now (a board whose columns are not there yet): the composer is shown and takes nothing. */
  disabled?: boolean | undefined;
  /** Add a card; return the save's promise and the title is kept until it holds (and after it is refused). */
  onAdd?: ((title: string) => void | Promise<unknown>) | undefined;
  onCancel?: (() => void) | undefined;
  testId?: string | undefined;
}

export function InlineComposeCard({
  placeholder,
  addLabel,
  cancelLabel,
  openLabel,
  defaultOpen = false,
  keepOpen = true,
  disabled = false,
  onAdd,
  onCancel,
  testId,
}: InlineComposeCardProps) {
  const t = useMaybeT();
  const resolvedPlaceholder = placeholder ?? t('ui:widgets.boards.inlineComposeCard.placeholder', 'Card title…');
  const resolvedAddLabel = addLabel ?? t('ui:widgets.boards.inlineComposeCard.addLabel', 'Add');
  const resolvedCancelLabel = cancelLabel ?? t('ui:widgets.boards.inlineComposeCard.cancelLabel', 'Cancel');
  const resolvedOpenLabel = openLabel ?? t('ui:widgets.boards.inlineComposeCard.openLabel', 'Add card');
  const [open, setOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState('');
  // The insert has been sent and has not answered: the title is kept as it was sent.
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = (): void => {
    setDraft('');
    setOpen(false);
    onCancel?.();
  };

  const commit = (): void => {
    const title = draft.trim();
    // A whitespace-only draft is not a card: committing it would insert a
    // titleless row the board renders as "#1".
    if (title === '' || disabled || saving) return;
    const added = (): void => {
      setDraft('');
      if (keepOpen) inputRef.current?.focus();
      else setOpen(false);
    };
    const result = onAdd?.(title);
    if (result === undefined || typeof (result as Promise<unknown>).then !== 'function') {
      added();
      return;
    }
    setSaving(true);
    (result as Promise<unknown>).then(
      () => {
        setSaving(false);
        added();
      },
      () => {
        // Refused: whoever ran the insert says why. The title stays, ready to be sent again.
        setSaving(false);
        inputRef.current?.focus();
      },
    );
  };

  if (!open) {
    return (
      <button
        type="button"
        data-widget="inline-compose-card"
        data-testid={testId}
        data-part="compose-open"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-body-sm text-fg-muted hover:border-accent hover:bg-accent-soft hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-transparent disabled:hover:text-fg-muted"
      >
        <Plus aria-hidden="true" className="size-4" />
        {resolvedOpenLabel}
      </button>
    );
  }

  return (
    <div
      data-widget="inline-compose-card"
      data-testid={testId}
      data-part="compose-card"
      className="flex flex-col gap-2 rounded-lg border border-accent bg-surface p-2.5 shadow-sm"
    >
      <input
        ref={inputRef}
        type="text"
        autoFocus
        value={draft}
        readOnly={saving}
        aria-busy={saving || undefined}
        aria-label={resolvedPlaceholder}
        placeholder={resolvedPlaceholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          // Enter commits, Escape cancels (annex). Both stop propagating: this
          // composer lives INSIDE a board column, whose own key handler drives
          // card drag/drop — an un-stopped Escape would cancel a drag instead.
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            commit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
        className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-body-sm text-fg placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-accent"
      />
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="primary" data-part="compose-add" disabled={disabled || saving || draft.trim() === ''} onClick={commit}>
          {resolvedAddLabel}
        </Button>
        <Button size="sm" variant="ghost" data-part="compose-cancel" onClick={close}>
          {resolvedCancelLabel}
        </Button>
      </div>
    </div>
  );
}

export function InlineComposeCardWidget({ config, onEvent }: WidgetProps<InlineComposeCardConfig>) {
  const source = bindingSourceOf(config.binding);
  return (
    <InlineComposeCard
      defaultOpen={config.defaultOpen}
      keepOpen={config.keepOpen}
      {...(config.placeholder === undefined ? {} : { placeholder: config.placeholder })}
      {...(config.addLabel === undefined ? {} : { addLabel: config.addLabel })}
      {...(config.cancelLabel === undefined ? {} : { cancelLabel: config.cancelLabel })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
      onAdd={(title) => {
        if (source === null) return undefined; // unbound: nothing to insert into
        // The host's result, so a refused insert keeps the typed title.
        return onEvent({
          type: 'mutate',
          intent: 'insert',
          connectionId: source.connectionId,
          table: source.table,
          // Config defaults first so the typed title can never be clobbered by a
          // stale `defaults: { title: … }` left in a stored config.
          values: { ...config.defaults, [config.titleField]: title },
        });
      }}
    />
  );
}
