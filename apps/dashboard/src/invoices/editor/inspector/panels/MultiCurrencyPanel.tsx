// SPDX-License-Identifier: AGPL-3.0-only
/** The Multi-currency panel (comp 943-950; `mcEdit` 1700, `addFx` 1701): code · symbol · rate per row, *Add currency*, the note, *Remove section* (`mcShow`). */
import { cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import { FIELD, Note, PanelLabel, RemoveSectionButton } from '../parts.js';
import type { PanelProps } from '../panelProps.js';
import { RowsEditor } from '../RowsEditor.js';

const CELL = cn(FIELD, 'rounded-lg px-2 py-[7px] text-[12px]');

export function MultiCurrencyPanel({ draft, edits, onSelect }: PanelProps) {
  return (
    <div className="flex flex-col gap-[9px]">
      <PanelLabel className="mb-0">{t('invoices:inspector.multicurrency.rates', 'Currencies & rates')}</PanelLabel>
      <RowsEditor
        rows={draft.body.fx}
        addLabel={t('invoices:inspector.multicurrency.add', 'Add currency')}
        removeLabel={(index) => t('invoices:inspector.multicurrency.removeRow', 'Remove currency {n}', { n: index + 1 })}
        removeClassName="h-8"
        onAdd={() => edits.addRow('fx', { code: 'USD', sym: '$', rate: '1' })}
        onRemove={(index) => edits.removeRow('fx', index)}
        renderRow={(row, index, remove) => (
          <div key={index} data-testid="invoices-row" className="flex gap-[6px]">
            <input
              type="text"
              aria-label={t('invoices:inspector.multicurrency.code', 'Currency {n} code', { n: index + 1 })}
              value={row.code}
              onFocus={edits.beginEdit}
              onChange={(event) => edits.updateRow('fx', index, { code: event.target.value })}
              className={cn(CELL, 'w-[54px] shrink-0 font-bold')}
            />
            <input
              type="text"
              aria-label={t('invoices:inspector.multicurrency.symbol', 'Currency {n} symbol', { n: index + 1 })}
              value={row.sym}
              onFocus={edits.beginEdit}
              onChange={(event) => edits.updateRow('fx', index, { sym: event.target.value })}
              className={cn(CELL, 'w-[38px] shrink-0 text-center')}
            />
            <input
              type="text"
              inputMode="decimal"
              aria-label={t('invoices:inspector.multicurrency.rate', 'Currency {n} rate', { n: index + 1 })}
              value={row.rate}
              onFocus={edits.beginEdit}
              onChange={(event) => edits.updateRow('fx', index, { rate: event.target.value })}
              className={cn(CELL, 'min-w-0 flex-1 px-[9px] font-mono')}
            />
            {remove}
          </div>
        )}
      />
      <Note>{t('invoices:inspector.multicurrency.note', 'Rate is multiplied by the invoice total. Code, symbol, then rate.')}</Note>
      <RemoveSectionButton flag="mcShow" edits={edits} onSelect={onSelect} className="mt-[2px]" />
    </div>
  );
}
