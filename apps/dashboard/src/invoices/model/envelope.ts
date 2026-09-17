// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The invoice document envelope — what one `adminium_invoice_documents` row's
 * `body` MEANS (the comp's `base()`, 1083-1115).
 *
 * ONE SHAPE FOR TEMPLATES AND INVOICES. The comp holds both collections in
 * the same object model (`arrName(kind)`); the row's `kind`, `name`, `status`,
 * `topic` and `lang` are COLUMNS, everything the sheet draws is the body.
 *
 * MONEY IS TEXT HERE. `qty`, `rate` and every percentage are the decimal
 * strings the operator typed, never floats: a document of record must not
 * drift by a cent between a save and a reload, and the comp's own inputs are
 * plain text fields (424-443, 845-846). `model/money.ts` is the one place
 * that turns them into integer minor units.
 *
 * IMAGES ARE INLINE `data:` URIs (the comp's `readImg`, 1324-1328): the five
 * fixed slots (1112) plus one per image section and three per image row, all
 * capped by `IMAGE_DATA_URL_MAX` and, together, by `BODY_BYTES_MAX`.
 */

export type InvoiceDocumentKind = 'template' | 'invoice';

/** The comp's five-value vocabulary, shared by both kinds (1393, 1579). */
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'live' | 'overdue';
export const INVOICE_STATUSES: readonly InvoiceStatus[] = ['draft', 'sent', 'paid', 'live', 'overdue'];

/**
 * The five-topic taxonomy (comp `topics()`, 1173-1180) plus `other` for a row
 * that names none (`topicMeta`, 1182). The first key is `recurring`, not the
 * comp's word: 34 Appendix D.2 renames the key as well as the label, because
 * the key leaks into group anchors and every row's summary.
 */
export type InvoiceTopic = 'recurring' | 'services' | 'receipts' | 'sales' | 'logistics' | 'other';
export const INVOICE_TOPICS: readonly InvoiceTopic[] = ['recurring', 'services', 'receipts', 'sales', 'logistics'];

export function isInvoiceTopic(value: unknown): value is InvoiceTopic {
  return value === 'other' || (INVOICE_TOPICS as readonly string[]).includes(value as string);
}

export function isInvoiceStatus(value: unknown): value is InvoiceStatus {
  return (INVOICE_STATUSES as readonly string[]).includes(value as string);
}

export interface LineItem {
  id: string;
  desc: string;
  /** Decimal text; fractional quantities (hours) are allowed. */
  qty: string;
  /** Decimal text in major units; may be negative (a credit note's lines, comp 1122). */
  rate: string;
}

export interface AttachmentRef {
  name: string;
  /** Free text — "214 KB"; the comp types it (903). */
  size: string;
}

export interface FxRate {
  code: string;
  sym: string;
  /** Decimal text: the multiplier applied to the total (comp 948). */
  rate: string;
}

export interface DiscountCode {
  code: string;
  label: string;
  /** Decimal text in major units. */
  amount: string;
}

export interface TaxLine {
  label: string;
  /** Percent, decimal text. */
  rate: string;
}

export interface PaymentRecord {
  date: string;
  method: string;
  /** Free text as the comp types it (984) — "$500.00". */
  amount: string;
  status: InvoiceStatus;
}

export type DeliveryStepStatus = 'todo' | 'current' | 'done';

export interface DeliveryStep {
  label: string;
  status: DeliveryStepStatus;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

/** The four user-authored section types (comp `customDefs`, 1266-1272; `newCustom`, 1274-1281). */
export type CustomSectionType = 'text' | 'image' | 'kv' | 'gallery';

export interface CustomImageSlot {
  id: string;
  url: string;
}

export interface CustomKvRow {
  k: string;
  v: string;
}

export type CustomSection =
  | { id: string; type: 'text'; title: string; body: string }
  | { id: string; type: 'image'; title: string; url: string; caption: string; height: number }
  | { id: string; type: 'kv'; title: string; rows: CustomKvRow[] }
  | { id: string; type: 'gallery'; title: string; images: CustomImageSlot[] };

/** The image fields the toolbar's Images panel owns (comp 1658). */
export type ImageField = 'logoImage' | 'bgImage' | 'qrImage' | 'sigImage' | 'stampImage';
export const IMAGE_FIELDS: readonly ImageField[] = ['logoImage', 'bgImage', 'qrImage', 'sigImage', 'stampImage'];

/** The string-list fields the inspector's line editors own (comp `mkLines`, 1562). */
export type LineListField = 'from' | 'customer' | 'ship' | 'payment';

/** The object-list fields the inspector's row editors own (comp `updObjList`, 1364). */
export type RowListField = 'attachments' | 'fx' | 'discCodes' | 'taxLines' | 'payHist' | 'delSteps';

export interface InvoiceBody {
  // ── theme (comp 1085) ─────────────────────────────────────────────
  accent: string;
  /** The currency SYMBOL the sheet prints (comp 1578: $ € £ ¥). */
  currency: string;
  cents: boolean;
  title: string;
  logoIcon: string;
  logoText: string;
  // ── parties (1086-1087) ───────────────────────────────────────────
  from: string[];
  customerName: string;
  customer: string[];
  // ── details (1088, 1093) ──────────────────────────────────────────
  number: string;
  issued: string;
  due: string;
  terms: string;
  poNumber: string;
  // ── items & totals (1089-1090) ────────────────────────────────────
  items: LineItem[];
  taxRate: string;
  discountRate: string;
  // ── payment & notes (1091-1092) ───────────────────────────────────
  payment: string[];
  notes: string;
  // ── the eighteen optional sections (1094-1111) ────────────────────
  shipShow: boolean;
  shipName: string;
  ship: string[];
  sigShow: boolean;
  sigName: string;
  sigTitle: string;
  termsShow: boolean;
  termsLabel: string;
  termsChecked: boolean;
  attachShow: boolean;
  attachments: AttachmentRef[];
  approvalShow: boolean;
  apprName: string;
  apprTitle: string;
  apprStatus: ApprovalStatus;
  qrShow: boolean;
  qrCaption: string;
  lateShow: boolean;
  lateRate: string;
  lateDays: number;
  poShow: boolean;
  poTerms: string;
  mcShow: boolean;
  fx: FxRate[];
  recurShow: boolean;
  recurFreq: string;
  recurNext: string;
  recurCount: string;
  discShow: boolean;
  discCodes: DiscountCode[];
  taxbShow: boolean;
  taxLines: TaxLine[];
  payhShow: boolean;
  payHist: PaymentRecord[];
  legalShow: boolean;
  legalText: string;
  refShow: boolean;
  refText: string;
  conShow: boolean;
  conName: string;
  conEmail: string;
  conPhone: string;
  loyShow: boolean;
  loyBalance: number;
  loyEarned: number;
  loyLevel: string;
  delShow: boolean;
  delSteps: DeliveryStep[];
  // ── images (1112) ─────────────────────────────────────────────────
  bgImage: string;
  /** 0–0.95: the scrim over the background image (comp 797, 1733). */
  bgTint: number;
  logoImage: string;
  qrImage: string;
  sigImage: string;
  stampImage: string;
  // ── composition (1113-1114) ───────────────────────────────────────
  custom: CustomSection[];
  /** The 23 built-in keys plus any `cus:<id>` keys, in sheet order. */
  blockOrder: string[];
}

/** The comp's `blockOrder` default (1114): every built-in, in this order. */
export const DEFAULT_BLOCK_ORDER: readonly string[] = [
  'parties',
  'shipping',
  'meta',
  'items',
  'totals',
  'paynotes',
  'signature',
  'terms',
  'attachments',
  'approval',
  'qr',
  'latefees',
  'poterms',
  'multicurrency',
  'recurring',
  'discount',
  'taxbreak',
  'payhistory',
  'legal',
  'refund',
  'contact',
  'loyalty',
  'delivery',
];

/** The comp's five accent swatches (1577). */
export const ACCENT_SWATCHES: readonly string[] = ['#4f46e5', '#0d9488', '#e5484d', '#ea580c', '#111111'];
export const DEFAULT_ACCENT = '#4f46e5';

/** The comp's four currencies (1578): symbol → picker label. */
export const CURRENCIES: readonly { sym: string; label: string }[] = [
  { sym: '$', label: 'USD $' },
  { sym: '€', label: 'EUR €' },
  { sym: '£', label: 'GBP £' },
  { sym: '¥', label: 'JPY ¥' },
];

/** The twelve logo marks (comp 1580). */
export const LOGO_MARKS: readonly string[] = ['hexagon', 'circle', 'square', 'triangle', 'gem', 'zap', 'flame', 'leaf', 'star', 'heart', 'command', 'box'];

/** The comp's recurring frequencies (1726). */
export const RECURRING_FREQUENCIES: readonly string[] = ['Weekly', 'Monthly', 'Quarterly', 'Annually'];

/** One inline image may be this many characters of data URL (~384 KB of image bytes). */
export const IMAGE_DATA_URL_MAX = 512 * 1024;
/** The whole body, serialized. */
export const BODY_BYTES_MAX = 4 * 1024 * 1024;

/**
 * The STRUCTURAL defaults — every field present, nothing authored. The seeded
 * content a new document starts from (the comp's `base()` re-themed under
 * 34 Appendix D.2) is the server's (`apps/server/src/invoices/starters.ts`);
 * this is what a decoded row is completed against so an older body never
 * renders `undefined`.
 */
export function emptyBody(): InvoiceBody {
  return {
    accent: DEFAULT_ACCENT,
    currency: '$',
    cents: true,
    title: 'INVOICE',
    logoIcon: 'hexagon',
    logoText: '',
    from: [],
    customerName: '',
    customer: [],
    number: '',
    issued: '',
    due: '',
    terms: '',
    poNumber: '',
    items: [],
    taxRate: '0',
    discountRate: '0',
    payment: [],
    notes: '',
    shipShow: false,
    shipName: '',
    ship: [],
    sigShow: false,
    sigName: '',
    sigTitle: '',
    termsShow: false,
    termsLabel: '',
    termsChecked: false,
    attachShow: false,
    attachments: [],
    approvalShow: false,
    apprName: '',
    apprTitle: '',
    apprStatus: 'pending',
    qrShow: false,
    qrCaption: '',
    lateShow: false,
    lateRate: '1.5',
    lateDays: 7,
    poShow: false,
    poTerms: '',
    mcShow: false,
    fx: [],
    recurShow: false,
    recurFreq: 'Monthly',
    recurNext: '',
    recurCount: '',
    discShow: false,
    discCodes: [],
    taxbShow: false,
    taxLines: [],
    payhShow: false,
    payHist: [],
    legalShow: false,
    legalText: '',
    refShow: false,
    refText: '',
    conShow: false,
    conName: '',
    conEmail: '',
    conPhone: '',
    loyShow: false,
    loyBalance: 0,
    loyEarned: 0,
    loyLevel: '',
    delShow: false,
    delSteps: [],
    bgImage: '',
    bgTint: 0.82,
    logoImage: '',
    qrImage: '',
    sigImage: '',
    stampImage: '',
    custom: [],
    blockOrder: [...DEFAULT_BLOCK_ORDER],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => str(item, '')) : [];
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** A short id for an item, a custom section or a gallery slot — unique within one document. */
export function newLocalId(prefix: string): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return `${prefix}_${out}`;
}

function customSection(raw: Record<string, unknown>): CustomSection | null {
  const id = str(raw['id'], '');
  if (id === '') return null;
  const title = str(raw['title'], '');
  switch (raw['type']) {
    case 'text':
      return { id, type: 'text', title, body: str(raw['body'], '') };
    case 'image':
      return { id, type: 'image', title, url: str(raw['url'], ''), caption: str(raw['caption'], ''), height: Math.round(num(raw['height'], 200)) };
    case 'kv':
      return { id, type: 'kv', title, rows: records(raw['rows']).map((row) => ({ k: str(row['k'], ''), v: str(row['v'], '') })) };
    case 'gallery':
      return {
        id,
        type: 'gallery',
        title,
        images: records(raw['images']).map((image, index) => ({ id: str(image['id'], `${id}${String(index)}`), url: str(image['url'], '') })),
      };
    default:
      return null;
  }
}

/**
 * The composition, reconciled (orphan rule): every built-in key exactly
 * once, `cus:` keys only for sections that exist, and every existing section
 * referenced — an unreferenced one is appended rather than lost. The comp
 * renders an orphan key as an empty draggable block (1512); a decode here
 * never does.
 */
export function reconcileBlockOrder(order: readonly string[], custom: readonly CustomSection[]): string[] {
  const customKeys = new Set(custom.map((section) => `cus:${section.id}`));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of order) {
    if (seen.has(key)) continue;
    const builtin = DEFAULT_BLOCK_ORDER.includes(key);
    if (!builtin && !customKeys.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  for (const key of DEFAULT_BLOCK_ORDER) {
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  for (const key of customKeys) {
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/** A row's stored body (or anything on the wire) → the complete envelope. Lenient: an unknown value gets its default. */
export function normalizeBody(raw: unknown): InvoiceBody {
  const base = emptyBody();
  if (!isRecord(raw)) return base;
  const r = raw;
  const status = (value: unknown): InvoiceStatus => (isInvoiceStatus(value) ? value : 'paid');
  const custom = records(r['custom']).map(customSection).filter((section): section is CustomSection => section !== null);
  const bgTint = num(r['bgTint'], base.bgTint);
  return {
    accent: /^#[0-9a-fA-F]{6}$/.test(str(r['accent'], '')) ? str(r['accent'], '') : base.accent,
    currency: str(r['currency'], base.currency) || base.currency,
    cents: bool(r['cents'], base.cents),
    title: str(r['title'], base.title),
    logoIcon: str(r['logoIcon'], base.logoIcon) || base.logoIcon,
    logoText: str(r['logoText'], ''),
    from: strings(r['from']),
    customerName: str(r['customerName'], ''),
    customer: strings(r['customer']),
    number: str(r['number'], ''),
    issued: str(r['issued'], ''),
    due: str(r['due'], ''),
    terms: str(r['terms'], ''),
    poNumber: str(r['poNumber'], ''),
    items: records(r['items']).map((item, index) => ({
      id: str(item['id'], '') || `i_${String(index)}`,
      desc: str(item['desc'], ''),
      qty: str(item['qty'], '1'),
      rate: str(item['rate'], '0'),
    })),
    taxRate: str(r['taxRate'], base.taxRate),
    discountRate: str(r['discountRate'], base.discountRate),
    payment: strings(r['payment']),
    notes: str(r['notes'], ''),
    shipShow: bool(r['shipShow'], false),
    shipName: str(r['shipName'], ''),
    ship: strings(r['ship']),
    sigShow: bool(r['sigShow'], false),
    sigName: str(r['sigName'], ''),
    sigTitle: str(r['sigTitle'], ''),
    termsShow: bool(r['termsShow'], false),
    termsLabel: str(r['termsLabel'], ''),
    termsChecked: bool(r['termsChecked'], false),
    attachShow: bool(r['attachShow'], false),
    attachments: records(r['attachments']).map((file) => ({ name: str(file['name'], ''), size: str(file['size'], '') })),
    approvalShow: bool(r['approvalShow'], false),
    apprName: str(r['apprName'], ''),
    apprTitle: str(r['apprTitle'], ''),
    apprStatus: r['apprStatus'] === 'approved' || r['apprStatus'] === 'rejected' ? r['apprStatus'] : 'pending',
    qrShow: bool(r['qrShow'], false),
    qrCaption: str(r['qrCaption'], ''),
    lateShow: bool(r['lateShow'], false),
    lateRate: str(r['lateRate'], base.lateRate),
    lateDays: Math.round(num(r['lateDays'], base.lateDays)),
    poShow: bool(r['poShow'], false),
    poTerms: str(r['poTerms'], ''),
    mcShow: bool(r['mcShow'], false),
    fx: records(r['fx']).map((row) => ({ code: str(row['code'], ''), sym: str(row['sym'], ''), rate: str(row['rate'], '1') })),
    recurShow: bool(r['recurShow'], false),
    recurFreq: str(r['recurFreq'], base.recurFreq),
    recurNext: str(r['recurNext'], ''),
    recurCount: str(r['recurCount'], ''),
    discShow: bool(r['discShow'], false),
    discCodes: records(r['discCodes']).map((row) => ({ code: str(row['code'], ''), label: str(row['label'], ''), amount: str(row['amount'], '0') })),
    taxbShow: bool(r['taxbShow'], false),
    taxLines: records(r['taxLines']).map((row) => ({ label: str(row['label'], ''), rate: str(row['rate'], '0') })),
    payhShow: bool(r['payhShow'], false),
    payHist: records(r['payHist']).map((row) => ({
      date: str(row['date'], ''),
      method: str(row['method'], ''),
      amount: str(row['amount'], ''),
      status: status(row['status']),
    })),
    legalShow: bool(r['legalShow'], false),
    legalText: str(r['legalText'], ''),
    refShow: bool(r['refShow'], false),
    refText: str(r['refText'], ''),
    conShow: bool(r['conShow'], false),
    conName: str(r['conName'], ''),
    conEmail: str(r['conEmail'], ''),
    conPhone: str(r['conPhone'], ''),
    loyShow: bool(r['loyShow'], false),
    loyBalance: Math.round(num(r['loyBalance'], 0)),
    loyEarned: Math.round(num(r['loyEarned'], 0)),
    loyLevel: str(r['loyLevel'], ''),
    delShow: bool(r['delShow'], false),
    delSteps: records(r['delSteps']).map((row) => ({
      label: str(row['label'], ''),
      status: row['status'] === 'done' || row['status'] === 'current' ? row['status'] : 'todo',
    })),
    bgImage: str(r['bgImage'], ''),
    bgTint: Math.min(0.95, Math.max(0, bgTint)),
    logoImage: str(r['logoImage'], ''),
    qrImage: str(r['qrImage'], ''),
    sigImage: str(r['sigImage'], ''),
    stampImage: str(r['stampImage'], ''),
    custom,
    blockOrder: reconcileBlockOrder(strings(r['blockOrder']).length === 0 ? DEFAULT_BLOCK_ORDER : strings(r['blockOrder']), custom),
  };
}
