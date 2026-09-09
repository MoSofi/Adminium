// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The six text-shaped blocks (comp 315, 316, 322, 329, 335, 336): heading,
 * paragraph, divider, PO terms, legal footer and refund policy. Five are one
 * borderless textarea in the comp's own type scale; the divider is a hairline.
 */
import { cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import { InlineTextarea, SHEET_MUTED, SHEET_SUBTLE } from '../inline.js';
import type { BlockBodyProps } from './types.js';

/** 315: a one-row textarea at 18 px / 800, `resize: none`. */
export function HeadingBlock({ block, edits }: BlockBodyProps<'heading'>) {
  return (
    <InlineTextarea
      label={t('reportBuilder:inspector.text', 'Text')}
      data-testid="report-block-text"
      rows={1}
      fixed
      value={block.text}
      onFocus={edits.beginEdit}
      onChange={(value) => edits.patchBlock(block.id, { text: value })}
      className="text-[18px] font-extrabold tracking-[-.01em]"
    />
  );
}

/** 316: three rows at 13 px muted, 1.6 line-height, vertical resize. */
export function TextBlock({ block, edits }: BlockBodyProps<'text'>) {
  return (
    <InlineTextarea
      label={t('reportBuilder:inspector.text', 'Text')}
      data-testid="report-block-text"
      rows={3}
      value={block.text}
      onFocus={edits.beginEdit}
      onChange={(value) => edits.patchBlock(block.id, { text: value })}
      className={cn('text-[13px] leading-[1.6]', SHEET_MUTED)}
    />
  );
}

/** 322: a 1 px hairline with 4 px margins. */
export function DividerBlock() {
  return <div data-testid="report-block-divider" className="my-1 h-px bg-[#ececef]" />;
}

/** 329: three rows at 13 px muted. */
export function PoTermsBlock({ block, edits }: BlockBodyProps<'poterms'>) {
  return (
    <InlineTextarea
      label={t('reportBuilder:inspector.poTerms', 'Purchase order terms')}
      data-testid="report-block-text"
      rows={3}
      value={block.poTerms}
      onFocus={edits.beginEdit}
      onChange={(value) => edits.patchBlock(block.id, { poTerms: value })}
      className={cn('text-[13px] leading-[1.6]', SHEET_MUTED)}
    />
  );
}

/** 335: three rows at 10.5 px subtle, 1.65 line-height. */
export function LegalBlock({ block, edits }: BlockBodyProps<'legal'>) {
  return (
    <InlineTextarea
      label={t('reportBuilder:inspector.legalFooter', 'Legal footer')}
      data-testid="report-block-text"
      rows={3}
      value={block.legalText}
      onFocus={edits.beginEdit}
      onChange={(value) => edits.patchBlock(block.id, { legalText: value })}
      className={cn('text-[10.5px] leading-[1.65]', SHEET_SUBTLE)}
    />
  );
}

/** 336: three rows at 13 px muted. */
export function RefundBlock({ block, edits }: BlockBodyProps<'refund'>) {
  return (
    <InlineTextarea
      label={t('reportBuilder:inspector.refundPolicy', 'Refund policy')}
      data-testid="report-block-text"
      rows={3}
      value={block.refText}
      onFocus={edits.beginEdit}
      onChange={(value) => edits.patchBlock(block.id, { refText: value })}
      className={cn('text-[13px] leading-[1.6]', SHEET_MUTED)}
    />
  );
}
