// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Invoice-to panel (the comp's `billto`, 815-822; 34 Appendix D.2 retires
 * the word from the key and the header — the body copy was already *Client
 * name* / *Address & contact*): the client name over the `customer` line editor.
 */
import { t } from '../../../../i18n/t.js';
import { LineListEditor } from '../LineListEditor.js';
import { PanelLabel, TextField } from '../parts.js';
import type { PanelProps } from '../panelProps.js';

export function CustomerPanel({ draft, edits }: PanelProps) {
  const lines = t('invoices:inspector.customer.addressContact', 'Address & contact');
  return (
    <div className="flex flex-col gap-[9px]">
      <TextField label={t('invoices:inspector.customer.clientName', 'Client name')} labelClassName="mb-[9px]" value={draft.body.customerName} onFocus={edits.beginEdit} onChange={(value) => edits.set('customerName', value)} className="font-bold" testId="invoices-customer-name" />
      <PanelLabel className="mb-0 mt-[5px]">{lines}</PanelLabel>
      <LineListEditor field="customer" lines={draft.body.customer} label={lines} edits={edits} />
    </div>
  );
}
