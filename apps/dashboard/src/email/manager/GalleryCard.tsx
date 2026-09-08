// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One gallery card (comp 369-402): the mini preview, name + meta, the two
 * pills and the action row — Edit · Duplicate · Rename · Delete, sliding in
 * on hover AND on focus-within so a keyboard reaches every one (D17). In
 * archived mode the four slots become Restore · Duplicate · (no rename) ·
 * Delete for good / Reset to built-in, and the card does not open (D4).
 */
import { ArchiveRestore, Copy, Pencil, RotateCcw, TextCursorInput, Trash2 } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { EmailDocumentSummary } from '../api.js';
import { MiniPreview } from './MiniPreview.js';
import { DocumentStatusPill, LangPill } from './Pills.js';
import { useRunProgress } from '../useRunProgress.js';
import { accentOf, cardMeta, statusOf, type LocaleFacts } from './model.js';

/** What the manager does when a card or row asks (39 Appendix A §M10–M11, D4). */
export interface DocumentActions {
  onOpen: (doc: EmailDocumentSummary) => void;
  onDuplicate: (doc: EmailDocumentSummary) => void;
  onRename: (doc: EmailDocumentSummary) => void;
  onDelete: (doc: EmailDocumentSummary) => void;
  onRestore: (doc: EmailDocumentSummary) => void;
  /** Archived mode's second step: delete the row, or re-seed a built-in key. */
  onDeleteForGood: (doc: EmailDocumentSummary) => void;
}

/** The inline rename (comp 385, 432, 1062-1063): one card at a time. */
export interface RenameState {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

export interface DocumentCardProps {
  doc: EmailDocumentSummary;
  facts: LocaleFacts;
  archived: boolean;
  actions: DocumentActions;
  rename: RenameState | null;
}

/** The comp's rename input: accent border, surface-2 fill, commits on Enter/blur, reverts on Escape. */
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
      // The comp's rename opens focused (385): the person just asked to type here.
      autoFocus
      data-testid="email-rename"
      aria-label={t('email:card.renameLabel', 'New name')}
      value={rename.value}
      onChange={(event) => rename.onChange(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={rename.onCommit}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        'rounded-lg border border-accent bg-surface-2 px-2 py-[5px] text-[13px] font-bold text-fg outline-none',
        className,
      )}
    />
  );
}

/** The 32 px square action (comp 397-399); `title` doubles the label for mouse users. */
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
 * The comp's slide-in (CSS 40-44): the row sits below the card's bottom edge
 * on a surface gradient, slides up over the name row on hover, and — D17 —
 * on focus-within, so Tab reaches every action without a mouse. Rows keep
 * theirs visible (CSS 41).
 */
export const ACTION_ROW_REVEAL =
  'absolute inset-x-0 bottom-0 translate-y-full bg-[linear-gradient(to_top,var(--surface)_72%,transparent)] px-[15px] pb-3.5 pt-3 ' +
  'pointer-events-none transition-transform duration-[180ms] ease-[cubic-bezier(.2,.7,.3,1)] ' +
  'group-hover:pointer-events-auto group-hover:translate-y-0 group-focus-within:pointer-events-auto group-focus-within:translate-y-0';

export function GalleryCard({ doc, facts, archived, actions, rename }: DocumentCardProps) {
  const accent = accentOf(doc);
  const status = statusOf(doc);
  const progress = useRunProgress(doc.run);
  const renaming = rename !== null && rename.id === doc.id;
  const open = () => {
    if (!archived) actions.onOpen(doc);
  };

  return (
    <article
      data-testid="email-card"
      data-id={doc.id}
      className="group relative overflow-hidden rounded-[15px] border border-border bg-surface shadow-card transition-[box-shadow,border-color,transform] duration-150 hover:-translate-y-[3px] hover:border-border-strong hover:shadow-modal"
    >
      <div
        onClick={open}
        className={cn(
          'bg-[linear-gradient(180deg,var(--surface-2),var(--surface))] px-4 pt-4',
          archived ? 'opacity-70' : 'cursor-pointer',
        )}
      >
        <MiniPreview accent={accent} heading={doc.heading === '' ? doc.name : doc.heading} dir={facts.dir} mark={doc.brand?.mark ?? 'hexagon'} />
      </div>
      <div className="px-[15px] pb-3.5 pt-[13px]">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            {renaming ? (
              <RenameInput rename={rename} className="w-full" />
            ) : (
              <>
                <div className="truncate text-[13.5px] font-extrabold tracking-[-.01em] text-fg">{doc.name}</div>
                <div className="mt-0.5 truncate text-[11px] text-fg-subtle">{cardMeta(doc, progress)}</div>
              </>
            )}
          </div>
          <LangPill facts={facts} needsTranslation={doc.needsTranslation} />
          <DocumentStatusPill status={status} />
        </div>
        <div data-testid="email-card-actions" className={cn('flex gap-[5px]', ACTION_ROW_REVEAL)}>
          {archived ? (
            <button
              type="button"
              onClick={() => actions.onRestore(doc)}
              className="flex flex-1 items-center justify-center gap-[5px] rounded-lg border border-border bg-surface-2 p-[7px] text-[11.5px] font-bold text-fg transition-colors hover:border-border-strong"
            >
              <ArchiveRestore className="size-[13px]" aria-hidden="true" />
              {t('email:card.restore', 'Restore')}
            </button>
          ) : (
            <button
              type="button"
              onClick={open}
              className="flex flex-1 items-center justify-center gap-[5px] rounded-lg border border-border bg-surface-2 p-[7px] text-[11.5px] font-bold text-fg transition-colors hover:border-border-strong"
            >
              <Pencil className="size-[13px]" aria-hidden="true" />
              {t('email:card.edit', 'Edit')}
            </button>
          )}
          <SquareAction label={t('email:card.duplicate', 'Duplicate')} onClick={() => actions.onDuplicate(doc)}>
            <Copy className="size-[13px]" aria-hidden="true" />
          </SquareAction>
          {archived ? null : (
            <SquareAction label={t('email:card.rename', 'Rename')} onClick={() => actions.onRename(doc)}>
              <TextCursorInput className="size-[13px]" aria-hidden="true" />
            </SquareAction>
          )}
          {archived ? (
            doc.isBuiltin ? (
              <SquareAction
                label={t('email:card.reset', 'Reset to built-in')}
                onClick={() => actions.onDeleteForGood(doc)}
                testId="email-delete-for-good"
              >
                <RotateCcw className="size-[13px]" aria-hidden="true" />
              </SquareAction>
            ) : (
              <SquareAction
                label={t('email:card.deleteForGood', 'Delete for good')}
                onClick={() => actions.onDeleteForGood(doc)}
                testId="email-delete-for-good"
              >
                <Trash2 className="size-[13px]" aria-hidden="true" />
              </SquareAction>
            )
          ) : (
            <SquareAction label={t('email:card.delete', 'Delete')} onClick={() => actions.onDelete(doc)}>
              <Trash2 className="size-[13px]" aria-hidden="true" />
            </SquareAction>
          )}
        </div>
      </div>
    </article>
  );
}
