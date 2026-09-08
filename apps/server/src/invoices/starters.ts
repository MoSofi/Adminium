// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The seeded document and the twelve starters behind the New modal — the
 * comp's `base()` (1083-1115), `starterDefs()` (1117-1130), `fromStarter`
 * (1136) and `createBlank` (1383), re-themed under 34-invoices-add-on.md
 * Appendix D.2 (34-T46, Appendix G).
 *
 * WHAT CHANGED FROM THE COMP, AND WHY. The comp's default document is the
 * vendor invoicing a customer for seats and credits, over the vendor's own
 * letterhead — 24 D12 ("this add-on names no company") and 17 §2 head-on,
 * as product content rather than as copy. Every seeded string here is a
 * neutral fictional seller (Orchard Lane Studio) selling neutral goods to a
 * fictional customer, and none names Adminium, a real company, or a
 * subscription/seat/credit line item. The words the 17 §2 sweep would catch
 * are spelled out in Appendix D.2; `invoice-starters.test.ts` greps every
 * string here for them, and for the vendor's name.
 *
 * A starter is a PATCH over the base (`fromStarter`): it never touches
 * `blockOrder`, so every seeded document carries the default order and 15
 * of the 18 optional blocks are off in all of them. A starter's `status`
 * and `topic` are ROW facts, not body fields — the route writes them onto
 * the row (receipt and donation start as `paid`; the topic groups the
 * manager's list).
 *
 * The starter NAMES are English literals rather than message keys: the comp's
 * are, the dashboard shows them as the row's name, and a name is the
 * operator's to rename. The category is a lowercase KEY the dashboard labels.
 */
import { addDays, addMonths, formatDocumentDate } from './dates.js';
import { DEFAULT_ACCENT, newLocalId, normalizeInvoiceBody, type InvoiceBody, type InvoiceStatus, type LineItem } from './document.js';
import type { InvoiceLang } from './languages.js';

/** The comp's twelve starter keys, in its modal order (1119-1130). */
export const STARTER_KEYS = [
  'standard',
  'receipt',
  'proforma',
  'credit',
  'quote',
  'subscription',
  'deposit',
  'hourly',
  'milestone',
  'commercial',
  'donation',
  'retainer',
] as const;

export type InvoiceStarterKey = (typeof STARTER_KEYS)[number];

const STARTER_SET: ReadonlySet<string> = new Set(STARTER_KEYS);

export function isInvoiceStarterKey(value: unknown): value is InvoiceStarterKey {
  return typeof value === 'string' && STARTER_SET.has(value);
}

/** The comp's nine categories (Appendix G), as the lowercase keys the card carries. */
export type StarterCategory = 'business' | 'payments' | 'adjustments' | 'sales' | 'recurring' | 'services' | 'projects' | 'shipping' | 'nonprofit';

/** The family a starter's row joins (34 §3.9 `topic`); blank documents are `other`. */
export type StarterTopic = 'recurring' | 'services' | 'receipts' | 'sales' | 'logistics';

/** What the New modal shows per card (comp 123-136). */
export interface InvoiceStarterCard {
  key: InvoiceStarterKey;
  name: string;
  category: StarterCategory;
  /** Lucide icon name (the comp's). */
  icon: string;
  /** The sheet's title word. */
  title: string;
  accent: string;
}

/** What minting a starter needs: the moment, the document language, the number the row was given. */
export interface StarterContext {
  now: number;
  lang: InvoiceLang;
  number: string;
}

/** A starter fully rendered: the card, the body, and the two row facts. */
export interface RenderedStarter {
  card: InvoiceStarterCard;
  body: InvoiceBody;
  topic: StarterTopic;
  status: InvoiceStatus;
}

interface StarterDef {
  key: InvoiceStarterKey;
  name: string;
  category: StarterCategory;
  icon: string;
  title: string;
  topic: StarterTopic;
  accent?: string;
  status?: InvoiceStatus;
  items?: readonly [string, number, number][];
  patch?: Partial<Omit<InvoiceBody, 'items' | 'title' | 'accent'>>;
}

function item(desc: string, qty: number, rate: number): LineItem {
  return { id: newLocalId('i'), desc, qty: String(qty), rate: String(rate) };
}

/**
 * The comp's `base()` (1083-1115), re-themed: the document every new one
 * starts from. Dates come from `now`; the number is the row's.
 */
export function baseBody(ctx: StarterContext): InvoiceBody {
  const { now, lang, number } = ctx;
  return normalizeInvoiceBody({
    accent: DEFAULT_ACCENT,
    currency: '$',
    cents: true,
    title: 'INVOICE',
    logoIcon: 'hexagon',
    logoText: 'Orchard Lane',
    from: ['Orchard Lane Studio', '48 Orchard Lane, Portland, OR 97209', 'accounts@orchardlane.example'],
    customerName: 'Northwind Traders',
    customer: ['ops@northwind.example', '4200 Commerce Blvd', 'Austin, TX 78701'],
    number,
    issued: formatDocumentDate(now, lang),
    due: formatDocumentDate(addDays(now, 30), lang),
    terms: 'Net 30',
    items: [item('Brand identity — design retainer', 1, 2400), item('Website copy — 6 pages', 6, 180), item('Print collateral — setup', 1, 320)],
    taxRate: '8',
    discountRate: '0',
    payment: ['Bank transfer — Orchard Lane Studio', 'IBAN GB29 NWBK 6016 1331 9268 19', `Reference: ${number}`],
    notes: 'Payment due within 30 days. Thank you for your business.',
    poNumber: 'PO-4417',
    shipName: 'Northwind Traders — Receiving',
    ship: ['Dock 4, 88 Freight Road', 'Newark, NJ 07102'],
    shipShow: false,
    sigShow: false,
    sigName: 'Ava Reyes',
    sigTitle: 'Authorised signatory',
    termsShow: false,
    termsLabel: 'I have read and agree to the terms & conditions set out above.',
    termsChecked: false,
    attachShow: false,
    attachments: [
      { name: 'Statement of work.pdf', size: '214 KB' },
      { name: 'Delivery note.pdf', size: '96 KB' },
    ],
    approvalShow: false,
    apprName: 'Jordan Lee',
    apprTitle: 'Finance Director',
    apprStatus: 'approved',
    qrShow: false,
    qrCaption: 'Scan to pay with your banking app',
    lateShow: false,
    lateRate: '1.5',
    lateDays: 7,
    poShow: false,
    poTerms:
      'This purchase order is governed by the buyer’s standard terms & conditions. Goods remain returnable within 14 days of delivery. Prices are fixed for the duration of this order.',
    mcShow: false,
    fx: [
      { code: 'EUR', sym: '€', rate: '0.92' },
      { code: 'GBP', sym: '£', rate: '0.79' },
    ],
    recurShow: false,
    recurFreq: 'Monthly',
    recurNext: formatDocumentDate(addMonths(now, 1), lang),
    recurCount: '12 invoices',
    discShow: false,
    discCodes: [{ code: 'WELCOME10', label: '10% welcome credit', amount: '29' }],
    taxbShow: false,
    taxLines: [
      { label: 'State tax', rate: '6' },
      { label: 'City tax', rate: '2' },
    ],
    payhShow: false,
    payHist: [
      { date: formatDocumentDate(addDays(now, -10), lang), method: 'Visa ·· 4242', amount: '$500.00', status: 'paid' },
      { date: formatDocumentDate(addDays(now, -40), lang), method: 'Visa ·· 4242', amount: '$500.00', status: 'paid' },
    ],
    legalShow: false,
    legalText:
      'Orchard Lane Studio is registered in Oregon, USA (Reg. 00-0000000). This invoice is issued under applicable tax regulations. Disputes are governed by the laws of the State of Oregon.',
    refShow: false,
    refText: 'Full refunds are available within 30 days of purchase. Partial refunds may apply to used services. Contact support to begin a return.',
    conShow: false,
    conName: 'Orchard Lane Studio',
    conEmail: 'hello@orchardlane.example',
    conPhone: '+1 (555) 010-0100',
    loyShow: false,
    loyBalance: 1240,
    loyEarned: 290,
    loyLevel: 'Gold',
    delShow: false,
    delSteps: [
      { label: 'Ordered', status: 'done' },
      { label: 'Processing', status: 'done' },
      { label: 'Shipped', status: 'current' },
      { label: 'Delivered', status: 'todo' },
    ],
    bgImage: '',
    bgTint: 0.82,
    logoImage: '',
    qrImage: '',
    sigImage: '',
    stampImage: '',
    custom: [],
  });
}

/** The comp's `starterDefs()` (1119-1130), re-themed (Appendix D.2's rows for the seeded line items). */
const STARTERS: Readonly<Record<InvoiceStarterKey, StarterDef>> = {
  standard: {
    key: 'standard',
    name: 'Standard invoice',
    category: 'business',
    icon: 'file-text',
    title: 'INVOICE',
    topic: 'recurring',
    patch: { shipShow: true, sigShow: true, termsShow: true },
  },
  receipt: {
    key: 'receipt',
    name: 'Payment receipt',
    category: 'payments',
    icon: 'receipt',
    title: 'RECEIPT',
    topic: 'receipts',
    accent: '#12805c',
    status: 'paid',
    items: [['Studio membership — monthly', 1, 290]],
    patch: { terms: 'Paid', taxRate: '0', notes: 'Paid in full — thank you for your business!' },
  },
  proforma: {
    key: 'proforma',
    name: 'Proforma invoice',
    category: 'business',
    icon: 'file-check-2',
    title: 'PROFORMA',
    topic: 'sales',
    patch: { notes: 'This proforma is not a demand for payment. A final invoice will follow on delivery.' },
  },
  credit: {
    key: 'credit',
    name: 'Credit note',
    category: 'adjustments',
    icon: 'file-minus-2',
    title: 'CREDIT NOTE',
    topic: 'receipts',
    accent: '#e5484d',
    items: [['Refund — overcharged hours', 3, -63]],
    patch: { notes: 'Credit applied to your account balance.' },
  },
  quote: {
    key: 'quote',
    name: 'Quote / estimate',
    category: 'sales',
    icon: 'file-signature',
    title: 'ESTIMATE',
    topic: 'sales',
    patch: { terms: 'Valid 30 days', notes: 'This estimate is valid for 30 days. Prices subject to change thereafter.' },
  },
  subscription: {
    key: 'subscription',
    name: 'Subscription invoice',
    category: 'recurring',
    icon: 'repeat',
    title: 'INVOICE',
    topic: 'recurring',
    items: [
      ['Studio membership — monthly', 1, 290],
      ['Additional workstations (×4)', 4, 24],
    ],
    patch: { terms: 'Auto-charge', notes: 'Renews automatically on the 12th of each month. Manage your membership any time.' },
  },
  deposit: {
    key: 'deposit',
    name: 'Deposit invoice',
    category: 'payments',
    icon: 'piggy-bank',
    title: 'DEPOSIT',
    topic: 'sales',
    items: [['50% deposit — implementation project', 1, 4500]],
    patch: { notes: 'Deposit secures your project start date. Balance due on completion.' },
  },
  hourly: {
    key: 'hourly',
    name: 'Hourly / time',
    category: 'services',
    icon: 'clock',
    title: 'INVOICE',
    topic: 'services',
    items: [
      ['Design consulting — Jul', 24, 145],
      ['Front-end development — Jul', 38, 165],
    ],
    patch: { notes: 'Charged at agreed hourly rates. Timesheet available on request.' },
  },
  milestone: {
    key: 'milestone',
    name: 'Milestone invoice',
    category: 'projects',
    icon: 'flag',
    title: 'INVOICE',
    topic: 'services',
    items: [['Milestone 2 — Beta launch', 1, 7500]],
    patch: { notes: 'Payment tied to completion of Milestone 2 per statement of work.' },
  },
  commercial: {
    key: 'commercial',
    name: 'Commercial invoice',
    category: 'shipping',
    icon: 'ship',
    title: 'COMMERCIAL INVOICE',
    topic: 'logistics',
    items: [['Hardware units — model X200', 40, 89]],
    patch: { shipShow: true, sigShow: true, notes: 'For customs purposes. Country of origin: USA. HS code 8471.30.' },
  },
  donation: {
    key: 'donation',
    name: 'Donation receipt',
    category: 'nonprofit',
    icon: 'heart-handshake',
    title: 'DONATION RECEIPT',
    topic: 'receipts',
    accent: '#0d9488',
    status: 'paid',
    items: [['Charitable contribution', 1, 250]],
    patch: {
      taxRate: '0',
      terms: 'Received',
      notes: 'No goods or services were provided in exchange for this contribution. Tax ID 47-0000000.',
    },
  },
  retainer: {
    key: 'retainer',
    name: 'Retainer invoice',
    category: 'services',
    icon: 'handshake',
    title: 'INVOICE',
    topic: 'services',
    items: [['Monthly retainer — advisory', 1, 3000]],
    patch: { notes: 'Covers up to 20 hours of advisory work per month. Unused hours do not roll over.' },
  },
};

function cardOf(def: StarterDef): InvoiceStarterCard {
  return { key: def.key, name: def.name, category: def.category, icon: def.icon, title: def.title, accent: def.accent ?? DEFAULT_ACCENT };
}

/** The New modal's grid, in the comp's order (1406). */
export function starterCards(): InvoiceStarterCard[] {
  return STARTER_KEYS.map((key) => cardOf(STARTERS[key]));
}

/** The comp's `fromStarter` (1136): the base with the starter's patch over it, fresh item ids. */
export function renderStarter(key: InvoiceStarterKey, ctx: StarterContext): RenderedStarter {
  const def = STARTERS[key];
  const base = baseBody(ctx);
  const body: InvoiceBody = {
    ...base,
    ...def.patch,
    title: def.title,
    accent: def.accent ?? base.accent,
    items: def.items === undefined ? base.items : def.items.map(([desc, qty, rate]) => item(desc, qty, rate)),
  };
  return { card: cardOf(def), body, topic: def.topic, status: def.status ?? 'draft' };
}

/** The comp's `createBlank` (1383): the base with placeholder parties and one empty line. */
export function blankBody(ctx: StarterContext): InvoiceBody {
  return {
    ...baseBody(ctx),
    from: ['Your company', 'Address line', 'email@company.example'],
    customerName: 'Client name',
    customer: ['client@email.example', 'Client address'],
    items: [item('Item description', 1, 0)],
    notes: 'Thank you for your business.',
  };
}
