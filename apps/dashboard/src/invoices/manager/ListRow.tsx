// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The list layout (comp 283-320): ONE card-styled table with the
 * comp's four columns — Name · Status · Updated · Actions — group bands
 * between runs of rows, and rows that open on click. The language chip sits
 * beside the name (this comp has no Lang column). The grid keeps the comp's
 * column recipe; the roles make it a table for assistive tech without giving
 * up the grid.
 */
import { Copy, TextCursorInput, Trash2 } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { cn } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { invoiceIcon } from '../icons.js';
import { RenameInput, type DocumentCardProps } from './GalleryCard.js';
import { DocumentStatusPill, LangPill } from './Pills.js';
import { rowIcon, rowSub } from './model.js';

const GRID = 'grid grid-cols-[minmax(0,1fr)_130px_120px_128px] gap-3 px-[18px]';

/** The 30 px square action of a row (comp 315-317): surface fill, not surface-2. */
function RowAction({ label, onClick, children, testId }: { label: string; onClick: () => void; children: ReactNode; testId?: string | undefined }) {
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
      className="flex size-[30px] items-center justify-center rounded-lg border border-border bg-surface text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
    >
      {children}
    </button>
  );
}

export function ListHeader() {
  return (
    <div role="row" className={cn(GRID, 'border-b border-border bg-surface-2 py-[11px] text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle')}>
      <span role="columnheader">{t('invoices:list.name', 'Name')}</span>
      <span role="columnheader">{t('invoices:list.status', 'Status')}</span>
      <span role="columnheader">{t('invoices:list.updated', 'Updated')}</span>
      <span role="columnheader" className="text-end">
        {t('invoices:list.actions', 'Actions')}
      </span>
    </div>
  );
}

export interface ListRowProps extends DocumentCardProps {
  /** "2 days ago" — `null` renders the dash. */
  updated: string | null;
}

export function ListRow({ doc, actions, rename, updated }: ListRowProps) {
  const Glyph = invoiceIcon(rowIcon(doc.summary));
  const renaming = rename !== null && rename.id === doc.id;
  const open = () => actions.onOpen(doc);
  const onRowClick = (event: MouseEvent<HTMLDivElement>) => {
    // Buttons and the rename input own their clicks; the rest of the row opens.
    if ((event.target as HTMLElement).closest('button, input') !== null) return;
    open();
  };

  return (
    <div
      role="row"
      data-testid="invoices-row"
      data-id={doc.id}
      onClick={onRowClick}
      className={cn(GRID, 'group cursor-pointer items-center border-b border-border py-[13px] transition-colors hover:bg-surface-2')}
    >
      <div role="cell" className="flex min-w-0 items-center gap-3" style={{ '--adm-invoice-accent': doc.summary.accent }}>
        <div className="flex size-[38px] shrink-0 items-center justify-center rounded-[10px] bg-[color-mix(in_srgb,var(--adm-invoice-accent)_12%,transparent)] text-[var(--adm-invoice-accent)] dark:bg-[color-mix(in_srgb,var(--adm-invoice-accent)_20%,transparent)]">
          <Glyph className="size-[17px]" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          {renaming ? (
            <RenameInput rename={rename} className="w-[220px] max-w-[50vw]" />
          ) : (
            <>
              <div className="flex min-w-0 items-center gap-[7px]">
                <button type="button" onClick={open} className="block max-w-full truncate text-start text-[13px] font-bold text-fg outline-none focus-visible:underline">
                  {doc.name}
                </button>
                <LangPill lang={doc.lang} />
              </div>
              <div data-testid="invoices-row-sub" className="mt-px truncate text-[11px] text-fg-subtle">
                {rowSub(doc)}
              </div>
            </>
          )}
        </div>
      </div>
      <span role="cell">
        <DocumentStatusPill status={doc.status} />
      </span>
      <span role="cell" className="text-[12px] text-fg-muted">
        {updated ?? '—'}
      </span>
      <div role="cell" data-testid="invoices-row-actions" className="flex justify-end gap-[5px]">
        <RowAction label={t('invoices:card.duplicate', 'Duplicate')} onClick={() => actions.onDuplicate(doc)}>
          <Copy className="size-[13px]" aria-hidden="true" />
        </RowAction>
        <RowAction label={t('invoices:card.rename', 'Rename')} onClick={() => actions.onRename(doc)}>
          <TextCursorInput className="size-[13px]" aria-hidden="true" />
        </RowAction>
        <RowAction label={t('invoices:card.delete', 'Delete')} onClick={() => actions.onDelete(doc)}>
          <Trash2 className="size-[13px]" aria-hidden="true" />
        </RowAction>
      </div>
    </div>
  );
}

/** The surrounding card + the one column header (comp 284-288); group bands and rows go inside. */
export function ListTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="table" aria-label={label} data-testid="invoices-list" className="overflow-hidden rounded-[15px] border border-border bg-surface shadow-card">
      <ListHeader />
      {children}
    </div>
  );
}
