// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The list layout (43-report-builder.md Appendix A M11; comp 214-245): ONE
 * card-styled table with the comp's four columns — Name · Status · Updated ·
 * Actions — and rows that open on click. No group bands: this comp has no
 * grouping (M7). The grid keeps the comp's column recipe; the roles make it a
 * table for assistive tech without giving up the grid.
 */
import type { MouseEvent, ReactNode } from 'react';
import { cn } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { reportIcon } from '../icons.js';
import { CopyGlyph, RenameGlyph, RenameInput, TrashGlyph, type DocumentCardProps } from './GalleryCard.js';
import { DocumentStatusPill } from './Pills.js';
import { rowIcon, rowSub } from './model.js';

const GRID = 'grid grid-cols-[minmax(0,1fr)_130px_120px_128px] gap-3 px-[18px]';

/** The 30 px square action of a row (comp 240-242): surface fill, not surface-2. */
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
      <span role="columnheader">{t('reportBuilder:list.name', 'Name')}</span>
      <span role="columnheader">{t('reportBuilder:list.status', 'Status')}</span>
      <span role="columnheader">{t('reportBuilder:list.updated', 'Updated')}</span>
      <span role="columnheader" className="text-end">
        {t('reportBuilder:list.actions', 'Actions')}
      </span>
    </div>
  );
}

export interface ListRowProps extends DocumentCardProps {
  /** "2 days ago" — `null` renders the dash. */
  updated: string | null;
}

export function ListRow({ doc, actions, rename, updated }: ListRowProps) {
  const Glyph = reportIcon(rowIcon(doc));
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
      data-testid="report-row"
      data-id={doc.id}
      onClick={onRowClick}
      className={cn(GRID, 'group cursor-pointer items-center border-b border-border py-[13px] transition-colors hover:bg-surface-2')}
    >
      <div role="cell" className="flex min-w-0 items-center gap-3" style={{ '--adm-report-accent': doc.summary.accent }}>
        <div className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-[color-mix(in_srgb,var(--adm-report-accent)_12%,transparent)] text-[var(--adm-report-accent)] dark:bg-[color-mix(in_srgb,var(--adm-report-accent)_20%,transparent)]">
          <Glyph className="size-[17px]" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          {renaming ? (
            <RenameInput rename={rename} className="w-[220px] max-w-[50vw]" />
          ) : (
            <>
              <button type="button" onClick={open} className="block max-w-full truncate text-start text-[13px] font-bold text-fg outline-none focus-visible:underline">
                {doc.name}
              </button>
              <div data-testid="report-row-sub" className="mt-px truncate text-[11px] text-fg-subtle">
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
      <div role="cell" data-testid="report-row-actions" className="flex justify-end gap-[5px]">
        <RowAction label={t('reportBuilder:card.duplicate', 'Duplicate')} onClick={() => actions.onDuplicate(doc)}>
          <CopyGlyph />
        </RowAction>
        <RowAction label={t('reportBuilder:card.rename', 'Rename')} onClick={() => actions.onRename(doc)}>
          <RenameGlyph />
        </RowAction>
        <RowAction label={t('reportBuilder:card.delete', 'Delete')} onClick={() => actions.onDelete(doc)}>
          <TrashGlyph />
        </RowAction>
      </div>
    </div>
  );
}

/** The surrounding card + the one column header (comp 215-217); rows go inside. */
export function ListTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="table" aria-label={label} data-testid="report-list" className="overflow-hidden rounded-[15px] border border-border bg-surface shadow-card">
      <ListHeader />
      {children}
    </div>
  );
}
