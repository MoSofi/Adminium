// SPDX-License-Identifier: AGPL-3.0-only
/** The PO terms panel (comp 935-940): the seven-row textarea, *Remove section* (`poShow`). */
import { t } from '../../../../i18n/t.js';
import { RemoveSectionButton, TextAreaField } from '../parts.js';
import type { PanelProps } from '../panelProps.js';

export function PoTermsPanel({ draft, edits, onSelect }: PanelProps) {
  return (
    <div className="flex flex-col gap-[9px]">
      <TextAreaField label={t('invoices:inspector.poterms.terms', 'Purchase order terms')} labelClassName="mb-[9px]" rows={7} value={draft.body.poTerms} onFocus={edits.beginEdit} onChange={(value) => edits.set('poTerms', value)} testId="invoices-po-terms" />
      <RemoveSectionButton flag="poShow" edits={edits} onSelect={onSelect} className="mt-[5px]" />
    </div>
  );
}
