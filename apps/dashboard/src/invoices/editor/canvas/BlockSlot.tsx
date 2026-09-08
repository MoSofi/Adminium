// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One block's slot in the stack (comp 383-387, 1494-1508; 34-invoices-add-
 * on.md Appendix E §C5–C6): the wrapper that fades to 40 % while dragged and
 * paints an inset 3 px accent bar when dragged over, the insert affordance
 * 25 px above it — two accent hairlines flanking an *Add section* pill,
 * revealed on hover — and the grip in the left gutter, 22×26 at −28 px,
 * revealed on hover, that drags the block.
 *
 * Indexes are PRE-FILTER (`VisibleBlock.index`): the comp's drag/drop and
 * insert speak `blockOrder` positions so a hidden block keeps its place.
 *
 * A11Y additions: the grip is a real button (the comp's is a span) that
 * also moves the block with ArrowUp / ArrowDown, and both affordances
 * reveal on focus as well as on hover.
 */
import { GripVertical, Plus } from 'lucide-react';
import type { DragEvent, KeyboardEvent, ReactNode } from 'react';
import { cn } from '@adminium/ui';

import { t } from '../../../i18n/t.js';

export interface BlockSlotProps {
  /** The block's key, or `custom.<type>` for a user-authored one. */
  kind: string;
  /** The pre-filter index in `blockOrder`. */
  index: number;
  label: string;
  dragging: boolean;
  over: boolean;
  onDragStart: (index: number, event: DragEvent<HTMLElement>) => void;
  onDragOver: (index: number) => void;
  onDrop: (index: number) => void;
  onDragEnd: () => void;
  /** The between-block chip: the modal opens at this pre-filter index. */
  onInsertAt: (index: number) => void;
  /** The keyboard path: move this block one visible step up or down. */
  onMove: (index: number, direction: -1 | 1) => void;
  children: ReactNode;
}

export function BlockSlot({ kind, index, label, dragging, over, onDragStart, onDragOver, onDrop, onDragEnd, onInsertAt, onMove, children }: BlockSlotProps) {
  const onGripKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      onMove(index, -1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      onMove(index, 1);
    }
  };
  return (
    <div
      data-testid="invoices-block"
      data-block={kind}
      data-index={index}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver(index);
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(index);
      }}
      className={cn(
        'group/blk relative rounded-lg transition-[opacity,box-shadow] duration-150',
        dragging && 'opacity-40',
        over && 'shadow-[inset_0_3px_0_0_var(--adm-invoice-accent)]',
      )}
    >
      <button
        type="button"
        data-testid="invoices-insert-above"
        title={t('invoices:canvas.insertHere', 'Add a section here')}
        aria-label={t('invoices:canvas.insertAbove', 'Add a section above {label}', { label })}
        onClick={(event) => {
          event.stopPropagation();
          onInsertAt(index);
        }}
        className="absolute inset-x-0 -top-[25px] flex h-6 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-hover/blk:opacity-100"
      >
        <span className="block h-px flex-1 bg-[var(--adm-invoice-accent)] opacity-30" aria-hidden="true" />
        <span className="inline-flex shrink-0 items-center gap-[5px] rounded-[20px] bg-[var(--adm-invoice-accent-soft)] px-[9px] py-[3px] text-[10.5px] font-bold text-[var(--adm-invoice-accent)]">
          <Plus className="size-3" aria-hidden="true" />
          {t('invoices:canvas.addSection', 'Add section')}
        </span>
        <span className="block h-px flex-1 bg-[var(--adm-invoice-accent)] opacity-30" aria-hidden="true" />
      </button>
      <button
        type="button"
        data-testid="invoices-grip"
        draggable
        title={t('invoices:canvas.reorderSection', 'Drag to reorder section')}
        aria-label={t('invoices:canvas.reorderSectionOf', 'Drag to reorder section: {label}', { label })}
        onDragStart={(event) => onDragStart(index, event)}
        onDragEnd={onDragEnd}
        onKeyDown={onGripKey}
        onClick={(event) => event.stopPropagation()}
        className="absolute -start-7 top-0 flex h-[26px] w-[22px] cursor-grab items-center justify-center rounded-md border-0 bg-transparent p-0 text-[#6b6b76] opacity-0 transition-opacity duration-150 hover:text-[var(--adm-invoice-accent)] hover:opacity-100 focus-visible:opacity-100 group-hover/blk:opacity-75"
      >
        <GripVertical className="size-[15px]" aria-hidden="true" />
      </button>
      {children}
    </div>
  );
}
