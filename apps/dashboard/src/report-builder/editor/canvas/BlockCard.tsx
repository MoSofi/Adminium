// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One block card on the sheet (comp 304-314, `cardStyle` 616-621, `wrapStyle`
 * 613; 43-report-builder.md Appendix A C3–C5, D17): a 13 px-radius card whose
 * head row is grip · the kind's glyph · the inline title · up · down · delete,
 * with the kind's body beneath.
 *
 * FOUR STATES, THE COMP'S (616-621): selected draws a 1.5 px accent border
 * and a 3 % accent wash; `show: false` renders at 50 % opacity (it never
 * removes and never re-orders — 43 §0.3 trap 2); dragging is 50 % too; being
 * dragged OVER paints a 3 px accent bar on the top edge.
 *
 * DRAG IS THE COMP'S HTML5 CHOREOGRAPHY (306, 626) plus a keyboard path
 * (D17): the grip is a real button, so ArrowUp/ArrowDown reorder without a
 * mouse — invisible at rest, and Playwright's `dragTo` cannot drive HTML5 DnD
 * reliably in CI (43 §8).
 */
import type { DragEvent, ReactNode } from 'react';
import { cn } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import { BLOCK_KIND_META } from '../../model/blocks.js';
import type { DocumentEdits } from '../../model/edits.js';
import type { ReportBlock } from '../../model/envelope.js';
import type { Selection } from '../../model/ops.js';
import { reportIcon } from '../../icons.js';
import { blockLabel } from '../blockText.js';
import { InlineInput } from './inline.js';

export interface BlockCardProps {
  block: ReportBlock;
  index: number;
  count: number;
  selection: Selection;
  edits: DocumentEdits;
  dragging: number | null;
  over: number | null;
  onDragState: (state: { dragging?: number | null; over?: number | null }) => void;
  children: ReactNode;
}

/** The comp's 24 px head-row button (309-312) — revealed on hover and on focus-within. */
function HeadAction({ label, glyph, onClick }: { label: string; glyph: string; onClick: () => void }) {
  const Glyph = reportIcon(glyph);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="flex size-6 items-center justify-center rounded-md border-0 bg-transparent text-[#6b6b76] transition-colors hover:text-[#191920]"
    >
      <Glyph className="size-3.5" aria-hidden="true" />
    </button>
  );
}

export function BlockCard({ block, index, count, selection, edits, dragging, over, onDragState, children }: BlockCardProps) {
  const selected = selection === block.id;
  const isDragging = dragging === index;
  const isOver = over === index && dragging !== null && dragging !== index;
  const KindGlyph = reportIcon(BLOCK_KIND_META[block.kind].icon);
  const GripGlyph = reportIcon('grip-vertical');
  const label = blockLabel(block.kind);

  const onDragStart = (event: DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = 'move';
    try {
      event.dataTransfer.setData('text/plain', String(index));
    } catch {
      // Some engines refuse a payload on dragstart; the index in state is enough.
    }
    onDragState({ dragging: index });
  };

  return (
    <div className={block.w === 'half' ? 'w-[calc(50%-8px)]' : 'w-full'} data-testid="report-block-wrap" data-width={block.w}>
      <div
        data-testid="report-block"
        data-kind={block.kind}
        data-id={block.id}
        data-selected={selected ? '' : undefined}
        data-hidden={block.show ? undefined : ''}
        onClick={() => edits.select(block.id)}
        onDragOver={(event) => {
          event.preventDefault();
          if (over !== index) onDragState({ over: index });
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (dragging !== null) edits.reorderBlock(dragging, index);
          onDragState({ dragging: null, over: null });
        }}
        className={cn(
          'group/block cursor-pointer rounded-[13px] border p-[15px] transition-[opacity,box-shadow] duration-[120ms]',
          selected ? 'border-[1.5px] border-[color:var(--adm-report-accent)] bg-[color-mix(in_srgb,var(--adm-report-accent)_3%,transparent)]' : 'border-[#ececef] bg-white',
          !block.show && 'opacity-50',
          isDragging && 'opacity-50',
          isOver && 'shadow-[0_-3px_0_0_var(--adm-report-accent)]',
        )}
      >
        <div className="mb-2.5 flex items-center gap-2">
          {/* The comp's grip is a bare `<span draggable>` (306). A real button
              carries the same drag handlers AND ArrowUp/ArrowDown, so a keyboard
              reorders too (D17); it looks identical at rest. */}
          <button
            type="button"
            draggable
            data-testid="report-block-grip"
            title={t('reportBuilder:canvas.drag', 'Drag to reorder')}
            aria-label={t('reportBuilder:canvas.drag', 'Drag to reorder')}
            onDragStart={onDragStart}
            onDragEnd={() => onDragState({ dragging: null, over: null })}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
              event.preventDefault();
              event.stopPropagation();
              edits.swapBlock(block.id, event.key === 'ArrowUp' ? -1 : 1);
            }}
            className="flex cursor-grab items-center border-0 bg-transparent p-0 text-[#6b6b76]"
          >
            <GripGlyph className="size-3.5" aria-hidden="true" />
          </button>
          <KindGlyph className="size-[15px] shrink-0 text-[#6b6b76]" aria-hidden="true" />
          <InlineInput
            label={t('reportBuilder:canvas.blockTitle', 'Block title')}
            data-testid="report-block-title"
            value={block.title}
            onFocus={edits.beginEdit}
            onChange={(value) => edits.patchBlock(block.id, { title: value })}
            className="flex-1 text-[12.5px] font-bold"
          />
          <span
            data-testid="report-block-actions"
            className="flex gap-0.5 opacity-0 transition-opacity duration-[120ms] group-hover/block:opacity-100 group-focus-within/block:opacity-100"
          >
            <HeadAction
              label={t('reportBuilder:canvas.moveUp', 'Move up')}
              glyph="chevron-up"
              onClick={() => index > 0 && edits.swapBlock(block.id, -1)}
            />
            <HeadAction
              label={t('reportBuilder:canvas.moveDown', 'Move down')}
              glyph="chevron-down"
              onClick={() => index < count - 1 && edits.swapBlock(block.id, 1)}
            />
            <HeadAction label={t('reportBuilder:canvas.deleteBlock', 'Delete block')} glyph="trash-2" onClick={() => edits.deleteBlock(block.id)} />
          </span>
        </div>
        {children}
        {/* The keyboard's way to point the inspector at this block, invisible at rest. */}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            edits.select(block.id);
          }}
          className="sr-only focus:not-sr-only focus:mt-2 focus:inline-block focus:rounded-md focus:bg-white focus:px-2 focus:py-0.5 focus:text-[10.5px] focus:font-bold focus:text-[var(--adm-report-accent)] focus:shadow-[0_0_0_2px_var(--adm-report-accent)] focus:outline-none"
        >
          {t('reportBuilder:canvas.selectBlock', 'Edit {label}', { label })}
        </button>
      </div>
    </div>
  );
}
