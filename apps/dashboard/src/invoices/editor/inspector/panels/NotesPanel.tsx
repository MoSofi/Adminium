// SPDX-License-Identifier: AGPL-3.0-only
/** The Notes panel (comp 864-869): the footer-notes textarea and its hint. */
import { t } from '../../../../i18n/t.js';
import { Note, TextAreaField } from '../parts.js';
import type { PanelProps } from '../panelProps.js';

export function NotesPanel({ draft, edits }: PanelProps) {
  return (
    <div className="flex flex-col gap-[9px]">
      <TextAreaField label={t('invoices:inspector.notes.footerNotes', 'Footer notes')} labelClassName="mb-[9px]" rows={6} value={draft.body.notes} onFocus={edits.beginEdit} onChange={(value) => edits.set('notes', value)} testId="invoices-notes" />
      <Note>{t('invoices:inspector.notes.hint', 'Shown at the bottom of the invoice — terms, thank-you note, or legal text.')}</Note>
    </div>
  );
}
