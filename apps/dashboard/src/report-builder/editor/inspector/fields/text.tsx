// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The six text field groups (comp 381, 401, 413, 415): one textarea each for
 * the heading, the paragraph, the image caption, the PO terms, the legal
 * footer and the refund policy. The divider block has no group at all —
 * title, width, show and delete are its whole panel (B25).
 */
import { t } from '../../../../i18n/t.js';
import { TextAreaField } from '../parts.js';
import type { FieldsProps } from './types.js';

/** 381: five rows, labelled *Text* (or *Placeholder caption* for the image block, 645). */
export function TextFields({ block, edits }: FieldsProps<'heading' | 'text'>) {
  return (
    <TextAreaField
      label={t('reportBuilder:inspector.text', 'Text')}
      testId="report-field-text"
      rows={5}
      value={block.text}
      onFocus={edits.beginEdit}
      onChange={(value) => edits.patchBlock(block.id, { text: value })}
    />
  );
}

/** 401: six rows. */
export function PoTermsFields({ block, edits }: FieldsProps<'poterms'>) {
  return (
    <TextAreaField
      label={t('reportBuilder:inspector.poTerms', 'Purchase order terms')}
      testId="report-field-text"
      rows={6}
      value={block.poTerms}
      onFocus={edits.beginEdit}
      onChange={(value) => edits.patchBlock(block.id, { poTerms: value })}
    />
  );
}

/** 413: six rows. */
export function LegalFields({ block, edits }: FieldsProps<'legal'>) {
  return (
    <TextAreaField
      label={t('reportBuilder:inspector.legalFooter', 'Legal footer')}
      testId="report-field-text"
      rows={6}
      value={block.legalText}
      onFocus={edits.beginEdit}
      onChange={(value) => edits.patchBlock(block.id, { legalText: value })}
    />
  );
}

/** 415: six rows. */
export function RefundFields({ block, edits }: FieldsProps<'refund'>) {
  return (
    <TextAreaField
      label={t('reportBuilder:inspector.refundPolicy', 'Refund policy')}
      testId="report-field-text"
      rows={6}
      value={block.refText}
      onFocus={edits.beginEdit}
      onChange={(value) => edits.patchBlock(block.id, { refText: value })}
    />
  );
}
