// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The field-group registry: kind → its inspector fields (43-report-builder.md
 * Appendix A I6, Appendix B's *Inspector* column; the comp's `has…` flags,
 * 643-671).
 *
 * The switch narrows on the union's discriminant, so a kind added to
 * `ReportBlockKind` without a group here is a TYPE error, not an empty panel.
 * `divider` is the one kind with nothing of its own: title, width, show and
 * delete are its whole panel (B25).
 */
import type { DocumentEdits } from '../../../model/edits.js';
import type { ReportBlock } from '../../../model/envelope.js';
import type { ImageRejection } from '../../canvas/inline.js';
import { KpiFields, SeriesFields, TableFields } from './charts.js';
import {
  DeliveryFields,
  DiscountFields,
  LateFeesFields,
  LoyaltyFields,
  MultiCurrencyFields,
  PayHistoryFields,
  RecurringFields,
  TaxBreakFields,
} from './finance.js';
import { ImageFields } from './media.js';
import { ApprovalFields, AttachmentsFields, ContactFields, QrFields, SignatureFields, TermsFields } from './people.js';
import { LegalFields, PoTermsFields, RefundFields, TextFields } from './text.js';

export interface BlockFieldsProps {
  block: ReportBlock;
  edits: DocumentEdits;
  onImageRejected: (result: ImageRejection) => void;
}

export function BlockFields({ block, edits, onImageRejected }: BlockFieldsProps) {
  switch (block.kind) {
    case 'heading':
    case 'text':
      return <TextFields block={block} edits={edits} />;
    case 'kpi':
      return <KpiFields block={block} edits={edits} />;
    case 'bar':
    case 'line':
      return <SeriesFields block={block} edits={edits} />;
    case 'table':
      return <TableFields block={block} edits={edits} />;
    case 'signature':
      return <SignatureFields block={block} edits={edits} />;
    case 'terms':
      return <TermsFields block={block} edits={edits} />;
    case 'attachments':
      return <AttachmentsFields block={block} edits={edits} />;
    case 'approval':
      return <ApprovalFields block={block} edits={edits} />;
    case 'qr':
      return <QrFields block={block} edits={edits} />;
    case 'latefees':
      return <LateFeesFields block={block} edits={edits} />;
    case 'poterms':
      return <PoTermsFields block={block} edits={edits} />;
    case 'multicurrency':
      return <MultiCurrencyFields block={block} edits={edits} />;
    case 'recurring':
      return <RecurringFields block={block} edits={edits} />;
    case 'discount':
      return <DiscountFields block={block} edits={edits} />;
    case 'taxbreak':
      return <TaxBreakFields block={block} edits={edits} />;
    case 'payhistory':
      return <PayHistoryFields block={block} edits={edits} />;
    case 'legal':
      return <LegalFields block={block} edits={edits} />;
    case 'refund':
      return <RefundFields block={block} edits={edits} />;
    case 'contact':
      return <ContactFields block={block} edits={edits} />;
    case 'loyalty':
      return <LoyaltyFields block={block} edits={edits} />;
    case 'delivery':
      return <DeliveryFields block={block} edits={edits} />;
    case 'image':
      return <ImageFields block={block} edits={edits} onImageRejected={onImageRejected} />;
    case 'divider':
      return null;
  }
}
