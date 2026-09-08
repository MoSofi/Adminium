// SPDX-License-Identifier: AGPL-3.0-only
/** The Payment panel (comp 856-861): *Payment instructions* over the `payment` line editor. */
import { t } from '../../../../i18n/t.js';
import { LineListEditor } from '../LineListEditor.js';
import { PanelLabel } from '../parts.js';
import type { PanelProps } from '../panelProps.js';

export function PaymentPanel({ draft, edits }: PanelProps) {
  const label = t('invoices:inspector.payment.instructions', 'Payment instructions');
  return (
    <div className="flex flex-col gap-[9px]">
      <PanelLabel className="mb-0">{label}</PanelLabel>
      <LineListEditor field="payment" lines={draft.body.payment} label={label} edits={edits} />
    </div>
  );
}
