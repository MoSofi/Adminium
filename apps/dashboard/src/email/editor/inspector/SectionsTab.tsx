// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Sections tab (comp 594-622, Appendix A §E3): the four pinned rows
 * with their lock, the outline of body sections — drag to reorder, with
 * Duplicate / Remove on hover — *Add section*, and the saved blocks list.
 *
 * D17: the outline's drag is a mouse affordance; *Move up* / *Move down*
 * icon buttons reveal on focus so a keyboard reorders too, and every hover
 * action also reveals on focus-within.
 */
import { Bookmark, ChevronDown, ChevronUp, Copy, GripVertical, Lock, Paperclip, PanelBottom, PencilRuler, Plus, Trash2, Type } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { IconButton, cn } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import { emailIcon } from '../../icons.js';
import type { EmailBlockRecord, EmailSavedBlock } from '../../api.js';
import { blockLabel } from '../blockText.js';
import { blockDef } from '../canvas/blocks/index.js';
import type { CanvasSelection } from '../canvas/EmailCanvas.js';
import { DashedButton, PanelLabel } from './parts.js';

export interface SectionsTabProps {
  blocks: readonly EmailBlockRecord[];
  selection: CanvasSelection;
  attachmentCount: number;
  savedBlocks: readonly EmailSavedBlock[];
  onSelect: (selection: CanvasSelection) => void;
  onDuplicateBlock: (id: string) => void;
  onRemoveBlock: (id: string) => void;
  onMoveBlock: (from: number, to: number) => void;
  onAddSection: () => void;
  onInsertSaved: (saved: EmailSavedBlock) => void;
}

const PINNED = [
  { kind: 'branding', Icon: PencilRuler },
  { kind: 'subject', Icon: Type },
  { kind: 'attach', Icon: Paperclip },
  { kind: 'footer', Icon: PanelBottom },
] as const;

function pinnedLabel(kind: (typeof PINNED)[number]['kind'], attachmentCount: number): string {
  switch (kind) {
    case 'branding':
      return t('email:canvas.sections.branding', 'Brand & sender');
    case 'subject':
      return t('email:canvas.sections.subject', 'Subject & preheader');
    case 'attach':
      return attachmentCount === 0
        ? t('email:canvas.sections.attachments', 'Attachments')
        : `${t('email:canvas.sections.attachments', 'Attachments')} · ${String(attachmentCount)}`;
    case 'footer':
      return t('email:canvas.sections.footer', 'Footer');
  }
}

export function SectionsTab({ blocks, selection, attachmentCount, savedBlocks, onSelect, onDuplicateBlock, onRemoveBlock, onMoveBlock, onAddSection, onInsertSaved }: SectionsTabProps) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const onDragStart = (index: number) => (event: DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = 'move';
    try {
      event.dataTransfer.setData('text/plain', String(index));
    } catch {
      // The state carries the index.
    }
    setDragging(index);
  };
  const onDrop = (index: number) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (dragging !== null && dragging !== index) onMoveBlock(dragging, index);
    setDragging(null);
    setOver(null);
  };

  return (
    <div data-testid="email-sections-tab" className="flex flex-col gap-[7px]">
      <PanelLabel className="mb-0">{t('email:inspector.fixed', 'Fixed')}</PanelLabel>
      {PINNED.map(({ kind, Icon }) => {
        const on = selection.kind === kind;
        return (
          <button
            key={kind}
            type="button"
            data-testid="email-pinned-row"
            data-section={kind}
            aria-pressed={on}
            onClick={() => onSelect({ kind })}
            className={cn(
              'flex w-full items-center gap-[9px] rounded-[9px] border px-2.5 py-[9px] text-[12px] font-bold transition-colors',
              on ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface-2 text-fg hover:border-border-strong',
            )}
          >
            <Icon className="size-[15px] shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-start">{pinnedLabel(kind, attachmentCount)}</span>
            <Lock className="size-3 shrink-0 opacity-45" aria-hidden="true" />
          </button>
        );
      })}

      <PanelLabel className="mb-0 mt-2.5">{t('email:inspector.bodySections', 'Body sections · drag to reorder')}</PanelLabel>
      <ul className="m-0 flex list-none flex-col gap-[3px] p-0" data-testid="email-outline">
        {blocks.map((block, index) => {
          const def = blockDef(block.block);
          const Icon = emailIcon(def.icon);
          const label = blockLabel(block.block);
          const on = selection.kind === 'block' && selection.id === block.id;
          return (
            <li
              key={block.id}
              data-testid="email-outline-row"
              data-block-id={block.id}
              onDragOver={(event) => {
                event.preventDefault();
                if (over !== index) setOver(index);
              }}
              onDrop={onDrop(index)}
              className={cn(
                'group/outline flex items-center gap-0.5 rounded-[9px] px-[3px] py-px transition-colors',
                on && 'bg-accent-soft',
                dragging === index && 'opacity-40',
                over === index && dragging !== null && dragging !== index && 'shadow-[inset_0_2px_0_0_var(--accent)]',
              )}
            >
              <span
                draggable
                onDragStart={onDragStart(index)}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
                title={t('email:inspector.dragToReorder', 'Drag to reorder')}
                className="flex w-4 shrink-0 cursor-grab items-center justify-center text-fg-subtle"
                aria-hidden="true"
              >
                <GripVertical className="size-3.5" />
              </span>
              <button
                type="button"
                data-testid="email-outline-select"
                aria-pressed={on}
                onClick={() => onSelect({ kind: 'block', id: block.id })}
                className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-2 text-[12px] font-bold', on ? 'text-accent' : 'text-fg')}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-start">{label}</span>
              </button>
              <span className="flex shrink-0 gap-[3px] opacity-0 transition-opacity focus-within:opacity-100 group-hover/outline:opacity-100">
                <IconButton variant="ghost" size="sm" label={t('email:inspector.moveUp', 'Move up')} disabled={index === 0} onClick={() => onMoveBlock(index, index - 1)}>
                  <ChevronUp className="size-3" />
                </IconButton>
                <IconButton variant="ghost" size="sm" label={t('email:inspector.moveDown', 'Move down')} disabled={index === blocks.length - 1} onClick={() => onMoveBlock(index, index + 1)}>
                  <ChevronDown className="size-3" />
                </IconButton>
                <IconButton variant="ghost" size="sm" label={t('email:inspector.duplicateSection', 'Duplicate {label}', { label })} onClick={() => onDuplicateBlock(block.id)}>
                  <Copy className="size-3" />
                </IconButton>
                <IconButton variant="ghost" size="sm" label={t('email:inspector.removeSection', 'Remove {label}', { label })} onClick={() => onRemoveBlock(block.id)}>
                  <Trash2 className="size-3" />
                </IconButton>
              </span>
            </li>
          );
        })}
      </ul>
      <DashedButton onClick={onAddSection} testId="email-sections-add">
        <Plus className="size-3.5" aria-hidden="true" />
        {t('email:canvas.addSection', 'Add section')}
      </DashedButton>

      <PanelLabel className="mb-0 mt-3">{t('email:inspector.savedBlocks', 'Saved blocks')}</PanelLabel>
      {savedBlocks.length === 0 ? (
        <span className="text-[10.5px] leading-[1.5] text-fg-subtle">
          {t('email:inspector.savedBlocksHint', 'Save any section from the Design tab to reuse it in other templates.')}
        </span>
      ) : (
        savedBlocks.map((saved) => (
          <button
            key={saved.id}
            type="button"
            data-testid="email-saved-block"
            onClick={() => onInsertSaved(saved)}
            className="flex items-center gap-[9px] rounded-[9px] border border-border bg-surface-2 px-2.5 py-2 text-start text-[12px] font-bold text-fg transition-colors hover:border-border-strong"
          >
            <Bookmark className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{saved.name}</span>
            <Plus className="size-[13px] shrink-0 text-fg-subtle" aria-hidden="true" />
          </button>
        ))
      )}
    </div>
  );
}
