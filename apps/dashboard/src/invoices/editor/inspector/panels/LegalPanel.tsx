// SPDX-License-Identifier: AGPL-3.0-only
/** The Legal footer panel (comp 990-995): the seven-row textarea, *Remove section* (`legalShow`). */
import { t } from '../../../../i18n/t.js';
import { RemoveSectionButton, TextAreaField } from '../parts.js';
import type { PanelProps } from '../panelProps.js';

export function LegalPanel({ draft, edits, onSelect }: PanelProps) {
  return (
    <div className="flex flex-col gap-[9px]">
      <TextAreaField label={t('invoices:inspector.legal.footer', 'Legal footer')} labelClassName="mb-[9px]" rows={7} value={draft.body.legalText} onFocus={edits.beginEdit} onChange={(value) => edits.set('legalText', value)} testId="invoices-legal" />
      <RemoveSectionButton flag="legalShow" edits={edits} onSelect={onSelect} className="mt-[2px]" />
    </div>
  );
}
