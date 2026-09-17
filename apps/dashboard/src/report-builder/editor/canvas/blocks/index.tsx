// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The block registry: kind → body (the comp's twenty-five `sc-if`
 * branches, 315-339).
 *
 * The switch narrows on the union's discriminant, so a kind added to
 * `ReportBlockKind` without a body here is a TYPE error, not a blank card.
 */
import type { DocumentEdits } from '../../../model/edits.js';
import type { ReportBlock } from '../../../model/envelope.js';
import { BarBlock, KpiBlock, LineBlock, TableBlock } from './charts.js';
import { DeliveryBlock } from './delivery.js';
import { DiscountBlock, LateFeesBlock, LoyaltyBlock, MultiCurrencyBlock, PayHistoryBlock, RecurringBlock, TaxBreakBlock } from './finance.js';
import { ImageBlock, QrBlock } from './media.js';
import { ApprovalBlock, AttachmentsBlock, ContactBlock, SignatureBlock, TermsBlock } from './people.js';
import { DividerBlock, HeadingBlock, LegalBlock, PoTermsBlock, RefundBlock, TextBlock } from './text.js';

export interface BlockBodyRenderProps {
  block: ReportBlock;
  edits: DocumentEdits;
  locale: string;
}

export function BlockBody({ block, edits, locale }: BlockBodyRenderProps) {
  switch (block.kind) {
    case 'heading':
      return <HeadingBlock block={block} edits={edits} locale={locale} />;
    case 'text':
      return <TextBlock block={block} edits={edits} locale={locale} />;
    case 'kpi':
      return <KpiBlock block={block} edits={edits} locale={locale} />;
    case 'bar':
      return <BarBlock block={block} edits={edits} locale={locale} />;
    case 'line':
      return <LineBlock block={block} edits={edits} locale={locale} />;
    case 'table':
      return <TableBlock block={block} edits={edits} locale={locale} />;
    case 'signature':
      return <SignatureBlock block={block} edits={edits} locale={locale} />;
    case 'terms':
      return <TermsBlock block={block} edits={edits} locale={locale} />;
    case 'attachments':
      return <AttachmentsBlock block={block} edits={edits} locale={locale} />;
    case 'approval':
      return <ApprovalBlock block={block} edits={edits} locale={locale} />;
    case 'qr':
      return <QrBlock block={block} edits={edits} locale={locale} />;
    case 'latefees':
      return <LateFeesBlock block={block} edits={edits} locale={locale} />;
    case 'poterms':
      return <PoTermsBlock block={block} edits={edits} locale={locale} />;
    case 'multicurrency':
      return <MultiCurrencyBlock block={block} edits={edits} locale={locale} />;
    case 'recurring':
      return <RecurringBlock block={block} edits={edits} locale={locale} />;
    case 'discount':
      return <DiscountBlock block={block} edits={edits} locale={locale} />;
    case 'taxbreak':
      return <TaxBreakBlock block={block} edits={edits} locale={locale} />;
    case 'payhistory':
      return <PayHistoryBlock block={block} edits={edits} locale={locale} />;
    case 'legal':
      return <LegalBlock block={block} edits={edits} locale={locale} />;
    case 'refund':
      return <RefundBlock block={block} edits={edits} locale={locale} />;
    case 'contact':
      return <ContactBlock block={block} edits={edits} locale={locale} />;
    case 'loyalty':
      return <LoyaltyBlock block={block} edits={edits} locale={locale} />;
    case 'delivery':
      return <DeliveryBlock block={block} edits={edits} locale={locale} />;
    case 'image':
      return <ImageBlock block={block} edits={edits} locale={locale} />;
    case 'divider':
      return <DividerBlock />;
  }
}
