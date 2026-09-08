// SPDX-License-Identifier: AGPL-3.0-only
/** The Signature panel (comp 883-889): signatory name, title, the pen-line hint, *Remove section* (`sigShow`). */
import { PenLine } from 'lucide-react';

import { t } from '../../../../i18n/t.js';
import { Hint, RemoveSectionButton, TextField } from '../parts.js';
import type { PanelProps } from '../panelProps.js';

export function SignaturePanel({ draft, edits, onSelect }: PanelProps) {
  const body = draft.body;
  return (
    <div className="flex flex-col gap-[14px]">
      <TextField label={t('invoices:inspector.signature.name', 'Signatory name')} value={body.sigName} onFocus={edits.beginEdit} onChange={(value) => edits.set('sigName', value)} className="font-bold" testId="invoices-sig-name" />
      <TextField label={t('invoices:inspector.signature.title', 'Title / role')} value={body.sigTitle} onFocus={edits.beginEdit} onChange={(value) => edits.set('sigTitle', value)} className="text-[12.5px]" testId="invoices-sig-title" />
      <Hint icon={PenLine}>{t('invoices:inspector.signature.hint', 'A signature line and date field appear on the invoice for hand-signing.')}</Hint>
      <RemoveSectionButton flag="sigShow" edits={edits} onSelect={onSelect} />
    </div>
  );
}
