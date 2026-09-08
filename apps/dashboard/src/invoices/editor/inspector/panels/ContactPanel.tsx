// SPDX-License-Identifier: AGPL-3.0-only
/** The Contact panel (comp 1006-1012): name (bold), email and phone (mono), *Remove section* (`conShow`). */
import { t } from '../../../../i18n/t.js';
import { RemoveSectionButton, TextField } from '../parts.js';
import type { PanelProps } from '../panelProps.js';

export function ContactPanel({ draft, edits, onSelect }: PanelProps) {
  const body = draft.body;
  return (
    <div className="flex flex-col gap-[14px]">
      <TextField label={t('invoices:inspector.contact.name', 'Contact name')} value={body.conName} onFocus={edits.beginEdit} onChange={(value) => edits.set('conName', value)} className="text-[12.5px] font-bold" testId="invoices-con-name" />
      <TextField label={t('invoices:inspector.contact.email', 'Email')} value={body.conEmail} onFocus={edits.beginEdit} onChange={(value) => edits.set('conEmail', value)} className="font-mono text-[12.5px]" testId="invoices-con-email" />
      <TextField label={t('invoices:inspector.contact.phone', 'Phone')} value={body.conPhone} onFocus={edits.beginEdit} onChange={(value) => edits.set('conPhone', value)} className="font-mono text-[12.5px]" testId="invoices-con-phone" />
      <RemoveSectionButton flag="conShow" edits={edits} onSelect={onSelect} />
    </div>
  );
}
