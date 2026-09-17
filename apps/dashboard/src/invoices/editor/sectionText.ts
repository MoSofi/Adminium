// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every label the editor prints for a section, an optional block, a custom
 * type or a seeded row (the comp's `insMeta` 1565, `optionalSecs()`
 * 1257-1265, `customDefs()` 1266-1272, `newCustom` 1274-1281, `addItem`
 * 1356, `addCustomRow` 1315), in one place so the canvas, the inspector and
 * the Add-section modal never disagree.
 *
 * Every string is an `invoices:` key with the comp's English as its inline
 * fallback — byte-identical to `locales/en-US/invoices.json` (the deferred
 * namespace gate, `i18n/invoicesNamespace.test.ts`). Three of them are the
 * lexicon's, not the comp's (34 Appendix D.2): *Invoice to* for the comp's
 * column label, *Charge schedule* for the recurring hint, and the two custom
 * hints re-worded so the built bytes pass the substring sweep.
 */
import { t } from '../../i18n/t.js';
import type { CustomSectionType } from '../model/envelope.js';
import type { CustomSeed } from '../model/ops.js';
import { CUSTOM_SECTION_ICON, SECTION_ICONS, isCustomKey, type FixedSectionKey, type OptionalFlag, type SectionKey } from '../model/blocks.js';

export interface SectionHeader {
  icon: string;
  title: string;
  hint: string;
}

/** The comp's `insMeta` (1565) for a fixed section. */
export function fixedSectionHeader(section: FixedSectionKey): SectionHeader {
  const icon = SECTION_ICONS[section];
  switch (section) {
    case 'branding':
      return { icon, title: t('invoices:section.branding.title', 'Branding'), hint: t('invoices:section.branding.hint', 'Logo & brand name') };
    case 'theme':
      return { icon, title: t('invoices:section.theme.title', 'Title & theme'), hint: t('invoices:section.theme.hint', 'Colour, currency, status') };
    case 'from':
      return { icon, title: t('invoices:section.from.title', 'From'), hint: t('invoices:section.from.hint', 'Your company details') };
    case 'customer':
      return { icon, title: t('invoices:section.customer.title', 'Invoice to'), hint: t('invoices:section.customer.hint', 'Client details') };
    case 'meta':
      return { icon, title: t('invoices:section.meta.title', 'Invoice details'), hint: t('invoices:section.meta.hint', 'Number, dates, PO & terms') };
    case 'items':
      return { icon, title: t('invoices:section.items.title', 'Line items'), hint: t('invoices:section.items.hint', 'Products & services') };
    case 'tax':
      return { icon, title: t('invoices:section.tax.title', 'Tax & totals'), hint: t('invoices:section.tax.hint', 'Rates & discounts') };
    case 'payment':
      return { icon, title: t('invoices:section.payment.title', 'Payment'), hint: t('invoices:section.payment.hint', 'How to pay') };
    case 'notes':
      return { icon, title: t('invoices:section.notes.title', 'Notes'), hint: t('invoices:section.notes.hint', 'Footer text') };
    case 'shipto':
      return { icon, title: t('invoices:section.shipto.title', 'Ship to'), hint: t('invoices:section.shipto.hint', 'Delivery address') };
    case 'signature':
      return { icon, title: t('invoices:section.signature.title', 'Signature'), hint: t('invoices:section.signature.hint', 'Authorised sign-off') };
    case 'terms':
      return { icon, title: t('invoices:section.terms.title', 'Terms'), hint: t('invoices:section.terms.hint', 'Acceptance checkbox') };
    case 'attachments':
      return { icon, title: t('invoices:section.attachments.title', 'Attachments'), hint: t('invoices:section.attachments.hint', 'Attached files') };
    case 'approval':
      return { icon, title: t('invoices:section.approval.title', 'Approval'), hint: t('invoices:section.approval.hint', 'Sign-off status') };
    case 'qr':
      return { icon, title: t('invoices:section.qr.title', 'Payment QR'), hint: t('invoices:section.qr.hint', 'Scan-to-pay code') };
    case 'latefees':
      return { icon, title: t('invoices:section.latefees.title', 'Late fees'), hint: t('invoices:section.latefees.hint', 'Overdue penalty') };
    case 'poterms':
      return { icon, title: t('invoices:section.poterms.title', 'PO terms'), hint: t('invoices:section.poterms.hint', 'Purchase order terms') };
    case 'multicurrency':
      return { icon, title: t('invoices:section.multicurrency.title', 'Multi-currency'), hint: t('invoices:section.multicurrency.hint', 'Totals in other currencies') };
    case 'recurring':
      return { icon, title: t('invoices:section.recurring.title', 'Recurring'), hint: t('invoices:section.recurring.hint', 'Charge schedule') };
    case 'discount':
      return { icon, title: t('invoices:section.discount.title', 'Discount codes'), hint: t('invoices:section.discount.hint', 'Applied promo codes') };
    case 'taxbreak':
      return { icon, title: t('invoices:section.taxbreak.title', 'Tax breakdown'), hint: t('invoices:section.taxbreak.hint', 'Tax components') };
    case 'payhistory':
      return { icon, title: t('invoices:section.payhistory.title', 'Payment history'), hint: t('invoices:section.payhistory.hint', 'Past payments') };
    case 'legal':
      return { icon, title: t('invoices:section.legal.title', 'Legal footer'), hint: t('invoices:section.legal.hint', 'Fine print') };
    case 'refund':
      return { icon, title: t('invoices:section.refund.title', 'Refund policy'), hint: t('invoices:section.refund.hint', 'Returns & refunds') };
    case 'contact':
      return { icon, title: t('invoices:section.contact.title', 'Contact'), hint: t('invoices:section.contact.hint', 'Support details') };
    case 'loyalty':
      return { icon, title: t('invoices:section.loyalty.title', 'Loyalty points'), hint: t('invoices:section.loyalty.hint', 'Rewards balance') };
    case 'delivery':
      return { icon, title: t('invoices:section.delivery.title', 'Delivery timeline'), hint: t('invoices:section.delivery.hint', 'Fulfilment status') };
    case 'images':
      return { icon, title: t('invoices:section.images.title', 'Images'), hint: t('invoices:section.images.hint', 'Logo, background, QR & photos') };
  }
}

/** The header for any selection: a custom section shows its own title (comp 1565's `cus:` branch). */
export function sectionHeader(section: SectionKey, customTitle: string | null): SectionHeader {
  if (isCustomKey(section)) {
    return {
      icon: CUSTOM_SECTION_ICON,
      title: customTitle === null || customTitle === '' ? t('invoices:section.custom.title', 'Custom section') : customTitle,
      hint: t('invoices:section.custom.hint', 'Your own section'),
    };
  }
  return fixedSectionHeader(section);
}

/** The Add-section modal's chip labels (comp `optionalSecs()`, 1258-1263). */
export function optionalSectionLabel(flag: OptionalFlag): string {
  switch (flag) {
    case 'shipShow':
      return t('invoices:optional.shipShow', 'Ship to');
    case 'sigShow':
      return t('invoices:optional.sigShow', 'Signature');
    case 'termsShow':
      return t('invoices:optional.termsShow', 'Terms acceptance');
    case 'attachShow':
      return t('invoices:optional.attachShow', 'Attachments');
    case 'approvalShow':
      return t('invoices:optional.approvalShow', 'Approval');
    case 'qrShow':
      return t('invoices:optional.qrShow', 'Payment QR');
    case 'lateShow':
      return t('invoices:optional.lateShow', 'Late fees');
    case 'poShow':
      return t('invoices:optional.poShow', 'PO terms');
    case 'mcShow':
      return t('invoices:optional.mcShow', 'Multi-currency');
    case 'recurShow':
      return t('invoices:optional.recurShow', 'Recurring');
    case 'discShow':
      return t('invoices:optional.discShow', 'Discount codes');
    case 'taxbShow':
      return t('invoices:optional.taxbShow', 'Tax breakdown');
    case 'payhShow':
      return t('invoices:optional.payhShow', 'Payment history');
    case 'legalShow':
      return t('invoices:optional.legalShow', 'Legal footer');
    case 'refShow':
      return t('invoices:optional.refShow', 'Refund policy');
    case 'conShow':
      return t('invoices:optional.conShow', 'Contact');
    case 'loyShow':
      return t('invoices:optional.loyShow', 'Loyalty points');
    case 'delShow':
      return t('invoices:optional.delShow', 'Delivery timeline');
  }
}

/** The modal's *Build your own* tiles (comp `customDefs()`, 1268-1271; two hints re-worded per 34 Appendix D.2). */
export function customTypeText(type: CustomSectionType): { label: string; hint: string } {
  switch (type) {
    case 'text':
      return { label: t('invoices:custom.text.label', 'Text section'), hint: t('invoices:custom.text.hint', 'Your own copy — notes, scope, conditions') };
    case 'image':
      return { label: t('invoices:custom.image.label', 'Image block'), hint: t('invoices:custom.image.hint', 'Upload a photo, drawing or certificate') };
    case 'kv':
      return { label: t('invoices:custom.kv.label', 'Detail rows'), hint: t('invoices:custom.kv.hint', 'Label / value pairs') };
    case 'gallery':
      return { label: t('invoices:custom.gallery.label', 'Image row'), hint: t('invoices:custom.gallery.hint', 'Two or three images side by side') };
  }
}

/** What a new custom section starts with (comp `newCustom`, 1277-1280), in the viewer's language. */
export function customSeed(): CustomSeed {
  return {
    text: {
      title: t('invoices:seed.text.title', 'Additional notes'),
      body: t('invoices:seed.text.body', 'Add your own copy here — scope, delivery notes, conditions or a message to the client.'),
    },
    image: { title: t('invoices:seed.image.title', 'Image'), caption: t('invoices:seed.image.caption', 'Add a caption') },
    kv: {
      title: t('invoices:seed.kv.title', 'Reference details'),
      rows: [
        { k: t('invoices:seed.kv.row1k', 'Cost centre'), v: 'CC-4410' },
        { k: t('invoices:seed.kv.row2k', 'Contract'), v: 'MSA-2026-08' },
      ],
    },
    gallery: { title: t('invoices:seed.gallery.title', 'Images') },
  };
}

/** `addCustomRow`'s seed (comp 1315). */
export function customRowSeed(): { k: string; v: string } {
  return { k: t('invoices:seed.kv.label', 'Label'), v: t('invoices:seed.kv.value', 'Value') };
}

/** `addItem`'s seed description (comp 1356). */
export function newItemDescription(): string {
  return t('invoices:seed.item', 'New item');
}
