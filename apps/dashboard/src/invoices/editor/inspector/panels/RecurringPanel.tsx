// SPDX-License-Identifier: AGPL-3.0-only
/** The Recurring panel (comp 953-959; `recurOptions` 1726): the four frequencies, the next issue date, the schedule note, *Remove section* (`recurShow`). */
import { t } from '../../../../i18n/t.js';
import { RECURRING_FREQUENCIES } from '../../../model/envelope.js';
import { OptionButton, PanelLabel, RemoveSectionButton, TextField } from '../parts.js';
import type { PanelProps } from '../panelProps.js';

/** The comp's frequency words (1726) are the stored values; the labels are the viewer's. */
export function frequencyLabel(frequency: string): string {
  switch (frequency) {
    case 'Weekly':
      return t('invoices:inspector.recurring.weekly', 'Weekly');
    case 'Monthly':
      return t('invoices:inspector.recurring.monthly', 'Monthly');
    case 'Quarterly':
      return t('invoices:inspector.recurring.quarterly', 'Quarterly');
    case 'Annually':
      return t('invoices:inspector.recurring.annually', 'Annually');
    default:
      return frequency;
  }
}

export function RecurringPanel({ draft, edits, onSelect }: PanelProps) {
  const body = draft.body;
  return (
    <div className="flex flex-col gap-[14px]">
      <div>
        <PanelLabel id="invoices-frequency-label" className="mb-2">
          {t('invoices:inspector.recurring.frequency', 'Frequency')}
        </PanelLabel>
        <div className="flex flex-wrap gap-[6px]" role="group" aria-labelledby="invoices-frequency-label">
          {RECURRING_FREQUENCIES.map((frequency) => (
            <OptionButton key={frequency} on={body.recurFreq === frequency} label={frequencyLabel(frequency)} value={frequency} onClick={() => edits.histSet('recurFreq', frequency)} className="px-[10px]" />
          ))}
        </div>
      </div>
      <TextField label={t('invoices:inspector.recurring.next', 'Next issue date')} value={body.recurNext} onFocus={edits.beginEdit} onChange={(value) => edits.set('recurNext', value)} className="text-[12.5px]" testId="invoices-recur-next" />
      <TextField label={t('invoices:inspector.recurring.note', 'Schedule note')} value={body.recurCount} onFocus={edits.beginEdit} onChange={(value) => edits.set('recurCount', value)} className="text-[12.5px]" testId="invoices-recur-count" />
      <RemoveSectionButton flag="recurShow" edits={edits} onSelect={onSelect} />
    </div>
  );
}
