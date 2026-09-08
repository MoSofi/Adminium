// SPDX-License-Identifier: AGPL-3.0-only
/** The Refund policy panel (comp 998-1003): the seven-row textarea, *Remove section* (`refShow`). */
import { t } from '../../../../i18n/t.js';
import { RemoveSectionButton, TextAreaField } from '../parts.js';
import type { PanelProps } from '../panelProps.js';

export function RefundPanel({ draft, edits, onSelect }: PanelProps) {
  return (
    <div className="flex flex-col gap-[9px]">
      <TextAreaField label={t('invoices:inspector.refund.policy', 'Refund policy')} labelClassName="mb-[9px]" rows={7} value={draft.body.refText} onFocus={edits.beginEdit} onChange={(value) => edits.set('refText', value)} testId="invoices-refund" />
      <RemoveSectionButton flag="refShow" edits={edits} onSelect={onSelect} className="mt-[2px]" />
    </div>
  );
}
