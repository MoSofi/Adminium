// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The block registry: every key in `blockOrder` (comp 1114; 34-invoices-add-
 * on.md Appendix F) to the component that draws it, plus the name the grip
 * and the insert chip announce for it. The 23 built-ins are keyed by
 * `BuiltinBlockKey`; a `cus:` key renders `CustomBlock` with its section.
 *
 * The label is the inspector's own word for the section (`sectionText.ts`),
 * so the sheet and the aside never disagree; the two blocks that hold two
 * sections (`parties`, `paynotes`) join theirs.
 */
import type { ReactNode } from 'react';

import { t } from '../../../../i18n/t.js';
import type { BuiltinBlockKey } from '../../../model/blocks.js';
import { fixedSectionHeader, optionalSectionLabel } from '../../sectionText.js';
import { ApprovalBlock, LatefeesBlock, LoyaltyBlock, RecurringBlock } from './banners.js';
import { ItemsBlock, TotalsBlock } from './items.js';
import { AttachmentsBlock, DiscountBlock, MulticurrencyBlock, PayhistoryBlock, TaxbreakBlock } from './lists.js';
import { DeliveryBlock, QrBlock } from './media.js';
import { MetaBlock, PartiesBlock, ShippingBlock } from './parties.js';
import { ContactBlock, LegalBlock, PaynotesBlock, PotermsBlock, RefundBlock, SignatureBlock, TermsBlock } from './text.js';
import type { BlockProps } from './types.js';

export { CustomBlock, type CustomBlockProps } from './custom.js';
export type { BlockProps } from './types.js';

const BLOCK_LABELS: Readonly<Record<BuiltinBlockKey, () => string>> = {
  parties: () => t('invoices:canvas.blocks.parties', 'From & Invoice to'),
  shipping: () => optionalSectionLabel('shipShow'),
  meta: () => fixedSectionHeader('meta').title,
  items: () => fixedSectionHeader('items').title,
  totals: () => fixedSectionHeader('tax').title,
  paynotes: () => t('invoices:canvas.blocks.paynotes', 'Payment & notes'),
  signature: () => optionalSectionLabel('sigShow'),
  terms: () => optionalSectionLabel('termsShow'),
  attachments: () => optionalSectionLabel('attachShow'),
  approval: () => optionalSectionLabel('approvalShow'),
  qr: () => optionalSectionLabel('qrShow'),
  latefees: () => optionalSectionLabel('lateShow'),
  poterms: () => optionalSectionLabel('poShow'),
  multicurrency: () => optionalSectionLabel('mcShow'),
  recurring: () => optionalSectionLabel('recurShow'),
  discount: () => optionalSectionLabel('discShow'),
  taxbreak: () => optionalSectionLabel('taxbShow'),
  payhistory: () => optionalSectionLabel('payhShow'),
  legal: () => optionalSectionLabel('legalShow'),
  refund: () => optionalSectionLabel('refShow'),
  contact: () => optionalSectionLabel('conShow'),
  loyalty: () => optionalSectionLabel('loyShow'),
  delivery: () => optionalSectionLabel('delShow'),
};

/** What the grip and the insert chip call a built-in block. */
export function builtinBlockLabel(key: BuiltinBlockKey): string {
  return BLOCK_LABELS[key]();
}

/** The comp's `blk.is*` branches (388-668), one component each. */
export function renderBuiltinBlock(key: BuiltinBlockKey, props: BlockProps): ReactNode {
  switch (key) {
    case 'parties':
      return <PartiesBlock {...props} />;
    case 'shipping':
      return <ShippingBlock {...props} />;
    case 'meta':
      return <MetaBlock {...props} />;
    case 'items':
      return <ItemsBlock {...props} />;
    case 'totals':
      return <TotalsBlock {...props} />;
    case 'paynotes':
      return <PaynotesBlock {...props} />;
    case 'signature':
      return <SignatureBlock {...props} />;
    case 'terms':
      return <TermsBlock {...props} />;
    case 'attachments':
      return <AttachmentsBlock {...props} />;
    case 'approval':
      return <ApprovalBlock {...props} />;
    case 'qr':
      return <QrBlock {...props} />;
    case 'latefees':
      return <LatefeesBlock {...props} />;
    case 'poterms':
      return <PotermsBlock {...props} />;
    case 'multicurrency':
      return <MulticurrencyBlock {...props} />;
    case 'recurring':
      return <RecurringBlock {...props} />;
    case 'discount':
      return <DiscountBlock {...props} />;
    case 'taxbreak':
      return <TaxbreakBlock {...props} />;
    case 'payhistory':
      return <PayhistoryBlock {...props} />;
    case 'legal':
      return <LegalBlock {...props} />;
    case 'refund':
      return <RefundBlock {...props} />;
    case 'contact':
      return <ContactBlock {...props} />;
    case 'loyalty':
      return <LoyaltyBlock {...props} />;
    case 'delivery':
      return <DeliveryBlock {...props} />;
  }
}
