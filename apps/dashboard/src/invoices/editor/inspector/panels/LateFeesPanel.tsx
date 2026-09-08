// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Late fees panel (comp 927-932): the rate with its unit and the grace
 * period in days, *Remove section* (`lateShow`). The unit reads "% per
 * month" spelled out — 34 Appendix D.1/D.2's lexicon row for the comp's
 * abbreviated suffix at 929.
 */
import { t } from '../../../../i18n/t.js';
import { RemoveSectionButton, SuffixField } from '../parts.js';
import type { PanelProps } from '../panelProps.js';

export function LateFeesPanel({ draft, edits, onSelect }: PanelProps) {
  const body = draft.body;
  return (
    <div className="flex flex-col gap-[14px]">
      <SuffixField label={t('invoices:inspector.latefees.rate', 'Late fee rate')} suffix={t('invoices:inspector.latefees.rateUnit', '% per month')} value={body.lateRate} onFocus={edits.beginEdit} onChange={(value) => edits.set('lateRate', value)} testId="invoices-late-rate" />
      <SuffixField
        label={t('invoices:inspector.latefees.grace', 'Grace period')}
        suffix={t('invoices:inspector.latefees.graceUnit', 'days')}
        value={String(body.lateDays)}
        onFocus={edits.beginEdit}
        onChange={(value) => edits.set('lateDays', Number.parseInt(value, 10) || 0)}
        testId="invoices-late-days"
      />
      <RemoveSectionButton flag="lateShow" edits={edits} onSelect={onSelect} />
    </div>
  );
}
