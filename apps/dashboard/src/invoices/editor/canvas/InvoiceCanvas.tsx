// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The canvas (comp 365-724; 34-invoices-add-on.md Appendix E §C1-C11): the
 * paper, the letterhead — the branding region (logo tile or image, the brand
 * name input, *Branding · click to edit*) beside the read-only title / number
 * / status cluster (§0.4.6 item 2: three plain elements, edited from the
 * Theme and Invoice-details panels) — then the reorderable block stack and
 * the trailing dashed *Add section*.
 *
 * THE GATE FILTERS, IT NEVER GHOSTS (O19): `visibleBlocks` drops an off block
 * before render, exactly as the comp's `blocks` does (1491-1493); the comp's
 * eighteen in-canvas "Add <section>" ghosts are unreachable and are not
 * built. Every index that leaves this file — a drop target, an insert chip, a
 * keyboard move — is the PRE-FILTER `blockOrder` position, so a hidden block
 * keeps its place while invisible (Appendix F "Ordering rules").
 *
 * Drag/drop is the comp's HTML5 choreography (1494-1508): the grip starts
 * it, the wrapper marks the target on dragover and reorders on drop. The
 * keyboard path (ArrowUp / ArrowDown on the grip) moves a block past its
 * VISIBLE neighbour — the same landing a drop on that neighbour gives — an
 * a11y addition the comp's mouse-only grip lacks.
 */
import { Plus } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { cn } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import { invoiceIcon } from '../../icons.js';
import { isBuiltinBlockKey, visibleBlocks, type SectionKey } from '../../model/blocks.js';
import type { EditorDraft } from '../../model/doc.js';
import type { DocumentEdits } from '../../model/edits.js';
import type { Totals } from '../../model/money.js';
import { BlockSlot } from './BlockSlot.js';
import { CustomBlock, builtinBlockLabel, renderBuiltinBlock, type BlockProps } from './blocks/index.js';
import { ACCENT_BG, InlineInput, Region, STATUS_TONE, statusText, type ImageRejection } from './inline.js';
import { PaperShell } from './PaperShell.js';

export interface InvoiceCanvasProps {
  draft: EditorDraft;
  totals: Totals;
  edits: DocumentEdits;
  section: SectionKey;
  onSelect: (section: SectionKey) => void;
  /** The between-block chip: the modal opens at this pre-filter index. */
  onInsertAt: (index: number) => void;
  /** The trailing button: the modal opens in append mode. */
  onAppend: () => void;
  onRemoveCustom: (id: string) => void;
  onImageRejected: (result: ImageRejection) => void;
}

interface DragState {
  from: number | null;
  over: number | null;
}

const NO_DRAG: DragState = { from: null, over: null };

export function InvoiceCanvas({ draft, totals, edits, section, onSelect, onInsertAt, onAppend, onRemoveCustom, onImageRejected }: InvoiceCanvasProps) {
  const body = draft.body;
  const [drag, setDrag] = useState<DragState>(NO_DRAG);
  const blocks = visibleBlocks(body);
  const LogoIcon = invoiceIcon(body.logoIcon);

  const onDragStart = (index: number, event: DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = 'move';
    try {
      event.dataTransfer.setData('text/plain', String(index));
    } catch {
      // Some engines refuse setData outside a real drag; the index is in state anyway.
    }
    setDrag({ from: index, over: null });
  };
  const onDragOver = (index: number) => {
    if (drag.over !== index) setDrag((current) => ({ ...current, over: index }));
  };
  const onDrop = (index: number) => {
    if (drag.from !== null && drag.from !== index) edits.reorderBlocks(drag.from, index);
    setDrag(NO_DRAG);
  };
  const onDragEnd = () => setDrag(NO_DRAG);

  /** ArrowUp / ArrowDown: land before the previous visible block, or after the next one. */
  const onMove = (index: number, direction: -1 | 1) => {
    const position = blocks.findIndex((block) => block.index === index);
    if (position === -1) return;
    const neighbour = blocks[position + direction];
    if (neighbour === undefined) return;
    edits.reorderBlocks(index, direction === -1 ? neighbour.index : neighbour.index + 1);
  };

  const blockProps: BlockProps = { body, totals, edits, section, onSelect, onRemoveCustom, onImageRejected };

  return (
    <div data-testid="invoices-canvas">
      <PaperShell body={body}>
        <div className="mb-[30px] flex items-start justify-between gap-5">
          <Region section="branding" selected={section} onSelect={onSelect}>
            <div className="mb-[11px] flex items-center gap-[11px]">
              {body.logoImage === '' ? (
                <div data-testid="invoices-logo-tile" className={cn('flex size-9 shrink-0 items-center justify-center rounded-[10px] text-white', ACCENT_BG)}>
                  <LogoIcon className="size-5" aria-hidden="true" />
                </div>
              ) : (
                <img src={body.logoImage} alt="" data-testid="invoices-logo-image" className="size-9 shrink-0 rounded-[10px] border border-[#ececef] object-cover" />
              )}
              <InlineInput
                label={t('invoices:canvas.brandName', 'Brand name')}
                value={body.logoText}
                onFocus={edits.beginEdit}
                onChange={(value) => edits.set('logoText', value)}
                className="w-auto max-w-[180px] text-[18px] font-extrabold tracking-[-.02em]"
                data-testid="invoices-brand-name"
              />
            </div>
            <div className="text-[11.5px] leading-[1.6] text-[#6b6b76]">{t('invoices:canvas.brandingHint', 'Branding · click to edit')}</div>
          </Region>
          <Region section="theme" selected={section} onSelect={onSelect}>
            <div className="text-end">
              <div data-testid="invoices-title" className="text-[30px] font-extrabold leading-none tracking-[-.03em] text-[#191920]">
                {body.title}
              </div>
              <div data-testid="invoices-number" className="mt-1.5 font-mono text-[12.5px] text-[#6b6b76]">
                {body.number}
              </div>
              <span data-testid="invoices-status" className={cn('mt-[9px] inline-block rounded-[20px] px-2.5 py-[3px] text-[11px] font-bold', STATUS_TONE[draft.status])}>
                {statusText(draft.status)}
              </span>
            </div>
          </Region>
        </div>

        <div className="flex flex-col gap-6">
          {blocks.map((block) => {
            const kind = block.custom === null ? block.key : `custom.${block.custom.type}`;
            const label =
              block.custom !== null
                ? block.custom.title.trim() === ''
                  ? t('invoices:section.custom.title', 'Custom section')
                  : block.custom.title
                : isBuiltinBlockKey(block.key)
                  ? builtinBlockLabel(block.key)
                  : block.key;
            return (
              <BlockSlot
                key={block.key}
                kind={kind}
                index={block.index}
                label={label}
                dragging={drag.from === block.index}
                over={drag.over === block.index && drag.from !== null && drag.from !== block.index}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDrop={onDrop}
                onDragEnd={onDragEnd}
                onInsertAt={onInsertAt}
                onMove={onMove}
              >
                {block.custom !== null ? <CustomBlock {...blockProps} custom={block.custom} /> : isBuiltinBlockKey(block.key) ? renderBuiltinBlock(block.key, blockProps) : null}
              </BlockSlot>
            );
          })}
          <button
            type="button"
            data-testid="invoices-add-section"
            onClick={onAppend}
            className="nb-ib flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-[#e2e2e8] bg-[#fafafa] p-[13px] text-[12.5px] font-bold text-[#6b6b76]"
          >
            <Plus className="size-[15px]" aria-hidden="true" />
            {t('invoices:canvas.addSection', 'Add section')}
          </button>
        </div>
      </PaperShell>
    </div>
  );
}
