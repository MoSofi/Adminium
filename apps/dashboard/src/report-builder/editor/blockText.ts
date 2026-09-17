// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every label and seeded string the editor prints for a block
 * (the comp's `kindMeta` 473, `newBlockContent` 536, `insHeadMeta` 632,
 * `addArr`/`addRow` seeds 541-544, 645-667), in one place so the palette,
 * the canvas and the inspector never disagree.
 *
 * Every string is a `reportBuilder:` key with the comp's English as its
 * inline fallback — byte-identical to `locales/en-US/reportBuilder.json` (the
 * deferred-namespace gate, `i18n/reportBuilderNamespace.test.ts`). Four of
 * them are the lexicon's, not the comp's (43 Appendix D): the loyalty
 * *Level*, the late-fee *% per month* suffix, and the contact seed's name and
 * address, which name a fictional business rather than the company.
 *
 * The block LABELS mirror `model/blocks.ts`'s `BLOCK_KIND_META` exactly; the
 * model holds the English so the pure layer stays free of `t()`, and this
 * module is where the viewer's language is read.
 */
import { t } from '../../i18n/t.js';
import { BLOCK_KIND_META, DEFAULT_BLOCK_SEED, type BlockSeedText } from '../model/blocks.js';
import type { ReportBlockKind } from '../model/envelope.js';

/** The palette row's label and the block card's default title (comp 608, 474). */
export function blockLabel(kind: ReportBlockKind): string {
  const fallback = BLOCK_KIND_META[kind].label;
  switch (kind) {
    case 'heading':
      return t('reportBuilder:block.heading.label', 'Heading');
    case 'text':
      return t('reportBuilder:block.text.label', 'Text');
    case 'kpi':
      return t('reportBuilder:block.kpi.label', 'KPI row');
    case 'bar':
      return t('reportBuilder:block.bar.label', 'Bar chart');
    case 'line':
      return t('reportBuilder:block.line.label', 'Line chart');
    case 'table':
      return t('reportBuilder:block.table.label', 'Table');
    case 'signature':
      return t('reportBuilder:block.signature.label', 'Signature');
    case 'terms':
      return t('reportBuilder:block.terms.label', 'Terms');
    case 'attachments':
      return t('reportBuilder:block.attachments.label', 'Attachments');
    case 'approval':
      return t('reportBuilder:block.approval.label', 'Approval');
    case 'qr':
      return t('reportBuilder:block.qr.label', 'Payment QR');
    case 'latefees':
      return t('reportBuilder:block.latefees.label', 'Late fees');
    case 'poterms':
      return t('reportBuilder:block.poterms.label', 'PO terms');
    case 'multicurrency':
      return t('reportBuilder:block.multicurrency.label', 'Multi-currency');
    case 'recurring':
      return t('reportBuilder:block.recurring.label', 'Recurring');
    case 'discount':
      return t('reportBuilder:block.discount.label', 'Discount codes');
    case 'taxbreak':
      return t('reportBuilder:block.taxbreak.label', 'Tax breakdown');
    case 'payhistory':
      return t('reportBuilder:block.payhistory.label', 'Payment history');
    case 'legal':
      return t('reportBuilder:block.legal.label', 'Legal footer');
    case 'refund':
      return t('reportBuilder:block.refund.label', 'Refund policy');
    case 'contact':
      return t('reportBuilder:block.contact.label', 'Contact');
    case 'loyalty':
      return t('reportBuilder:block.loyalty.label', 'Loyalty points');
    case 'delivery':
      return t('reportBuilder:block.delivery.label', 'Delivery timeline');
    case 'image':
      return t('reportBuilder:block.image.label', 'Image');
    case 'divider':
      return t('reportBuilder:block.divider.label', 'Divider');
    default:
      return fallback;
  }
}

/** A palette click's seeded content, in the viewer's language (comp 536). */
export function blockSeed(kind: ReportBlockKind): BlockSeedText {
  return {
    ...DEFAULT_BLOCK_SEED,
    title: blockLabel(kind),
    heading: t('reportBuilder:seed.heading', 'New heading'),
    paragraph: t('reportBuilder:seed.paragraph', 'New paragraph — click to edit this text.'),
    metric: t('reportBuilder:seed.metric', 'Metric'),
    tableRows: [
      [t('reportBuilder:seed.table.column', 'Column'), t('reportBuilder:seed.table.value', 'Value')],
      [t('reportBuilder:seed.table.row', 'Row {n}', { n: 1 }), '—'],
      [t('reportBuilder:seed.table.row', 'Row {n}', { n: 2 }), '—'],
    ],
    termsLabel: t('reportBuilder:seed.termsLabel', 'I approve this report and its contents.'),
    apprTitle: t('reportBuilder:seed.apprTitle', 'Report owner'),
    sigTitle: t('reportBuilder:seed.sigTitle', 'Prepared by'),
    qrCaption: t('reportBuilder:seed.qrCaption', 'Scan to open the live report'),
    poTerms: t('reportBuilder:seed.poTerms', 'This report is issued under the standard reporting agreement. Figures are provisional until finalised.'),
    legalText: t('reportBuilder:seed.legalText', 'This report is provided for informational purposes. Figures are unaudited and subject to revision.'),
    refText: t('reportBuilder:seed.refText', 'Full refunds are available within 30 days of purchase. Contact support to begin a return.'),
    // Appendix D row 6: the comp seeds the company's own support desk.
    contact: {
      name: t('reportBuilder:seed.contactName', 'Orchard Lane Studio'),
      email: 'hello@orchardlane.example',
      phone: '+1 (555) 010-0100',
    },
    // Appendix D row 5: the comp's own field name is a word.
    loyLevel: t('reportBuilder:seed.loyLevel', 'Gold'),
    delSteps: [
      [t('reportBuilder:seed.step.ordered', 'Ordered'), 'done'],
      [t('reportBuilder:seed.step.processing', 'Processing'), 'done'],
      [t('reportBuilder:seed.step.shipped', 'Shipped'), 'current'],
      [t('reportBuilder:seed.step.delivered', 'Delivered'), 'todo'],
    ],
    imageCaption: t('reportBuilder:seed.imageCaption', 'image placeholder'),
    discount: {
      code: 'WELCOME10',
      label: t('reportBuilder:seed.discountLabel', '10% welcome credit'),
      amount: '-$29.00',
    },
    taxLines: [
      [t('reportBuilder:seed.taxState', 'State tax (6%)'), '$28.90'],
      [t('reportBuilder:seed.taxCity', 'City tax (2%)'), '$9.64'],
    ],
    attachments: [
      ['Appendix-data.xlsx', '128 KB'],
      ['Methodology.pdf', '64 KB'],
    ],
  };
}

/** The seeds an *Add …* button writes into a repeater (comp 645-667). */
export const rowSeeds = {
  /** `{ label: 'Metric', value: '0', delta: '' }` (646) — the Delta is O8's fill, seeded as the comp seeds it. */
  kpi: () => ({ label: t('reportBuilder:seed.metric', 'Metric'), value: '0', delta: '' }),
  /** `{ label: 'New', value: 50 }` (648). */
  series: () => ({ label: t('reportBuilder:seed.new', 'New'), value: 50 }),
  /** `['New', '—']` (544). */
  tableRow: (): [string, string] => [t('reportBuilder:seed.new', 'New'), '—'],
  /** `{ name: 'New file.pdf', size: '—' }` (652). */
  attachment: () => ({ name: t('reportBuilder:seed.newFile', 'New file.pdf'), size: '—' }),
  /** `{ code: 'USD', sym: '$', rate: 1 }` (657). */
  fx: () => ({ code: 'USD', sym: '$', rate: '1' }),
  /** `{ code: 'NEWCODE', label: 'New discount', amount: '-$0.00' }` (660). */
  discount: () => ({ code: t('reportBuilder:seed.newCode', 'NEWCODE'), label: t('reportBuilder:seed.newDiscount', 'New discount'), amount: '-$0.00' }),
  /** `{ label: 'New tax', amount: '$0.00' }` (661). */
  taxLine: () => ({ label: t('reportBuilder:seed.newTax', 'New tax'), amount: '$0.00' }),
  /** `{ date: '—', method: '—', amount: '$0.00', status: 'paid' }` (662). */
  payment: () => ({ date: '—', method: '—', amount: '$0.00', status: 'paid' as const }),
  /** `{ label: 'New step', status: 'todo' }` (667). */
  step: () => ({ label: t('reportBuilder:seed.newStep', 'New step'), status: 'todo' as const }),
};

/** The inspector banner's hint (comp `insHeadMeta`, 632). */
export function blockHint(): string {
  return t('reportBuilder:inspector.block.hint', 'Block content & settings');
}
