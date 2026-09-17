// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The palette (comp 273-284; P1–P2): a 216 px left column with an *ADD BLOCK*
 * eyebrow and the 25 kinds in `palDefs` order (608), each an accent-soft 30
 * px icon tile, a label and a trailing `plus`. A click appends the block and
 * selects it (535).
 *
 * BELOW `lg` (D18) the column is not drawn: the editor shows an *Add block*
 * button that opens {@link PaletteSheet} — the same 25 rows in a modal — so
 * a 390 px viewport can still add a block. The comp has no responsive rule at
 * all (E11); this is the fill.
 *
 * Every label and glyph comes from `blockText`/`BLOCK_KIND_META`, never from
 * an `icon:` literal: `gen-icon-core.mjs` sweeps those into the ENTRY chunk's
 * core set and this surface is lazy (trap 4).
 */
import { Modal, ModalBody, ModalHeader } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { BLOCK_KIND_META, REPORT_BLOCK_KINDS } from '../model/blocks.js';
import type { ReportBlockKind } from '../model/envelope.js';
import { reportIcon } from '../icons.js';
import { blockLabel } from './blockText.js';

export interface PaletteProps {
  onAdd: (kind: ReportBlockKind) => void;
}

function PaletteRow({ kind, onAdd }: { kind: ReportBlockKind; onAdd: (kind: ReportBlockKind) => void }) {
  const Glyph = reportIcon(BLOCK_KIND_META[kind].icon);
  const PlusGlyph = reportIcon('plus');
  const label = blockLabel(kind);
  return (
    <button
      type="button"
      data-testid="report-palette-item"
      data-kind={kind}
      title={t('reportBuilder:palette.add', 'Add {label}', { label })}
      onClick={() => onAdd(kind)}
      className="flex w-full items-center gap-[11px] rounded-[11px] border border-border bg-surface-2 px-[11px] py-[9px] text-start transition-[border-color,background-color,transform] duration-150 hover:border-accent hover:bg-accent-soft active:scale-[.97]"
    >
      <span className="flex size-[30px] shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
        <Glyph className="size-[15px]" aria-hidden="true" />
      </span>
      <span className="flex-1 text-[12.5px] font-bold text-fg">{label}</span>
      <PlusGlyph className="size-3.5 text-fg-subtle" aria-hidden="true" />
    </button>
  );
}

export function Palette({ onAdd }: PaletteProps) {
  return (
    <div
      data-testid="report-palette"
      // The COLUMN paints the comp's full-height surface and border-right
      // (277); the list inside it is what sticks and scrolls.
      className="hidden w-[216px] shrink-0 self-stretch border-e border-border bg-surface lg:block"
    >
      <div className="sticky top-[calc(var(--adm-topbar-h,0px)+var(--adm-editor-header-h,0px))] flex max-h-[calc(100vh-var(--adm-topbar-h,0px)-var(--adm-editor-header-h,0px))] flex-col overflow-y-auto overflow-x-hidden px-3.5 py-4">
        <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[.05em] text-fg-subtle">{t('reportBuilder:palette.title', 'Add block')}</div>
        <div className="flex flex-col gap-[7px]">
          {REPORT_BLOCK_KINDS.map((kind) => (
            <PaletteRow key={kind} kind={kind} onAdd={onAdd} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** The same 25 rows in a sheet, for the viewports the 216 px column cannot have (D18). */
export function PaletteSheet({ onAdd, onClose }: { onAdd: (kind: ReportBlockKind) => void; onClose: () => void }) {
  const PlusGlyph = reportIcon('plus');
  return (
    <Modal open size="md" onOpenChange={(open) => !open && onClose()}>
      <ModalHeader icon={<PlusGlyph />} title={t('reportBuilder:palette.title', 'Add block')} closeLabel={t('common.close', 'Close')} />
      <ModalBody>
        <div data-testid="report-palette-sheet" className="flex flex-col gap-[7px]">
          {REPORT_BLOCK_KINDS.map((kind) => (
            <PaletteRow
              key={kind}
              kind={kind}
              onAdd={(picked) => {
                onAdd(picked);
                onClose();
              }}
            />
          ))}
        </div>
      </ModalBody>
    </Modal>
  );
}
