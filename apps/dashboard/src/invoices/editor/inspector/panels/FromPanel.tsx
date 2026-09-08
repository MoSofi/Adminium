// SPDX-License-Identifier: AGPL-3.0-only
/** The From panel (comp 807-812): *Company details* over the `from` line editor. */
import { t } from '../../../../i18n/t.js';
import { LineListEditor } from '../LineListEditor.js';
import { PanelLabel } from '../parts.js';
import type { PanelProps } from '../panelProps.js';

export function FromPanel({ draft, edits }: PanelProps) {
  const label = t('invoices:inspector.from.companyDetails', 'Company details');
  return (
    <div className="flex flex-col gap-[9px]">
      <PanelLabel className="mb-0">{label}</PanelLabel>
      <LineListEditor field="from" lines={draft.body.from} label={label} edits={edits} />
    </div>
  );
}
