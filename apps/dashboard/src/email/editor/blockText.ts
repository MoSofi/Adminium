// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The translated label and hint of every block kind (the comp's `blockDefs`
 * labels, Appendix C). Written out per kind rather than built from the kind
 * string so the i18n key-coverage gate — which reads `t()` LITERALS — can see
 * every key.
 */
import { t } from '../../i18n/t.js';
import type { EmailBlockKind } from '../model/blocks.js';

export function blockLabel(kind: EmailBlockKind | string): string {
  switch (kind) {
    case 'email.heading':
      return t('email:blocks.heading.label', 'Heading');
    case 'email.text':
      return t('email:blocks.text.label', 'Text block');
    case 'email.button':
      return t('email:blocks.button.label', 'Button');
    case 'email.divider':
      return t('email:blocks.divider.label', 'Divider / spacer');
    case 'email.spacer':
      return t('email:blocks.spacer.label', 'Spacer');
    case 'email.footer':
      return t('email:blocks.footer.label', 'Footer text');
    case 'email.image':
      return t('email:blocks.image.label', 'Image placeholder');
    case 'email.two-col':
      return t('email:blocks.two-col.label', 'Two-column text');
    case 'email.list':
      return t('email:blocks.list.label', 'Bulleted list');
    case 'email.quote':
      return t('email:blocks.quote.label', 'Quote');
    case 'email.social':
      return t('email:blocks.social.label', 'Social links');
    case 'email.html':
      return t('email:blocks.html.label', 'Custom HTML');
    case 'email.box':
      return t('email:blocks.box.label', 'Highlight box');
    case 'email.stats':
      return t('email:blocks.stats.label', 'Stat row');
    case 'email.product':
      return t('email:blocks.product.label', 'Product row');
    case 'email.multi-currency':
      return t('email:blocks.multi-currency.label', 'Multi-currency');
    case 'email.tax-breakdown':
      return t('email:blocks.tax-breakdown.label', 'Tax breakdown');
    case 'email.discount-codes':
      return t('email:blocks.discount-codes.label', 'Discount codes');
    case 'email.payment-history':
      return t('email:blocks.payment-history.label', 'Payment history');
    case 'email.recurring':
      return t('email:blocks.recurring.label', 'Recurring schedule');
    case 'email.loyalty':
      return t('email:blocks.loyalty.label', 'Loyalty points');
    case 'email.delivery':
      return t('email:blocks.delivery.label', 'Delivery timeline');
    case 'email.po-terms':
      return t('email:blocks.po-terms.label', 'PO terms');
    case 'email.legal':
      return t('email:blocks.legal.label', 'Legal footer');
    case 'email.refund-policy':
      return t('email:blocks.refund-policy.label', 'Refund policy');
    case 'email.contact':
      return t('email:blocks.contact.label', 'Contact block');
    default:
      return t('email:blocks.unknown.label', 'Section');
  }
}

export function blockHint(kind: EmailBlockKind | string): string {
  switch (kind) {
    case 'email.heading':
      return t('email:blocks.heading.hint', 'Section headline');
    case 'email.text':
      return t('email:blocks.text.hint', 'One or more paragraphs');
    case 'email.button':
      return t('email:blocks.button.hint', 'Primary call-to-action');
    case 'email.divider':
      return t('email:blocks.divider.hint', 'Rule or empty space');
    case 'email.spacer':
      return t('email:blocks.spacer.hint', 'Empty space');
    case 'email.footer':
      return t('email:blocks.footer.hint', 'Legacy footer block');
    case 'email.image':
      return t('email:blocks.image.hint', 'Drop artwork in later');
    case 'email.two-col':
      return t('email:blocks.two-col.hint', 'Side-by-side copy');
    case 'email.list':
      return t('email:blocks.list.hint', 'Short bullet points');
    case 'email.quote':
      return t('email:blocks.quote.hint', 'Testimonial with attribution');
    case 'email.social':
      return t('email:blocks.social.hint', 'Footer link chips');
    case 'email.html':
      return t('email:blocks.html.hint', 'Paste your own markup');
    case 'email.box':
      return t('email:blocks.box.hint', 'Label and a big value');
    case 'email.stats':
      return t('email:blocks.stats.hint', 'Two to four figures');
    case 'email.product':
      return t('email:blocks.product.hint', 'Line items with prices');
    case 'email.multi-currency':
      return t('email:blocks.multi-currency.hint', 'Totals in other currencies');
    case 'email.tax-breakdown':
      return t('email:blocks.tax-breakdown.hint', 'Tax components');
    case 'email.discount-codes':
      return t('email:blocks.discount-codes.hint', 'Applied promo codes');
    case 'email.payment-history':
      return t('email:blocks.payment-history.hint', 'Past payments');
    case 'email.recurring':
      return t('email:blocks.recurring.hint', 'Delivery cadence');
    case 'email.loyalty':
      return t('email:blocks.loyalty.hint', 'Rewards balance');
    case 'email.delivery':
      return t('email:blocks.delivery.hint', 'Fulfilment status');
    case 'email.po-terms':
      return t('email:blocks.po-terms.hint', 'Purchase order terms');
    case 'email.legal':
      return t('email:blocks.legal.hint', 'Fine print');
    case 'email.refund-policy':
      return t('email:blocks.refund-policy.hint', 'Returns and refunds');
    case 'email.contact':
      return t('email:blocks.contact.hint', 'Support details');
    default:
      return '';
  }
}

/** The picker's group labels (comp `pickerCats`). */
export function pickerGroupLabel(key: 'content' | 'commerce' | 'legal' | 'saved'): string {
  switch (key) {
    case 'content':
      return t('email:picker.groups.content', 'Content');
    case 'commerce':
      return t('email:picker.groups.commerce', 'Commerce & data');
    case 'legal':
      return t('email:picker.groups.legal', 'Legal & support');
    case 'saved':
      return t('email:picker.groups.saved', 'Saved blocks');
  }
}
