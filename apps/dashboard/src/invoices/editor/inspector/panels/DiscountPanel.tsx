// SPDX-License-Identifier: AGPL-3.0-only
/** The Discount codes panel (comp 962-968; `discEdit` 1706, `addDisc` 1707): a card per code — code · amount · remove, then the label — *Add code*, *Remove section* (`discShow`). */
import { cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import { FIELD, PanelLabel, RemoveSectionButton } from '../parts.js';
import type { PanelProps } from '../panelProps.js';
import { RowsEditor } from '../RowsEditor.js';

const CELL = cn(FIELD, 'rounded-lg bg-surface px-[9px] py-[7px] text-[12px]');

export function DiscountPanel({ draft, edits, onSelect }: PanelProps) {
  return (
    <div className="flex flex-col gap-[9px]">
      <PanelLabel className="mb-0">{t('invoices:inspector.discount.codes', 'Discount codes')}</PanelLabel>
      <RowsEditor
        rows={draft.body.discCodes}
        addLabel={t('invoices:inspector.discount.add', 'Add code')}
        removeLabel={(index) => t('invoices:inspector.discount.removeRow', 'Remove code {n}', { n: index + 1 })}
        removeClassName="h-8"
        onAdd={() => edits.addRow('discCodes', { code: 'NEWCODE', label: t('invoices:inspector.discount.seedLabel', 'New discount'), amount: '0' })}
        onRemove={(index) => edits.removeRow('discCodes', index)}
        renderRow={(row, index, remove) => (
          <div key={index} data-testid="invoices-row" className="flex flex-col gap-[5px] rounded-[10px] border border-border bg-surface-2 p-[9px]">
            <div className="flex gap-[6px]">
              <input
                type="text"
                aria-label={t('invoices:inspector.discount.code', 'Code {n}', { n: index + 1 })}
                placeholder={t('invoices:inspector.discount.codePlaceholder', 'CODE')}
                value={row.code}
                onFocus={edits.beginEdit}
                onChange={(event) => edits.updateRow('discCodes', index, { code: event.target.value })}
                className={cn(CELL, 'min-w-0 flex-1 font-mono font-bold')}
              />
              <input
                type="text"
                inputMode="decimal"
                aria-label={t('invoices:inspector.discount.amount', 'Code {n} amount', { n: index + 1 })}
                placeholder="0"
                value={row.amount}
                onFocus={edits.beginEdit}
                onChange={(event) => edits.updateRow('discCodes', index, { amount: event.target.value })}
                className={cn(CELL, 'w-[66px] shrink-0 font-mono')}
              />
              {remove}
            </div>
            <input
              type="text"
              aria-label={t('invoices:inspector.discount.label', 'Code {n} description', { n: index + 1 })}
              placeholder={t('invoices:inspector.discount.labelPlaceholder', 'Description')}
              value={row.label}
              onFocus={edits.beginEdit}
              onChange={(event) => edits.updateRow('discCodes', index, { label: event.target.value })}
              className={CELL}
            />
          </div>
        )}
      />
      <RemoveSectionButton flag="discShow" edits={edits} onSelect={onSelect} className="mt-[2px]" />
    </div>
  );
}
