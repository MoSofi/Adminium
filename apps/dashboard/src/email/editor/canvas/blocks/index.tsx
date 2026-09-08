// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One preview per canvas family (the comp's `FAMS`, 1420), dispatched by the
 * registry's `family`. An unknown kind (a row saved by a newer server)
 * renders as a titled-text section rather than nothing, so the operator
 * still sees that something is there.
 */
import { EMAIL_BLOCKS, isEmailBlockKind, type EmailBlockDef } from '../../../model/blocks.js';
import {
  BoxPreview,
  ContactPreview,
  DeliveryPreview,
  DiscountPreview,
  LoyaltyPreview,
  PayHistoryPreview,
  ProductPreview,
  RecurringPreview,
  StatsPreview,
  TitledRowsPreview,
} from './commerce.js';
import { CtaPreview, DividerPreview, HtmlPreview, ImagePreview, SocialPreview, SpacerPreview } from './media.js';
import { BodyPreview, FooterBlockPreview, HeadingPreview, ListPreview, QuotePreview, TitledTextPreview, TwoColPreview } from './text.js';
import type { BlockPreviewProps } from './types.js';

export type { BlockPreviewProps } from './types.js';

const UNKNOWN: EmailBlockDef = {
  kind: 'email.text',
  label: 'Section',
  icon: 'square',
  hint: '',
  family: 'TitledText',
  sized: false,
  fine: false,
  vars: false,
  fields: [],
  rows: undefined,
  pickable: false,
};

/** The registry entry for a block, or the neutral fallback for a kind this build does not know. */
export function blockDef(kind: string): EmailBlockDef {
  return isEmailBlockKind(kind) ? EMAIL_BLOCKS[kind] : UNKNOWN;
}

export function BlockPreview(props: BlockPreviewProps) {
  switch (props.def.family) {
    case 'Heading':
      return <HeadingPreview {...props} />;
    case 'Body':
      return <BodyPreview {...props} />;
    case 'Box':
      return <BoxPreview {...props} />;
    case 'Cta':
      return <CtaPreview {...props} />;
    case 'Divider':
      return <DividerPreview {...props} />;
    case 'Spacer':
      return <SpacerPreview {...props} />;
    case 'Image':
      return <ImagePreview {...props} />;
    case 'Twocol':
      return <TwoColPreview {...props} />;
    case 'List':
      return <ListPreview {...props} />;
    case 'Quote':
      return <QuotePreview {...props} />;
    case 'Stats':
      return <StatsPreview {...props} />;
    case 'Product':
      return <ProductPreview {...props} />;
    case 'Social':
      return <SocialPreview {...props} />;
    case 'Html':
      return <HtmlPreview {...props} />;
    case 'TitledText':
      return <TitledTextPreview {...props} />;
    case 'TitledRows':
      return <TitledRowsPreview {...props} />;
    case 'Recurring':
      return <RecurringPreview {...props} />;
    case 'Discount':
      return <DiscountPreview {...props} />;
    case 'Payhistory':
      return <PayHistoryPreview {...props} />;
    case 'Contact':
      return <ContactPreview {...props} />;
    case 'Loyalty':
      return <LoyaltyPreview {...props} />;
    case 'Delivery':
      return <DeliveryPreview {...props} />;
    case 'Footer':
      return <FooterBlockPreview {...props} />;
  }
}
