// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The list layout (comp 410-450): a card-styled table with the comp's five
 * columns — Name · Lang · Status · Updated · Actions — and rows that open on
 * click. The grid keeps the comp's column recipe; the roles make it a table
 * for assistive tech without giving up the grid.
 */
import { ArchiveRestore, Copy, RotateCcw, TextCursorInput, Trash2 } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { cn } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { RenameInput, type DocumentCardProps } from './GalleryCard.js';
import { CategoryIcon } from './GroupHeader.js';
import { DocumentStatusPill, LangPill } from './Pills.js';
import { accentOf, statusOf } from './model.js';

const GRID = 'grid grid-cols-[minmax(150px,1.6fr)_74px_92px_96px_108px] gap-2.5 px-[18px]';

/** The 30 px square action of a row (comp 445-447): surface fill, not surface-2. */
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
    <div
      role="row"
      className={cn(
        GRID,
        'border-b border-border bg-surface-2 py-[11px] text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle',
      )}
    >
      <span role="columnheader">{t('email:list.name', 'Name')}</span>
      <span role="columnheader">{t('email:list.lang', 'Lang')}</span>
      <span role="columnheader">{t('email:list.status', 'Status')}</span>
      <span role="columnheader">{t('email:list.updated', 'Updated')}</span>
      <span role="columnheader" className="text-end">
        {t('email:list.actions', 'Actions')}
      </span>
    </div>
  );
}

export interface ListRowProps extends DocumentCardProps {
  /** "2 days ago" — `null` renders the dash. */
  updated: string | null;
}

export function ListRow({ doc, facts, archived, actions, rename, updated }: ListRowProps) {
  const accent = accentOf(doc);
  const status = statusOf(doc);
  const renaming = rename !== null && rename.id === doc.id;
  const open = () => {
    if (!archived) actions.onOpen(doc);
  };
  const onRowClick = (event: MouseEvent<HTMLDivElement>) => {
    // Buttons and the rename input own their clicks; the rest of the row opens.
    if ((event.target as HTMLElement).closest('button, input') !== null) return;
    open();
  };

  return (
    <div
      role="row"
      data-testid="email-row"
      data-id={doc.id}
      onClick={onRowClick}
      className={cn(
        GRID,
        'group items-center border-b border-border py-[13px] transition-colors last:border-b-0 hover:bg-surface-2',
        archived ? 'opacity-80' : 'cursor-pointer',
      )}
    >
      <div role="cell" className="flex min-w-0 items-center gap-3" style={{ '--adm-email-accent': accent }}>
        <div className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-[color-mix(in_srgb,var(--adm-email-accent)_12%,transparent)] text-[var(--adm-email-accent)]">
          <CategoryIcon category={doc.category} className="size-[17px]" />
        </div>
        <div className="min-w-0">
          {renaming ? (
            <RenameInput rename={rename} className="w-[220px] max-w-[50vw]" />
          ) : (
            <>
              {archived ? (
                <div className="truncate text-[13px] font-bold text-fg">{doc.name}</div>
              ) : (
                <button
                  type="button"
                  onClick={open}
                  className="block max-w-full truncate text-start text-[13px] font-bold text-fg outline-none focus-visible:underline"
                >
                  {doc.name}
                </button>
              )}
              <div className="mt-px truncate text-[11px] text-fg-subtle">{doc.subject}</div>
            </>
          )}
        </div>
      </div>
      <span role="cell" className="flex min-w-0 items-center">
        <LangPill facts={facts} needsTranslation={doc.needsTranslation} />
      </span>
      <span role="cell">
        <DocumentStatusPill status={status} />
      </span>
      <span role="cell" className="text-[12px] text-fg-muted">
        {updated ?? '—'}
      </span>
      <div role="cell" data-testid="email-row-actions" className="flex justify-end gap-[5px]">
        {archived ? (
          <RowAction label={t('email:card.restore', 'Restore')} onClick={() => actions.onRestore(doc)}>
            <ArchiveRestore className="size-[13px]" aria-hidden="true" />
          </RowAction>
        ) : null}
        <RowAction label={t('email:card.duplicate', 'Duplicate')} onClick={() => actions.onDuplicate(doc)}>
          <Copy className="size-[13px]" aria-hidden="true" />
        </RowAction>
        {archived ? null : (
          <RowAction label={t('email:card.rename', 'Rename')} onClick={() => actions.onRename(doc)}>
            <TextCursorInput className="size-[13px]" aria-hidden="true" />
          </RowAction>
        )}
        {archived ? (
          doc.isBuiltin ? (
            <RowAction label={t('email:card.reset', 'Reset to built-in')} onClick={() => actions.onDeleteForGood(doc)} testId="email-delete-for-good">
              <RotateCcw className="size-[13px]" aria-hidden="true" />
            </RowAction>
          ) : (
            <RowAction label={t('email:card.deleteForGood', 'Delete for good')} onClick={() => actions.onDeleteForGood(doc)} testId="email-delete-for-good">
              <Trash2 className="size-[13px]" aria-hidden="true" />
            </RowAction>
          )
        ) : (
          <RowAction label={t('email:card.delete', 'Delete')} onClick={() => actions.onDelete(doc)}>
            <Trash2 className="size-[13px]" aria-hidden="true" />
          </RowAction>
        )}
      </div>
    </div>
  );
}

/** The surrounding card + header (comp 417-421); rows go inside. */
export function ListTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="table" aria-label={label} className="overflow-hidden rounded-[15px] border border-border bg-surface shadow-card">
      <ListHeader />
      {children}
    </div>
  );
}
