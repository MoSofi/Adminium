// SPDX-License-Identifier: AGPL-3.0-only
import { Button } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { Plus } from 'lucide-react';
import { useRef, useState } from 'react';

import { inlineComposeCardConfigSchema, inlineComposeCardDemoData } from './boards-config.js';
import { bindingSourceOf } from './board-lib.js';
import type { InlineComposeCardConfig } from './boards-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { inlineComposeCardConfigSchema, inlineComposeCardDemoData };
export type { InlineComposeCardConfig };

/**
 * `inline-compose-card` (annex §6) — the in-column quick-add: an
 * accent-bordered card with a text input and Add/Cancel, with Enter to commit
 * and Escape to cancel (Project Board). The new record gets the column's sane
 * defaults.
 *
 * It emits a `mutate` INSERT *intent* and clears itself — the widget never
 * writes. The host runs the insert through the CRUD API (undo + audit) and the
 * board re-renders from the next payload, so there is no optimistic row here to
 * fall out of sync with the server's generated id/timestamps.
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
  onAdd?: ((title: string) => void) | undefined;
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
    if (title === '') return;
    onAdd?.(title);
    setDraft('');
    if (keepOpen) inputRef.current?.focus();
    else setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        data-widget="inline-compose-card"
        data-testid={testId}
        data-part="compose-open"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-body-sm text-fg-muted hover:border-accent hover:bg-accent-soft hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
      className="flex flex-col gap-2 rounded-lg border border-accent bg-surface-1 p-2.5 shadow-sm"
    >
      <input
        ref={inputRef}
        type="text"
        autoFocus
        value={draft}
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
        <Button size="sm" variant="primary" data-part="compose-add" disabled={draft.trim() === ''} onClick={commit}>
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
        if (source === null) return; // unbound: nothing to insert into
        onEvent({
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
