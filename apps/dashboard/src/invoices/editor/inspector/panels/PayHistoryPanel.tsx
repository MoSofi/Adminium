// SPDX-License-Identifier: AGPL-3.0-only
/** The Payment history panel (comp 981-987; `payhEdit` 1713, `addPayh` 1714): a card per payment — date · amount · remove, then the method — *Add payment*, *Remove section* (`payhShow`). */
import { cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import { formatMoney } from '../../../model/money.js';
import { FIELD, PanelLabel, RemoveSectionButton } from '../parts.js';
import type { PanelProps } from '../panelProps.js';
import { RowsEditor } from '../RowsEditor.js';

const CELL = cn(FIELD, 'rounded-lg bg-surface px-[9px] py-[7px] text-[12px]');

export function PayHistoryPanel({ draft, edits, onSelect }: PanelProps) {
  const body = draft.body;
  return (
    <div className="flex flex-col gap-[9px]">
      <PanelLabel className="mb-0">{t('invoices:inspector.payhistory.payments', 'Payments')}</PanelLabel>
      <RowsEditor
        rows={body.payHist}
        addLabel={t('invoices:inspector.payhistory.add', 'Add payment')}
        removeLabel={(index) => t('invoices:inspector.payhistory.removeRow', 'Remove payment {n}', { n: index + 1 })}
        removeClassName="h-8"
        onAdd={() => edits.addRow('payHist', { date: '—', method: '—', amount: formatMoney(0, body.currency, body.cents), status: 'paid' })}
        onRemove={(index) => edits.removeRow('payHist', index)}
        renderRow={(row, index, remove) => (
          <div key={index} data-testid="invoices-row" className="flex flex-col gap-[5px] rounded-[10px] border border-border bg-surface-2 p-[9px]">
            <div className="flex gap-[6px]">
              <input
                type="text"
                aria-label={t('invoices:inspector.payhistory.date', 'Payment {n} date', { n: index + 1 })}
                placeholder={t('invoices:inspector.payhistory.datePlaceholder', 'Date')}
                value={row.date}
                onFocus={edits.beginEdit}
                onChange={(event) => edits.updateRow('payHist', index, { date: event.target.value })}
                className={cn(CELL, 'min-w-0 flex-1')}
              />
              <input
                type="text"
                aria-label={t('invoices:inspector.payhistory.amount', 'Payment {n} amount', { n: index + 1 })}
                placeholder={t('invoices:inspector.payhistory.amountPlaceholder', 'Amount')}
                value={row.amount}
                onFocus={edits.beginEdit}
                onChange={(event) => edits.updateRow('payHist', index, { amount: event.target.value })}
                className={cn(CELL, 'w-20 shrink-0 font-mono')}
              />
              {remove}
            </div>
            <input
              type="text"
              aria-label={t('invoices:inspector.payhistory.method', 'Payment {n} method', { n: index + 1 })}
              placeholder={t('invoices:inspector.payhistory.methodPlaceholder', 'Method')}
              value={row.method}
              onFocus={edits.beginEdit}
              onChange={(event) => edits.updateRow('payHist', index, { method: event.target.value })}
              className={CELL}
            />
          </div>
        )}
      />
      <RemoveSectionButton flag="payhShow" edits={edits} onSelect={onSelect} className="mt-[2px]" />
    </div>
  );
}
