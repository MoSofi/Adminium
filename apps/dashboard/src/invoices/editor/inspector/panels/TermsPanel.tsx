// SPDX-License-Identifier: AGPL-3.0-only
/** The Terms panel (comp 892-897): the *Pre-checked* toggle, the checkbox-label textarea, *Remove section* (`termsShow`). */
import { t } from '../../../../i18n/t.js';
import { RemoveSectionButton, TextAreaField, Toggle } from '../parts.js';
import type { PanelProps } from '../panelProps.js';

export function TermsPanel({ draft, edits, onSelect }: PanelProps) {
  const body = draft.body;
  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex items-center gap-[10px]">
        <div className="min-w-0 flex-1">
          <div id="invoices-terms-checked-label" className="text-[12.5px] font-bold text-fg">
            {t('invoices:inspector.terms.preChecked', 'Pre-checked')}
          </div>
          <div className="text-[10.5px] text-fg-subtle">{t('invoices:inspector.terms.preCheckedHint', 'Show the box already ticked')}</div>
        </div>
        <Toggle on={body.termsChecked} labelledBy="invoices-terms-checked-label" onClick={() => edits.histSet('termsChecked', !body.termsChecked)} />
      </div>
      <TextAreaField label={t('invoices:inspector.terms.checkboxLabel', 'Checkbox label')} rows={3} value={body.termsLabel} onFocus={edits.beginEdit} onChange={(value) => edits.set('termsLabel', value)} testId="invoices-terms-label" />
      <RemoveSectionButton flag="termsShow" edits={edits} onSelect={onSelect} />
    </div>
  );
}
