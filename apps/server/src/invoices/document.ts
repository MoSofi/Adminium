// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The invoice document envelope on the server — what one
 * `adminium_invoice_documents` row's `body` MEANS (the comp's `base()`,
 * 1083-1115).
 *
 * A DELIBERATE COPY. The dashboard holds the same envelope in its
 * `model/envelope.ts` under `apps/dashboard/src/invoices`, and the two trees
 * may not import each other (01 2.3: the server never imports the dashboard,
 * the dashboard never imports server runtime code). So the type, the
 * defaults, `reconcileBlockOrder` and the normalizing algorithm are restated
 * here field-for-field, the way `routes/invoices/schema.ts` restates the
 * reply shapes. Change the two together.
 *
 * Three jobs, all pure:
 *
 *   1. {@link invoiceBodyInputSchema} — the LENIENT wire shape: every field
 *      optional, every string bounded, every list capped, so a `PUT` is
 *      refused only for a size or a type that would make the sheet or the
 *      inspector throw, never for an absent field.
 *   2. {@link normalizeInvoiceBody} — anything (a wire body, a stored row, a
 *      starter patch) becomes the one complete shape: an absent or malformed
 *      value gets its default, `blockOrder` is reconciled, an older body never
 *      renders `undefined`.
 * 3. {@link assertBodyWithinCaps} — the two caps set on inline images: one
 *   `data:` URI may be {@link IMAGE_DATA_URL_MAX} characters, the whole
 *   serialized body {@link BODY_BYTES_MAX} bytes. Both refuse with a 422
 *   whose `details.code` names the rule and the field.
 *
 * MONEY IS TEXT HERE. `qty`, `rate` and every percentage are the decimal
 * strings the operator typed, never floats; `money.ts` beside this file is
 * the one place that turns them into integer minor units.
 */
import { randomBytes } from 'node:crypto';

import { z } from 'zod';

import { ValidationFailedError } from '../errors.js';

// --- the vocabulary -------------------------------------------------------------------

/** The comp's five-value vocabulary, shared by both kinds (1393, 1579). */
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'live' | 'overdue';
export const INVOICE_STATUSES: readonly InvoiceStatus[] = ['draft', 'sent', 'paid', 'live', 'overdue'];

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
  /** Text as the comp types it — "214 KB" (903). */
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
  /** Text as the comp types it (984) — "$500.00". */
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

export const DEFAULT_ACCENT = '#4f46e5';

// --- the caps ----------------------------------------------------------------

/** One inline image may be this many characters of data URL (~384 KB of image bytes). */
export const IMAGE_DATA_URL_MAX = 512 * 1024;
/** The whole body, serialized. */
export const BODY_BYTES_MAX = 4 * 1024 * 1024;

export const TEXT_MAX = 4000;
export const LINE_MAX = 300;
export const ROWS_MAX = 100;
export const CUSTOM_MAX = 60;
export const BLOCK_ORDER_MAX = 120;

// --- the wire shape -------------------------------------------------------------------

const text = z.string().max(TEXT_MAX);
const line = z.string().max(LINE_MAX);
const lines = z.array(line).max(ROWS_MAX);
/** Inspector fields are text inputs; the comp's own seeds are numbers. Both parse. */
const decimal = z.union([z.string().max(40), z.number()]);
/** An inline `data:` URI — bounded by {@link assertBodyWithinCaps}, not here, so the refusal names the field. */
const image = z.string();
const loose = z.object({}).passthrough();
const rowsOf = <T extends z.ZodRawShape>(shape: T) => z.array(z.object(shape).passthrough()).max(ROWS_MAX);

/**
 * What a `PUT` may carry — LENIENT on purpose: every field optional (the
 * normalizer fills the rest), every object `passthrough` (a newer editor may
 * add a field an older server does not know), numbers accepted as text.
 * What is refused is a SHAPE that would make the sheet throw — an `items`
 * that is not an array, a `from` whose lines are objects — and a size past
 * the caps.
 */
export const invoiceBodyInputSchema = z.object({
  accent: line.optional(),
  currency: line.optional(),
  cents: z.boolean().optional(),
  title: line.optional(),
  logoIcon: line.optional(),
  logoText: line.optional(),
  from: lines.optional(),
  customerName: line.optional(),
  customer: lines.optional(),
  number: line.optional(),
  issued: line.optional(),
  due: line.optional(),
  terms: line.optional(),
  poNumber: line.optional(),
  items: rowsOf({ id: line.optional(), desc: text.optional(), qty: decimal.optional(), rate: decimal.optional() }).optional(),
  taxRate: decimal.optional(),
  discountRate: decimal.optional(),
  payment: lines.optional(),
  notes: text.optional(),
  shipShow: z.boolean().optional(),
  shipName: line.optional(),
  ship: lines.optional(),
  sigShow: z.boolean().optional(),
  sigName: line.optional(),
  sigTitle: line.optional(),
  termsShow: z.boolean().optional(),
  termsLabel: text.optional(),
  termsChecked: z.boolean().optional(),
  attachShow: z.boolean().optional(),
  attachments: rowsOf({ name: line.optional(), size: line.optional() }).optional(),
  approvalShow: z.boolean().optional(),
  apprName: line.optional(),
  apprTitle: line.optional(),
  apprStatus: line.optional(),
  qrShow: z.boolean().optional(),
  qrCaption: line.optional(),
  lateShow: z.boolean().optional(),
  lateRate: decimal.optional(),
  lateDays: decimal.optional(),
  poShow: z.boolean().optional(),
  poTerms: text.optional(),
  mcShow: z.boolean().optional(),
  fx: rowsOf({ code: line.optional(), sym: line.optional(), rate: decimal.optional() }).optional(),
  recurShow: z.boolean().optional(),
  recurFreq: line.optional(),
  recurNext: line.optional(),
  recurCount: line.optional(),
  discShow: z.boolean().optional(),
  discCodes: rowsOf({ code: line.optional(), label: line.optional(), amount: decimal.optional() }).optional(),
  taxbShow: z.boolean().optional(),
  taxLines: rowsOf({ label: line.optional(), rate: decimal.optional() }).optional(),
  payhShow: z.boolean().optional(),
  payHist: rowsOf({ date: line.optional(), method: line.optional(), amount: line.optional(), status: line.optional() }).optional(),
  legalShow: z.boolean().optional(),
  legalText: text.optional(),
  refShow: z.boolean().optional(),
  refText: text.optional(),
  conShow: z.boolean().optional(),
  conName: line.optional(),
  conEmail: line.optional(),
  conPhone: line.optional(),
  loyShow: z.boolean().optional(),
  loyBalance: decimal.optional(),
  loyEarned: decimal.optional(),
  loyLevel: line.optional(),
  delShow: z.boolean().optional(),
  delSteps: rowsOf({ label: line.optional(), status: line.optional() }).optional(),
  bgImage: image.optional(),
  bgTint: decimal.optional(),
  logoImage: image.optional(),
  qrImage: image.optional(),
  sigImage: image.optional(),
  stampImage: image.optional(),
  custom: z.array(loose).max(CUSTOM_MAX).optional(),
  blockOrder: z.array(z.string().max(80)).max(BLOCK_ORDER_MAX).optional(),
});
export type InvoiceBodyInput = z.infer<typeof invoiceBodyInputSchema>;

// --- the reply shape ------------------------------------------------------------------

const invoiceStatusSchema = z.enum(['draft', 'sent', 'paid', 'live', 'overdue']);

const customSectionSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string(), type: z.literal('text'), title: z.string(), body: z.string() }),
  z.object({ id: z.string(), type: z.literal('image'), title: z.string(), url: z.string(), caption: z.string(), height: z.number() }),
  z.object({ id: z.string(), type: z.literal('kv'), title: z.string(), rows: z.array(z.object({ k: z.string(), v: z.string() })) }),
  z.object({ id: z.string(), type: z.literal('gallery'), title: z.string(), images: z.array(z.object({ id: z.string(), url: z.string() })) }),
]);

/** The reply shape — every field present, the normalizer's output. */
export const invoiceBodySchema = z.object({
  accent: z.string(),
  currency: z.string(),
  cents: z.boolean(),
  title: z.string(),
  logoIcon: z.string(),
  logoText: z.string(),
  from: z.array(z.string()),
  customerName: z.string(),
  customer: z.array(z.string()),
  number: z.string(),
  issued: z.string(),
  due: z.string(),
  terms: z.string(),
  poNumber: z.string(),
  items: z.array(z.object({ id: z.string(), desc: z.string(), qty: z.string(), rate: z.string() })),
  taxRate: z.string(),
  discountRate: z.string(),
  payment: z.array(z.string()),
  notes: z.string(),
  shipShow: z.boolean(),
  shipName: z.string(),
  ship: z.array(z.string()),
  sigShow: z.boolean(),
  sigName: z.string(),
  sigTitle: z.string(),
  termsShow: z.boolean(),
  termsLabel: z.string(),
  termsChecked: z.boolean(),
  attachShow: z.boolean(),
  attachments: z.array(z.object({ name: z.string(), size: z.string() })),
  approvalShow: z.boolean(),
  apprName: z.string(),
  apprTitle: z.string(),
  apprStatus: z.enum(['pending', 'approved', 'rejected']),
  qrShow: z.boolean(),
  qrCaption: z.string(),
  lateShow: z.boolean(),
  lateRate: z.string(),
  lateDays: z.number(),
  poShow: z.boolean(),
  poTerms: z.string(),
  mcShow: z.boolean(),
  fx: z.array(z.object({ code: z.string(), sym: z.string(), rate: z.string() })),
  recurShow: z.boolean(),
  recurFreq: z.string(),
  recurNext: z.string(),
  recurCount: z.string(),
  discShow: z.boolean(),
  discCodes: z.array(z.object({ code: z.string(), label: z.string(), amount: z.string() })),
  taxbShow: z.boolean(),
  taxLines: z.array(z.object({ label: z.string(), rate: z.string() })),
  payhShow: z.boolean(),
  payHist: z.array(z.object({ date: z.string(), method: z.string(), amount: z.string(), status: invoiceStatusSchema })),
  legalShow: z.boolean(),
  legalText: z.string(),
  refShow: z.boolean(),
  refText: z.string(),
  conShow: z.boolean(),
  conName: z.string(),
  conEmail: z.string(),
  conPhone: z.string(),
  loyShow: z.boolean(),
  loyBalance: z.number(),
  loyEarned: z.number(),
  loyLevel: z.string(),
  delShow: z.boolean(),
  delSteps: z.array(z.object({ label: z.string(), status: z.enum(['todo', 'current', 'done']) })),
  bgImage: z.string(),
  bgTint: z.number(),
  logoImage: z.string(),
  qrImage: z.string(),
  sigImage: z.string(),
  stampImage: z.string(),
  custom: z.array(customSectionSchema),
  blockOrder: z.array(z.string()),
}) satisfies z.ZodType<InvoiceBody>;

// --- defaults + normalizing (the dashboard's algorithm, restated) ---------------------

/**
 * The STRUCTURAL defaults — every field present, nothing authored. The seeded
 * content a new document starts from is `starters.ts`'s; this is what a
 * decoded row is completed against so an older body never renders
 * `undefined`.
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
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))
      ? Number(value)
      : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => str(item, '')) : [];
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** A short id for an item, a custom section or a gallery slot — unique within one document. */
export function newLocalId(prefix: string): string {
  return `${prefix}_${randomBytes(5).toString('hex')}`;
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
export function normalizeInvoiceBody(raw: unknown): InvoiceBody {
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

// --- the caps ----------------------------------------------------------------

/** Every inline image in a body, with the field that holds it — the five slots plus the custom sections'. */
export function inlineImages(body: InvoiceBody): { field: string; url: string }[] {
  const out: { field: string; url: string }[] = [];
  for (const field of IMAGE_FIELDS) out.push({ field, url: body[field] });
  for (const section of body.custom) {
    if (section.type === 'image') out.push({ field: `custom.${section.id}.url`, url: section.url });
    if (section.type === 'gallery') {
      for (const image of section.images) out.push({ field: `custom.${section.id}.images.${image.id}`, url: image.url });
    }
  }
  return out;
}

/**
 * Refuses what a save must not persist, with a 422 whose `details.code`
 * names the rule and `details.field` the slot, so the editor can point at
 * the image. The per-image cap counts characters of a `data:` URI; a plain
 * URL is never that long. The body cap counts the serialized bytes the row
 * would store.
 */
export function assertBodyWithinCaps(body: InvoiceBody): void {
  for (const { field, url } of inlineImages(body)) {
    if (url.startsWith('data:') && url.length > IMAGE_DATA_URL_MAX) {
      throw new ValidationFailedError(`The image in ${field} is ${String(url.length)} characters, over the cap of ${String(IMAGE_DATA_URL_MAX)}.`, {
        code: 'IMAGE_TOO_LARGE',
        field,
        length: url.length,
        cap: IMAGE_DATA_URL_MAX,
      });
    }
  }
  const bytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
  if (bytes > BODY_BYTES_MAX) {
    throw new ValidationFailedError(`The document is ${String(bytes)} bytes, over the cap of ${String(BODY_BYTES_MAX)}.`, {
      code: 'BODY_TOO_LARGE',
      bytes,
      cap: BODY_BYTES_MAX,
    });
  }
}

/** Normalize a wire body and hold it to the caps — the one door a `PUT` goes through. */
export function acceptInvoiceBody(raw: unknown): InvoiceBody {
  const body = normalizeInvoiceBody(raw);
  assertBodyWithinCaps(body);
  return body;
}

/** The stored half of a body, for the repo's open `body` record (the email precedent's `documentColumns`). */
export function bodyColumn(body: InvoiceBody): Record<string, unknown> {
  return { ...body };
}
