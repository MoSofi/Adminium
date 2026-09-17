// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One gallery card (comp 242-274): the thumbnail region with the
 * mini sheet, name + meta, the lang chip and the status pill, and the action
 * row — Edit · Duplicate · Rename · Delete — sliding in on hover AND on
 * focus-within so a keyboard reaches every one (invisible at rest, so the
 * comp's picture is unchanged).
 */
import { Copy, Pencil, TextCursorInput, Trash2 } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { InvoiceSummary } from '../api.js';
import { InvoiceMiniPreview } from './MiniPreview.js';
import { DocumentStatusPill, LangPill } from './Pills.js';
import { cardMeta } from './model.js';

/** What the manager does when a card or row asks (comp 1454-1457). */
export interface DocumentActions {
  onOpen: (doc: InvoiceSummary) => void;
  onDuplicate: (doc: InvoiceSummary) => void;
  onRename: (doc: InvoiceSummary) => void;
  onDelete: (doc: InvoiceSummary) => void;
}

/** The inline rename (comp 257, 302, 1450-1453): one card at a time. */
export interface RenameState {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

export interface DocumentCardProps {
  doc: InvoiceSummary;
  actions: DocumentActions;
  rename: RenameState | null;
}

/** The comp's rename input (257): accent border, surface-2 fill; Enter commits, Escape cancels, blur commits. */
export function RenameInput({ rename, className }: { rename: RenameState; className?: string | undefined }) {
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      rename.onCommit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      rename.onCancel();
    }
  };
  return (
    <input
      // The comp's rename opens focused (257): the person just asked to type here.
      autoFocus
      data-testid="invoices-rename"
      aria-label={t('invoices:card.renameLabel', 'New name')}
      value={rename.value}
      onChange={(event) => rename.onChange(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={rename.onCommit}
      onClick={(event) => event.stopPropagation()}
      className={cn('rounded-lg border border-accent bg-surface-2 px-2 py-[5px] text-[13px] font-bold text-fg outline-none', className)}
    />
  );
}

/** The 32 px square action (comp 268-270); `title` doubles the label for mouse users. */
export function SquareAction({
  label,
  onClick,
  children,
  className,
  testId,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string | undefined;
  testId?: string | undefined;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      data-testid={testId}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-fg-muted transition-colors hover:border-border-strong hover:text-fg',
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * The comp's slide-in (CSS 43-44): the row sits below the card's bottom edge
 * on a surface gradient, slides up over the name row on hover, and — for the
 * keyboard — on focus-within, so Tab reaches every action without a mouse.
 */
export const ACTION_ROW_REVEAL =
  'absolute inset-x-0 bottom-0 translate-y-full bg-[linear-gradient(to_top,var(--surface)_72%,transparent)] px-[15px] pb-3.5 pt-3 ' +
  'pointer-events-none transition-transform duration-[180ms] ease-[cubic-bezier(.2,.7,.3,1)] ' +
  'group-hover:pointer-events-auto group-hover:translate-y-0 group-focus-within:pointer-events-auto group-focus-within:translate-y-0';

export function GalleryCard({ doc, actions, rename }: DocumentCardProps) {
  const renaming = rename !== null && rename.id === doc.id;
  const open = () => actions.onOpen(doc);

  return (
    <article
      data-testid="invoices-card"
      data-id={doc.id}
      className="group relative overflow-hidden rounded-[15px] border border-border bg-surface shadow-card transition-[box-shadow,border-color,transform] duration-150 hover:-translate-y-[3px] hover:border-border-strong hover:shadow-modal"
    >
      <div onClick={open} className="cursor-pointer bg-[linear-gradient(180deg,var(--surface-2),var(--surface))] px-4 pt-4">
        <InvoiceMiniPreview summary={doc.summary} />
      </div>
      <div className="px-[15px] pb-3.5 pt-[13px]">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            {renaming ? (
              <RenameInput rename={rename} className="w-full" />
            ) : (
              <>
                <div data-testid="invoices-card-name" className="truncate text-[13.5px] font-extrabold tracking-[-.01em] text-fg">
                  {doc.name}
                </div>
                <div data-testid="invoices-card-meta" className="mt-0.5 truncate text-[11px] text-fg-subtle">
                  {cardMeta(doc)}
                </div>
              </>
            )}
          </div>
          <LangPill lang={doc.lang} />
          <DocumentStatusPill status={doc.status} />
        </div>
        <div data-testid="invoices-card-actions" className={cn('flex gap-[5px]', ACTION_ROW_REVEAL)}>
          <button
            type="button"
            onClick={open}
            className="flex flex-1 items-center justify-center gap-[5px] rounded-lg border border-border bg-surface-2 p-[7px] text-[11.5px] font-bold text-fg transition-colors hover:border-border-strong"
          >
            <Pencil className="size-[13px]" aria-hidden="true" />
            {t('invoices:card.edit', 'Edit')}
          </button>
          <SquareAction label={t('invoices:card.duplicate', 'Duplicate')} onClick={() => actions.onDuplicate(doc)}>
            <Copy className="size-[13px]" aria-hidden="true" />
          </SquareAction>
          <SquareAction label={t('invoices:card.rename', 'Rename')} onClick={() => actions.onRename(doc)}>
            <TextCursorInput className="size-[13px]" aria-hidden="true" />
          </SquareAction>
          <SquareAction label={t('invoices:card.delete', 'Delete')} onClick={() => actions.onDelete(doc)}>
            <Trash2 className="size-[13px]" aria-hidden="true" />
          </SquareAction>
        </div>
      </div>
    </article>
  );
}
