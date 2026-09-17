// SPDX-License-Identifier: AGPL-3.0-only
/** The Invoice details panel (comp 825-832): number (mono), the two dates, the
 * terms and the PO number (mono). The number is authored text. */
import { t } from '../../../../i18n/t.js';
import { TextField } from '../parts.js';
import type { PanelProps } from '../panelProps.js';

export function MetaPanel({ draft, edits }: PanelProps) {
  const body = draft.body;
  return (
    <div className="flex flex-col gap-[14px]">
      <TextField label={t('invoices:inspector.meta.number', 'Invoice number')} value={body.number} onFocus={edits.beginEdit} onChange={(value) => edits.set('number', value)} className="font-mono text-[12.5px] font-bold" testId="invoices-meta-number" />
      <TextField label={t('invoices:inspector.meta.issued', 'Issue date')} value={body.issued} onFocus={edits.beginEdit} onChange={(value) => edits.set('issued', value)} className="text-[12.5px]" testId="invoices-meta-issued" />
      <TextField label={t('invoices:inspector.meta.due', 'Due date')} value={body.due} onFocus={edits.beginEdit} onChange={(value) => edits.set('due', value)} className="text-[12.5px]" testId="invoices-meta-due" />
      <TextField label={t('invoices:inspector.meta.terms', 'Payment terms')} value={body.terms} onFocus={edits.beginEdit} onChange={(value) => edits.set('terms', value)} className="text-[12.5px] font-semibold" testId="invoices-meta-terms" />
      <TextField label={t('invoices:inspector.meta.poNumber', 'PO number')} value={body.poNumber} onFocus={edits.beginEdit} onChange={(value) => edits.set('poNumber', value)} className="font-mono text-[12.5px] font-bold" testId="invoices-meta-po" />
    </div>
  );
}
