// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Tax breakdown panel (comp 971-978; `taxbEdit` 1710, `addTaxb` 1711):
 * label · 76 px rate box · remove per component, *Add tax line*, the note,
 * *Remove section* (`taxbShow`). The note names the discounted subtotal, not
 * the comp's bare "subtotal" (976): every component goes on the
 * ladder's own base, and the copy must say what the arithmetic does.
 */
import { cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import { FIELD, Note, PanelLabel, RemoveSectionButton, SuffixField } from '../parts.js';
import type { PanelProps } from '../panelProps.js';
import { RowsEditor } from '../RowsEditor.js';

export function TaxBreakPanel({ draft, edits, onSelect }: PanelProps) {
  return (
    <div className="flex flex-col gap-[9px]">
      <PanelLabel className="mb-0">{t('invoices:inspector.taxbreak.components', 'Tax components')}</PanelLabel>
      <RowsEditor
        rows={draft.body.taxLines}
        addLabel={t('invoices:inspector.taxbreak.add', 'Add tax line')}
        removeLabel={(index) => t('invoices:inspector.taxbreak.removeRow', 'Remove tax line {n}', { n: index + 1 })}
        onAdd={() => edits.addRow('taxLines', { label: t('invoices:inspector.taxbreak.seedLabel', 'New tax'), rate: '0' })}
        onRemove={(index) => edits.removeRow('taxLines', index)}
        renderRow={(row, index, remove) => (
          <div key={index} data-testid="invoices-row" className="flex gap-[6px]">
            <input
              type="text"
              aria-label={t('invoices:inspector.taxbreak.label', 'Tax line {n} label', { n: index + 1 })}
              value={row.label}
              onFocus={edits.beginEdit}
              onChange={(event) => edits.updateRow('taxLines', index, { label: event.target.value })}
              className={cn(FIELD, 'min-w-0 flex-1 px-[10px] py-2 text-[12.5px]')}
            />
            <SuffixField compact suffix="%" ariaLabel={t('invoices:inspector.taxbreak.rate', 'Tax line {n} rate', { n: index + 1 })} value={row.rate} onFocus={edits.beginEdit} onChange={(rate) => edits.updateRow('taxLines', index, { rate })} />
            {remove}
          </div>
        )}
      />
      <Note>{t('invoices:inspector.taxbreak.note', 'Each rate is applied to the subtotal after any discount.')}</Note>
      <RemoveSectionButton flag="taxbShow" edits={edits} onSelect={onSelect} className="mt-[2px]" />
    </div>
  );
}
