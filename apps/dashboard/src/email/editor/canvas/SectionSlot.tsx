// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One block's slot on the canvas (comp 528-558, Appendix A §E2): the hover
 * *Add* pill above it (an insert at this index), the selectable section with
 * its 5 px accent ring, and the style wrapper around the family preview.
 *
 * D17: the section is an inert wrapper with ONE real button — visually
 * hidden until focused — so a keyboard selects a block the way a click does;
 * the *Add* pill is a real button that reveals on hover and on focus.
 */
import { Plus } from 'lucide-react';

import { t } from '../../../i18n/t.js';
import type { EmailBlockRecord } from '../../api.js';
import type { EmailBlockDef } from '../../model/blocks.js';
import { BlockPreview } from './blocks/index.js';
import type { FileDto } from '../../../files/api.js';
import { blockWrapperClasses } from './styles.js';

export interface SectionSlotProps {
  block: EmailBlockRecord;
  def: EmailBlockDef;
  label: string;
  index: number;
  selected: boolean;
  files: ReadonlyMap<string, FileDto | null>;
  onSelect: () => void;
  onInsertAbove: () => void;
  onHeadingChange: (text: string) => void;
  onHeadingFocus: () => void;
}

/** The comp's `.nb-sec` ring: faint on hover, the 13 % ring when selected. */
export const SECTION_RING =
  'relative cursor-pointer rounded-[5px] transition-shadow duration-150 hover:shadow-[0_0_0_5px_color-mix(in_srgb,var(--adm-email-accent)_8%,transparent)] data-[selected]:shadow-[0_0_0_5px_color-mix(in_srgb,var(--adm-email-accent)_13%,transparent)]';

/** The hidden-until-focused selector every section carries (D17). */
export function SelectButton({ label, onSelect }: { label: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      className="sr-only start-0 top-0 z-[2] focus:not-sr-only focus:absolute focus:rounded-md focus:bg-white focus:px-2 focus:py-0.5 focus:text-[10.5px] focus:font-bold focus:text-[var(--adm-email-accent)] focus:shadow-[0_0_0_2px_var(--adm-email-accent)] focus:outline-none"
    >
      {t('email:canvas.select', 'Edit {label}', { label })}
    </button>
  );
}

export function SectionSlot({ block, def, label, index, selected, files, onSelect, onInsertAbove, onHeadingChange, onHeadingFocus }: SectionSlotProps) {
  return (
    <div className="group/slot relative">
      <button
        type="button"
        data-testid="email-insert-above"
        aria-label={t('email:canvas.insertAbove', 'Insert a section above {label}', { label })}
        onClick={(event) => {
          event.stopPropagation();
          onInsertAbove();
        }}
        className="absolute inset-x-0 bottom-[calc(100%+4px)] z-[3] flex h-[22px] items-center justify-center opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-hover/slot:opacity-100"
      >
        <span className="absolute inset-x-1.5 top-1/2 h-px bg-[color-mix(in_srgb,var(--adm-email-accent)_20%,transparent)]" aria-hidden="true" />
        <span className="relative inline-flex items-center gap-1 rounded-[20px] border border-[color-mix(in_srgb,var(--adm-email-accent)_28%,transparent)] bg-white py-[3px] pe-2.5 ps-2 text-[10.5px] font-extrabold tracking-[.01em] text-[var(--adm-email-accent)] shadow-[0_2px_8px_rgba(20,20,35,.1)]">
          <Plus className="size-3" aria-hidden="true" />
          {t('email:canvas.add', 'Add')}
        </span>
      </button>
      <div
        role="group"
        aria-label={label}
        data-testid="email-block"
        data-block-id={block.id}
        data-kind={block.block}
        data-selected={selected ? '' : undefined}
        onClick={onSelect}
        className={SECTION_RING}
      >
        <SelectButton label={label} onSelect={onSelect} />
        <div className={blockWrapperClasses(block.style, index === 0)}>
          <BlockPreview block={block} def={def} label={label} files={files} onHeadingChange={onHeadingChange} onHeadingFocus={onHeadingFocus} />
        </div>
      </div>
    </div>
  );
}
