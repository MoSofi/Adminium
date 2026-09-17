// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The block vocabulary (the comp's `palDefs` 608 and `kindMeta` 473):
 * the 25 kinds in palette order, the label and glyph each one carries,
 * and the seed a palette click creates.
 *
 * ─── THE `kindMeta` DEFECT IS FIXED BY CONSTRUCTION (D13) ──────────────────
 *
 * The comp's `kindMeta` returns a POSITIONAL pair — `[label, icon]` for 21
 * kinds and `[icon, label]` for four (`refund`, `contact`, `loyalty`,
 * `delivery`, 473), so the palette prints a glyph slug where a label belongs.
 * The bug is a shape, not a typo: nothing in `['award', 'Loyalty points']`
 * says which half is which. Here the pair is a RECORD with named fields, so
 * the swap is unrepresentable, and `blocks.test.ts` pins every entry
 * (257's row, now on the surface that ships).
 *
 * The labels below are the ENGLISH fallbacks. Every one is also a
 * `reportBuilder:block.<kind>.label` key; `blockText.ts` is where the editor
 * reads them, and the two must stay byte-identical (the deferred-namespace
 * contract test).
 */
import {
  REPORT_BLOCK_KINDS,
  newLocalId,
  type AttachmentRef,
  type DeliveryStep,
  type DiscountCode,
  type FxRate,
  type KpiEntry,
  type PaymentRecord,
  type ReportBlock,
  type ReportBlockKind,
  type SeriesPoint,
  type TaxLine,
} from './envelope.js';

export { REPORT_BLOCK_KINDS, isReportBlockKind, type ReportBlockKind } from './envelope.js';

export interface BlockKindMeta {
  /** Title-cased copy — the palette row and the inspector banner (608, 632). */
  label: string;
  /** A lucide slug the surface's `icons.ts` resolves. */
  icon: string;
}

/** The comp's `kindMeta` (473), un-swapped and named. */
export const BLOCK_KIND_META: Readonly<Record<ReportBlockKind, BlockKindMeta>> = {
  heading: { label: 'Heading', icon: 'heading' },
  text: { label: 'Text', icon: 'align-left' },
  kpi: { label: 'KPI row', icon: 'layout-grid' },
  bar: { label: 'Bar chart', icon: 'bar-chart-3' },
  line: { label: 'Line chart', icon: 'trending-up' },
  table: { label: 'Table', icon: 'table-2' },
  signature: { label: 'Signature', icon: 'pen-line' },
  terms: { label: 'Terms', icon: 'square-check-big' },
  attachments: { label: 'Attachments', icon: 'paperclip' },
  approval: { label: 'Approval', icon: 'badge-check' },
  qr: { label: 'Payment QR', icon: 'qr-code' },
  latefees: { label: 'Late fees', icon: 'alarm-clock' },
  poterms: { label: 'PO terms', icon: 'scroll-text' },
  multicurrency: { label: 'Multi-currency', icon: 'coins' },
  recurring: { label: 'Recurring', icon: 'repeat' },
  discount: { label: 'Discount codes', icon: 'ticket-percent' },
  taxbreak: { label: 'Tax breakdown', icon: 'percent' },
  payhistory: { label: 'Payment history', icon: 'history' },
  legal: { label: 'Legal footer', icon: 'scale' },
  // The four the comp returns backwards (473).
  refund: { label: 'Refund policy', icon: 'rotate-ccw' },
  contact: { label: 'Contact', icon: 'life-buoy' },
  loyalty: { label: 'Loyalty points', icon: 'award' },
  delivery: { label: 'Delivery timeline', icon: 'truck' },
  image: { label: 'Image', icon: 'image' },
  divider: { label: 'Divider', icon: 'minus' },
};

/** The seeded strings a palette click writes — English fallbacks, keyed in `blockText.ts`. */
export interface BlockSeedText {
  /**
   * The block's own title — the kind's LABEL as the viewer reads it (the
   * comp's `blk()`, 474). Passed in rather than read off
   * {@link BLOCK_KIND_META} because the label the viewer sees is a
   * `reportBuilder:` key and this module holds only its English fallback.
   */
  title: string;
  heading: string;
  paragraph: string;
  metric: string;
  tableRows: [string, string][];
  sigName: string;
  sigTitle: string;
  termsLabel: string;
  attachments: [string, string][];
  apprName: string;
  apprTitle: string;
  qrCaption: string;
  poTerms: string;
  discount: { code: string; label: string; amount: string };
  taxLines: [string, string][];
  payment: { date: string; method: string; amount: string };
  legalText: string;
  refText: string;
  contact: { name: string; email: string; phone: string };
  loyLevel: string;
  recurNext: string;
  recurCount: string;
  delSteps: [string, 'todo' | 'current' | 'done'][];
  imageCaption: string;
}

/**
 * The comp's `newBlockContent` (536), with Appendix D applied: the contact
 * seed names a fictional business rather than the company, and the loyalty
 * field is `loyLevel` where the comp's name is a word.
 */
export const DEFAULT_BLOCK_SEED: BlockSeedText = {
  title: '',
  heading: 'New heading',
  paragraph: 'New paragraph — click to edit this text.',
  metric: 'Metric',
  tableRows: [
    ['Column', 'Value'],
    ['Row 1', '—'],
    ['Row 2', '—'],
  ],
  sigName: 'Ava Reyes',
  sigTitle: 'Prepared by',
  termsLabel: 'I approve this report and its contents.',
  attachments: [
    ['Appendix-data.xlsx', '128 KB'],
    ['Methodology.pdf', '64 KB'],
  ],
  apprName: 'Ava Reyes',
  apprTitle: 'Report owner',
  qrCaption: 'Scan to open the live report',
  poTerms: 'This report is issued under the standard reporting agreement. Figures are provisional until finalised.',
  discount: { code: 'WELCOME10', label: '10% welcome credit', amount: '-$29.00' },
  taxLines: [
    ['State tax (6%)', '$28.90'],
    ['City tax (2%)', '$9.64'],
  ],
  payment: { date: 'Jul 2, 2026', method: 'Visa ·· 4242', amount: '$500.00' },
  legalText: 'This report is provided for informational purposes. Figures are unaudited and subject to revision.',
  refText: 'Full refunds are available within 30 days of purchase. Contact support to begin a return.',
  contact: { name: 'Orchard Lane Studio', email: 'hello@orchardlane.example', phone: '+1 (555) 010-0100' },
  loyLevel: 'Gold',
  recurNext: 'Aug 12, 2026',
  recurCount: '12 cycles',
  delSteps: [
    ['Ordered', 'done'],
    ['Processing', 'done'],
    ['Shipped', 'current'],
    ['Delivered', 'todo'],
  ],
  imageCaption: 'image placeholder',
};

/**
 * A palette click's block — the comp's `newBlockContent` (536) over `blk()`
 * (474): the kind's label as the title, full width, shown, and the kind's own
 * seeded fields.
 */
export function newBlock(kind: ReportBlockKind, seed: BlockSeedText, id: string = newLocalId()): ReportBlock {
  const title = seed.title === '' ? BLOCK_KIND_META[kind].label : seed.title;
  const common = { id, title, w: 'full' as const, show: true };
  switch (kind) {
    case 'heading':
      return { ...common, kind, text: seed.heading };
    case 'text':
      return { ...common, kind, text: seed.paragraph };
    case 'kpi':
      return {
        ...common,
        kind,
        kpis: [
          { label: seed.metric, value: '0', delta: '' },
          { label: seed.metric, value: '0', delta: '' },
        ],
      };
    case 'bar':
      return {
        ...common,
        kind,
        series: [
          { label: 'A', value: 40 },
          { label: 'B', value: 65 },
          { label: 'C', value: 52 },
        ],
      };
    case 'line':
      return {
        ...common,
        kind,
        series: [
          { label: 'A', value: 30 },
          { label: 'B', value: 55 },
          { label: 'C', value: 48 },
          { label: 'D', value: 72 },
        ],
      };
    case 'table':
      return { ...common, kind, rows: seed.tableRows.map(([a, b]): [string, string] => [a, b]) };
    case 'signature':
      return { ...common, kind, sigName: seed.sigName, sigTitle: seed.sigTitle };
    case 'terms':
      return { ...common, kind, termsLabel: seed.termsLabel, termsChecked: false };
    case 'attachments':
      return { ...common, kind, attachments: seed.attachments.map(([name, size]) => ({ name, size })) };
    case 'approval':
      return { ...common, kind, apprName: seed.apprName, apprTitle: seed.apprTitle, apprStatus: 'approved' };
    case 'qr':
      return { ...common, kind, qrCaption: seed.qrCaption };
    case 'latefees':
      return { ...common, kind, lateRate: '1.5', lateDays: 7 };
    case 'poterms':
      return { ...common, kind, poTerms: seed.poTerms };
    case 'multicurrency':
      return {
        ...common,
        kind,
        mcAmount: '48200',
        fx: [
          { code: 'EUR', sym: '€', rate: '0.92' },
          { code: 'GBP', sym: '£', rate: '0.79' },
        ],
      };
    case 'recurring':
      return { ...common, kind, recurFreq: 'Monthly', recurNext: seed.recurNext, recurCount: seed.recurCount };
    case 'discount':
      return { ...common, kind, discCodes: [{ ...seed.discount }] };
    case 'taxbreak':
      return { ...common, kind, taxLines: seed.taxLines.map(([label, amount]) => ({ label, amount })) };
    case 'payhistory':
      return { ...common, kind, payHist: [{ ...seed.payment, status: 'paid' }] };
    case 'legal':
      return { ...common, kind, legalText: seed.legalText };
    case 'refund':
      return { ...common, kind, refText: seed.refText };
    case 'contact':
      return { ...common, kind, conName: seed.contact.name, conEmail: seed.contact.email, conPhone: seed.contact.phone };
    case 'loyalty':
      return { ...common, kind, loyBalance: 1240, loyEarned: 290, loyLevel: seed.loyLevel };
    case 'delivery':
      return { ...common, kind, delSteps: seed.delSteps.map(([label, status]) => ({ label, status })) };
    case 'image':
      return { ...common, kind, text: seed.imageCaption, url: '' };
    case 'divider':
      return { ...common, kind };
  }
}

/**
 * The eight repeaters the inspector edits through one `RowsEditor`
 * (383-421), and the row each one holds. Written out rather than derived from
 * the block union: `Extract<ReportBlock, Record<F, unknown>>` does not resolve
 * while `F` is still generic, so the ops would lose their row types exactly
 * where they matter.
 */
export interface RowListRow {
  kpis: KpiEntry;
  series: SeriesPoint;
  attachments: AttachmentRef;
  fx: FxRate;
  discCodes: DiscountCode;
  taxLines: TaxLine;
  payHist: PaymentRecord;
  delSteps: DeliveryStep;
}
export type RowListField = keyof RowListRow;

/** The palette, in the comp's order — one entry per kind. */
export function paletteEntries(): { kind: ReportBlockKind; meta: BlockKindMeta }[] {
  return REPORT_BLOCK_KINDS.map((kind) => ({ kind, meta: BLOCK_KIND_META[kind] }));
}
