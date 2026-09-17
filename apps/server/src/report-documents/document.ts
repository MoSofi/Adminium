// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The report document envelope on the server — what one
 * `adminium_report_documents` row's `body` MEANS (the comp's `blk()` /
 * `newBlockContent()` / `fromStarter()`, 474, 536, 494).
 *
 * A DELIBERATE COPY. The dashboard holds the same envelope in its
 * `model/envelope.ts` under `apps/dashboard/src/report-builder`, and the two
 * trees may not import each other (01 2.3: the server never imports the
 * dashboard, the dashboard never imports server runtime code). So the types,
 * the defaults and the normalizing algorithm are restated there field for
 * field, the way `routes/report-documents/schema.ts` restates the reply
 * shapes. Change the two together.
 *
 * ─── NOT the invoice envelope ──────────────────────────────────────────────
 *
 * `apps/server/src/invoices/document.ts` is one FLAT body with a `blockOrder`
 * and eighteen `*Show` flags, where a kind occurs at most once. This one is a
 * header plus an ORDERED ARRAY of self-contained blocks: a kind REPEATS (the
 * KPI scorecard starter has two `kpi` blocks, comp 491), every block carries
 * its own `title`, `w` and `show`, and `show: false` DIMS a block on the
 * canvas — it never removes it and never re-orders. None of the invoice
 * file's ordering arithmetic applies here, and seventeen kinds that share a
 * NAME with an invoice block do not share its fields (trap 3).
 *
 * Three jobs, all pure:
 *
 *   1. {@link reportBodyInputSchema} — the LENIENT wire shape: every field
 *      optional, every string bounded, every list capped, so a `PUT` is
 *      refused only for a size or a type that would make the canvas or the
 *      inspector throw, never for an absent field.
 *   2. {@link normalizeReportBody} — anything (a wire body, a stored row, a
 *      starter patch) becomes the one complete shape: an absent or malformed
 *      value gets its default, every block is completed for its kind, and a
 *      block of an UNKNOWN kind becomes a labelled `text` placeholder rather
 * than vanishing (orphan rule — a decode never renders an empty card the
 *      operator cannot explain).
 * 3. {@link assertBodyWithinCaps} — the two caps set on inline images,
 *   inherited unchanged: one `data:` URI may be {@link IMAGE_DATA_URL_MAX}
 *   characters, the whole serialized body {@link BODY_BYTES_MAX} bytes.
 *   Both refuse with a 422 whose `details.code` names the rule and the
 *   field. This surface has two image slots: the document background (comp
 *   360-367) and the `image` block's own picture.
 *
 * NUMBERS. `series[].value` is a JSON number — it is chart geometry and a
 * float is the right type. `lateDays`, `loyBalance` and `loyEarned` are
 * integers. `lateRate`, `mcAmount` and `fx[].rate` are decimal TEXT: they are
 * a document of record's figures, and a document of record must not drift
 * between a save and a reload. Every KPI value and every `amount` stays the
 * text the operator typed, exactly as the comp holds it.
 */
import { randomBytes } from 'node:crypto';

import { z } from 'zod';

import { ValidationFailedError } from '../errors.js';

// --- the vocabulary -------------------------------------------------------------------

/** The comp's three-value vocabulary, shared by both kinds (`statusMeta` 563). */
export type ReportStatus = 'draft' | 'sent' | 'live';
export const REPORT_STATUSES: readonly ReportStatus[] = ['draft', 'sent', 'live'];

export function isReportStatus(value: unknown): value is ReportStatus {
  return (REPORT_STATUSES as readonly string[]).includes(value as string);
}

/** `template` (a reusable layout) | `report` (a document built from one, or from scratch). */
export type ReportDocumentKind = 'template' | 'report';

/** A block spans the sheet or half of it (comp 303, 668). */
export type BlockWidth = 'full' | 'half';

/** The palette's order (comp `palDefs`, 608) — this array IS the palette. */
export const REPORT_BLOCK_KINDS = [
  'heading',
  'text',
  'kpi',
  'bar',
  'line',
  'table',
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
  'image',
  'divider',
] as const;
export type ReportBlockKind = (typeof REPORT_BLOCK_KINDS)[number];

export function isReportBlockKind(value: unknown): value is ReportBlockKind {
  return (REPORT_BLOCK_KINDS as readonly string[]).includes(value as string);
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type PaymentStatus = 'paid' | 'failed' | 'pending';
export type DeliveryStepStatus = 'todo' | 'current' | 'done';
/** Stored as the comp's English key and LABELLED through the namespace (comp 659). */
export type RecurFrequency = 'Weekly' | 'Monthly' | 'Quarterly' | 'Annually';
export const RECUR_FREQUENCIES: readonly RecurFrequency[] = ['Weekly', 'Monthly', 'Quarterly', 'Annually'];

export interface KpiEntry {
  label: string;
  /** Text as typed — "$482k", "1.9%" (comp 480). */
  value: string;
  /** Text; rendered red when it starts with `−` or `-`, green otherwise (comp 622). */
  delta: string;
}

export interface SeriesPoint {
  label: string;
  /** Chart geometry — a number, the one place a float is right. */
  value: number;
}

/** `[a, b]`; row 0 is the header row (comp 625). */
export type TableRow = [string, string];

export interface AttachmentRef {
  name: string;
  /** Text as the comp types it — "128 KB" (536). */
  size: string;
}

export interface FxRate {
  code: string;
  sym: string;
  /** Decimal text: the multiplier applied to the base amount (comp 618). */
  rate: string;
}

export interface DiscountCode {
  code: string;
  label: string;
  /** Text as typed — "-$29.00" (536). */
  amount: string;
}

export interface TaxLine {
  label: string;
  /** Text as typed — "$28.90" (536). */
  amount: string;
}

export interface PaymentRecord {
  date: string;
  method: string;
  /** Text as typed — "$500.00" (536). */
  amount: string;
  status: PaymentStatus;
}

export interface DeliveryStep {
  label: string;
  status: DeliveryStepStatus;
}

interface BlockCommon {
  id: string;
  title: string;
  w: BlockWidth;
  show: boolean;
}

/**
 * One block. The union IS the vocabulary: a kind and its fields cannot come
 * apart, and the canvas narrows on `kind` rather than reading `unknown`.
 */
export type ReportBlock =
  | (BlockCommon & { kind: 'heading'; text: string })
  | (BlockCommon & { kind: 'text'; text: string })
  | (BlockCommon & { kind: 'kpi'; kpis: KpiEntry[] })
  | (BlockCommon & { kind: 'bar'; series: SeriesPoint[] })
  | (BlockCommon & { kind: 'line'; series: SeriesPoint[] })
  | (BlockCommon & { kind: 'table'; rows: TableRow[] })
  | (BlockCommon & { kind: 'signature'; sigName: string; sigTitle: string })
  | (BlockCommon & { kind: 'terms'; termsLabel: string; termsChecked: boolean })
  | (BlockCommon & { kind: 'attachments'; attachments: AttachmentRef[] })
  | (BlockCommon & { kind: 'approval'; apprName: string; apprTitle: string; apprStatus: ApprovalStatus })
  | (BlockCommon & { kind: 'qr'; qrCaption: string })
  | (BlockCommon & { kind: 'latefees'; lateRate: string; lateDays: number })
  | (BlockCommon & { kind: 'poterms'; poTerms: string })
  | (BlockCommon & { kind: 'multicurrency'; mcAmount: string; fx: FxRate[] })
  | (BlockCommon & { kind: 'recurring'; recurFreq: RecurFrequency; recurNext: string; recurCount: string })
  | (BlockCommon & { kind: 'discount'; discCodes: DiscountCode[] })
  | (BlockCommon & { kind: 'taxbreak'; taxLines: TaxLine[] })
  | (BlockCommon & { kind: 'payhistory'; payHist: PaymentRecord[] })
  | (BlockCommon & { kind: 'legal'; legalText: string })
  | (BlockCommon & { kind: 'refund'; refText: string })
  | (BlockCommon & { kind: 'contact'; conName: string; conEmail: string; conPhone: string })
  | (BlockCommon & { kind: 'loyalty'; loyBalance: number; loyEarned: number; loyLevel: string })
  | (BlockCommon & { kind: 'delivery'; delSteps: DeliveryStep[] })
  | (BlockCommon & { kind: 'image'; text: string; url: string })
  | (BlockCommon & { kind: 'divider' });

/** The document: the header the comp draws above the hairline, plus the stack (comp `fromStarter`, 494). */
export interface ReportBody {
  /** One of the five swatches (633) or a starter's own; `#rrggbb`. */
  accent: string;
  /** Rendered uppercase (295), stored as typed. */
  kicker: string;
  reportTitle: string;
  subtitle: string;
  /** '' or a `data:` URL under {@link IMAGE_DATA_URL_MAX}. */
  bgImage: string;
  /** 0 – 0.95; the white scrim over the background (494, 363). */
  bgTint: number;
  blocks: ReportBlock[];
}

export const DEFAULT_ACCENT = '#4f46e5';
/** The comp's five swatches (633); a starter may carry its own (`health` is `#12805c`). */
export const ACCENT_SWATCHES: readonly string[] = ['#4f46e5', '#0d9488', '#e5484d', '#ea580c', '#111111'];

// --- the caps (inherited)
// -----------------------------------------------------

/** One inline image may be this many characters of data URL (~384 KB of image bytes). */
export const IMAGE_DATA_URL_MAX = 512 * 1024;
/** The whole body, serialized. */
export const BODY_BYTES_MAX = 4 * 1024 * 1024;

export const TEXT_MAX = 4000;
export const LINE_MAX = 300;
export const ROWS_MAX = 100;
/** A sheet of 120 blocks is already past what the canvas can show; past it a save is a mistake. */
export const BLOCKS_MAX = 120;

// --- the wire shape -------------------------------------------------------------------

const text = z.string().max(TEXT_MAX);
const line = z.string().max(LINE_MAX);
/** Inspector fields are text inputs; the comp's own seeds are numbers. Both parse. */
const decimal = z.union([z.string().max(40), z.number()]);
/** An inline `data:` URI — bounded by {@link assertBodyWithinCaps}, not here, so the refusal names the field. */
const image = z.string();

/**
 * What a `PUT` may carry — LENIENT on purpose: every block field optional
 * (the normalizer fills the rest for the kind), every block `passthrough` (a
 * newer editor may add a field an older server does not know), numbers
 * accepted as text. What is refused is a SHAPE that would make the canvas
 * throw — a `blocks` that is not an array, a `kpis` whose rows are strings —
 * and a size past the caps.
 */
const blockInputSchema = z
  .object({
    id: line.optional(),
    kind: line.optional(),
    title: line.optional(),
    w: line.optional(),
    show: z.boolean().optional(),
    text: text.optional(),
    url: image.optional(),
    kpis: z.array(z.object({ label: line.optional(), value: line.optional(), delta: line.optional() }).passthrough()).max(ROWS_MAX).optional(),
    series: z.array(z.object({ label: line.optional(), value: decimal.optional() }).passthrough()).max(ROWS_MAX).optional(),
    rows: z.array(z.array(line).max(8)).max(ROWS_MAX).optional(),
    sigName: line.optional(),
    sigTitle: line.optional(),
    termsLabel: text.optional(),
    termsChecked: z.boolean().optional(),
    attachments: z.array(z.object({ name: line.optional(), size: line.optional() }).passthrough()).max(ROWS_MAX).optional(),
    apprName: line.optional(),
    apprTitle: line.optional(),
    apprStatus: line.optional(),
    qrCaption: line.optional(),
    lateRate: decimal.optional(),
    lateDays: decimal.optional(),
    poTerms: text.optional(),
    mcAmount: decimal.optional(),
    fx: z.array(z.object({ code: line.optional(), sym: line.optional(), rate: decimal.optional() }).passthrough()).max(ROWS_MAX).optional(),
    recurFreq: line.optional(),
    recurNext: line.optional(),
    recurCount: line.optional(),
    discCodes: z.array(z.object({ code: line.optional(), label: line.optional(), amount: line.optional() }).passthrough()).max(ROWS_MAX).optional(),
    taxLines: z.array(z.object({ label: line.optional(), amount: line.optional() }).passthrough()).max(ROWS_MAX).optional(),
    payHist: z
      .array(z.object({ date: line.optional(), method: line.optional(), amount: line.optional(), status: line.optional() }).passthrough())
      .max(ROWS_MAX)
      .optional(),
    legalText: text.optional(),
    refText: text.optional(),
    conName: line.optional(),
    conEmail: line.optional(),
    conPhone: line.optional(),
    loyBalance: decimal.optional(),
    loyEarned: decimal.optional(),
    loyLevel: line.optional(),
    delSteps: z.array(z.object({ label: line.optional(), status: line.optional() }).passthrough()).max(ROWS_MAX).optional(),
  })
  .passthrough();

export const reportBodyInputSchema = z.object({
  accent: line.optional(),
  kicker: line.optional(),
  reportTitle: line.optional(),
  subtitle: line.optional(),
  bgImage: image.optional(),
  bgTint: decimal.optional(),
  blocks: z.array(blockInputSchema).max(BLOCKS_MAX).optional(),
});
export type ReportBodyInput = z.infer<typeof reportBodyInputSchema>;

// --- the reply shape ------------------------------------------------------------------

const widthSchema = z.enum(['full', 'half']);
const commonShape = { id: z.string(), title: z.string(), w: widthSchema, show: z.boolean() };
const kpiSchema = z.object({ label: z.string(), value: z.string(), delta: z.string() });
const seriesSchema = z.object({ label: z.string(), value: z.number() });

/** The reply shape — every field present for its kind, the normalizer's output. */
export const reportBlockSchema = z.discriminatedUnion('kind', [
  z.object({ ...commonShape, kind: z.literal('heading'), text: z.string() }),
  z.object({ ...commonShape, kind: z.literal('text'), text: z.string() }),
  z.object({ ...commonShape, kind: z.literal('kpi'), kpis: z.array(kpiSchema) }),
  z.object({ ...commonShape, kind: z.literal('bar'), series: z.array(seriesSchema) }),
  z.object({ ...commonShape, kind: z.literal('line'), series: z.array(seriesSchema) }),
  z.object({ ...commonShape, kind: z.literal('table'), rows: z.array(z.tuple([z.string(), z.string()])) }),
  z.object({ ...commonShape, kind: z.literal('signature'), sigName: z.string(), sigTitle: z.string() }),
  z.object({ ...commonShape, kind: z.literal('terms'), termsLabel: z.string(), termsChecked: z.boolean() }),
  z.object({ ...commonShape, kind: z.literal('attachments'), attachments: z.array(z.object({ name: z.string(), size: z.string() })) }),
  z.object({
    ...commonShape,
    kind: z.literal('approval'),
    apprName: z.string(),
    apprTitle: z.string(),
    apprStatus: z.enum(['pending', 'approved', 'rejected']),
  }),
  z.object({ ...commonShape, kind: z.literal('qr'), qrCaption: z.string() }),
  z.object({ ...commonShape, kind: z.literal('latefees'), lateRate: z.string(), lateDays: z.number() }),
  z.object({ ...commonShape, kind: z.literal('poterms'), poTerms: z.string() }),
  z.object({
    ...commonShape,
    kind: z.literal('multicurrency'),
    mcAmount: z.string(),
    fx: z.array(z.object({ code: z.string(), sym: z.string(), rate: z.string() })),
  }),
  z.object({
    ...commonShape,
    kind: z.literal('recurring'),
    recurFreq: z.enum(['Weekly', 'Monthly', 'Quarterly', 'Annually']),
    recurNext: z.string(),
    recurCount: z.string(),
  }),
  z.object({
    ...commonShape,
    kind: z.literal('discount'),
    discCodes: z.array(z.object({ code: z.string(), label: z.string(), amount: z.string() })),
  }),
  z.object({ ...commonShape, kind: z.literal('taxbreak'), taxLines: z.array(z.object({ label: z.string(), amount: z.string() })) }),
  z.object({
    ...commonShape,
    kind: z.literal('payhistory'),
    payHist: z.array(
      z.object({ date: z.string(), method: z.string(), amount: z.string(), status: z.enum(['paid', 'failed', 'pending']) }),
    ),
  }),
  z.object({ ...commonShape, kind: z.literal('legal'), legalText: z.string() }),
  z.object({ ...commonShape, kind: z.literal('refund'), refText: z.string() }),
  z.object({ ...commonShape, kind: z.literal('contact'), conName: z.string(), conEmail: z.string(), conPhone: z.string() }),
  z.object({ ...commonShape, kind: z.literal('loyalty'), loyBalance: z.number(), loyEarned: z.number(), loyLevel: z.string() }),
  z.object({
    ...commonShape,
    kind: z.literal('delivery'),
    delSteps: z.array(z.object({ label: z.string(), status: z.enum(['todo', 'current', 'done']) })),
  }),
  z.object({ ...commonShape, kind: z.literal('image'), text: z.string(), url: z.string() }),
  z.object({ ...commonShape, kind: z.literal('divider') }),
]) satisfies z.ZodType<ReportBlock>;

export const reportBodySchema = z.object({
  accent: z.string(),
  kicker: z.string(),
  reportTitle: z.string(),
  subtitle: z.string(),
  bgImage: z.string(),
  bgTint: z.number(),
  blocks: z.array(reportBlockSchema),
}) satisfies z.ZodType<ReportBody>;

// --- defaults + normalizing (the dashboard's algorithm, restated) ---------------------

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

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** A short id for a block — unique within one document (the comp's `blk` + `seq`, 535). */
export function newLocalId(prefix = 'blk'): string {
  return `${prefix}_${randomBytes(5).toString('hex')}`;
}

function kpis(value: unknown): KpiEntry[] {
  return records(value).map((row) => ({ label: str(row['label'], ''), value: str(row['value'], ''), delta: str(row['delta'], '') }));
}

function series(value: unknown): SeriesPoint[] {
  return records(value).map((row) => ({ label: str(row['label'], ''), value: num(row['value'], 0) }));
}

/** Every row is exactly two cells — the canvas draws `a` and `b` and nothing else (comp 625). */
function tableRows(value: unknown): TableRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row): TableRow => [str(row[0], ''), str(row[1], '')]);
}

function approvalStatus(value: unknown): ApprovalStatus {
  return value === 'approved' || value === 'rejected' ? value : 'pending';
}

function paymentStatus(value: unknown): PaymentStatus {
  return value === 'failed' || value === 'pending' ? value : 'paid';
}

function stepStatus(value: unknown): DeliveryStepStatus {
  return value === 'done' || value === 'current' ? value : 'todo';
}

function recurFreq(value: unknown): RecurFrequency {
  return (RECUR_FREQUENCIES as readonly string[]).includes(str(value, '')) ? (value as RecurFrequency) : 'Monthly';
}

/**
 * The sentence a block of an unknown kind is replaced by. English, like every
 * other seed on this row (43 Appendix E's rule: seeds are DATA). It names the
 * kind so an operator can tell a newer version from corruption, and keeps the
 * block's own title — the alternative is a card that renders nothing and
 * cannot be explained.
 */
export function unknownBlockText(kind: string): string {
  return `This block (“${kind}”) was made by a newer version of Adminium and can’t be shown here.`;
}

/** One decoded block, completed for its kind; an unknown kind becomes a labelled `text` placeholder. */
export function normalizeReportBlock(raw: unknown, index: number): ReportBlock {
  const r = isRecord(raw) ? raw : {};
  const common: BlockCommon = {
    id: str(r['id'], '') || `blk_${String(index)}`,
    title: str(r['title'], ''),
    w: r['w'] === 'half' ? 'half' : 'full',
    show: bool(r['show'], true),
  };
  const kind = str(r['kind'], '');
  if (!isReportBlockKind(kind)) return { ...common, kind: 'text', text: unknownBlockText(kind) };
  switch (kind) {
    case 'heading':
    case 'text':
      return { ...common, kind, text: str(r['text'], '') };
    case 'kpi':
      return { ...common, kind, kpis: kpis(r['kpis']) };
    case 'bar':
    case 'line':
      return { ...common, kind, series: series(r['series']) };
    case 'table':
      return { ...common, kind, rows: tableRows(r['rows']) };
    case 'signature':
      return { ...common, kind, sigName: str(r['sigName'], ''), sigTitle: str(r['sigTitle'], '') };
    case 'terms':
      return { ...common, kind, termsLabel: str(r['termsLabel'], ''), termsChecked: bool(r['termsChecked'], false) };
    case 'attachments':
      return {
        ...common,
        kind,
        attachments: records(r['attachments']).map((row) => ({ name: str(row['name'], ''), size: str(row['size'], '') })),
      };
    case 'approval':
      return {
        ...common,
        kind,
        apprName: str(r['apprName'], ''),
        apprTitle: str(r['apprTitle'], ''),
        apprStatus: approvalStatus(r['apprStatus']),
      };
    case 'qr':
      return { ...common, kind, qrCaption: str(r['qrCaption'], '') };
    case 'latefees':
      return { ...common, kind, lateRate: str(r['lateRate'], '0'), lateDays: Math.round(num(r['lateDays'], 0)) };
    case 'poterms':
      return { ...common, kind, poTerms: str(r['poTerms'], '') };
    case 'multicurrency':
      return {
        ...common,
        kind,
        mcAmount: str(r['mcAmount'], '0'),
        fx: records(r['fx']).map((row) => ({ code: str(row['code'], ''), sym: str(row['sym'], ''), rate: str(row['rate'], '1') })),
      };
    case 'recurring':
      return {
        ...common,
        kind,
        recurFreq: recurFreq(r['recurFreq']),
        recurNext: str(r['recurNext'], ''),
        recurCount: str(r['recurCount'], ''),
      };
    case 'discount':
      return {
        ...common,
        kind,
        discCodes: records(r['discCodes']).map((row) => ({
          code: str(row['code'], ''),
          label: str(row['label'], ''),
          amount: str(row['amount'], ''),
        })),
      };
    case 'taxbreak':
      return {
        ...common,
        kind,
        taxLines: records(r['taxLines']).map((row) => ({ label: str(row['label'], ''), amount: str(row['amount'], '') })),
      };
    case 'payhistory':
      return {
        ...common,
        kind,
        payHist: records(r['payHist']).map((row) => ({
          date: str(row['date'], ''),
          method: str(row['method'], ''),
          amount: str(row['amount'], ''),
          status: paymentStatus(row['status']),
        })),
      };
    case 'legal':
      return { ...common, kind, legalText: str(r['legalText'], '') };
    case 'refund':
      return { ...common, kind, refText: str(r['refText'], '') };
    case 'contact':
      return {
        ...common,
        kind,
        conName: str(r['conName'], ''),
        conEmail: str(r['conEmail'], ''),
        conPhone: str(r['conPhone'], ''),
      };
    case 'loyalty':
      return {
        ...common,
        kind,
        loyBalance: Math.round(num(r['loyBalance'], 0)),
        loyEarned: Math.round(num(r['loyEarned'], 0)),
        loyLevel: str(r['loyLevel'], ''),
      };
    case 'delivery':
      return {
        ...common,
        kind,
        delSteps: records(r['delSteps']).map((row) => ({ label: str(row['label'], ''), status: stepStatus(row['status']) })),
      };
    case 'image':
      return { ...common, kind, text: str(r['text'], ''), url: str(r['url'], '') };
    case 'divider':
      return { ...common, kind };
  }
}

/**
 * The STRUCTURAL defaults — every field present, nothing authored. The seeded
 * content a new document starts from is `starters.ts`'s; this is what a
 * decoded row is completed against so an older body never renders
 * `undefined`.
 */
export function emptyBody(): ReportBody {
  return { accent: DEFAULT_ACCENT, kicker: '', reportTitle: '', subtitle: '', bgImage: '', bgTint: 0.82, blocks: [] };
}

/** A row's stored body (or anything on the wire) → the complete envelope. Lenient: an unknown value gets its default. */
export function normalizeReportBody(raw: unknown): ReportBody {
  const base = emptyBody();
  if (!isRecord(raw)) return base;
  const r = raw;
  const accent = str(r['accent'], '');
  const seen = new Set<string>();
  const blocks = (Array.isArray(r['blocks']) ? r['blocks'] : []).slice(0, BLOCKS_MAX).map((block, index) => {
    const decoded = normalizeReportBlock(block, index);
    // Ids address a block for every edit (select, patch, reorder); a duplicate
    // would make two cards move as one. The comp mints from a counter and can
    // never collide; a stored body can.
    if (seen.has(decoded.id)) decoded.id = newLocalId();
    seen.add(decoded.id);
    return decoded;
  });
  return {
    accent: /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : base.accent,
    kicker: str(r['kicker'], ''),
    reportTitle: str(r['reportTitle'], ''),
    subtitle: str(r['subtitle'], ''),
    bgImage: str(r['bgImage'], ''),
    bgTint: Math.min(0.95, Math.max(0, num(r['bgTint'], base.bgTint))),
    blocks,
  };
}

// --- the caps ----------------------------------------------------------------

/** Every inline image in a body, with the field that holds it — the background and each `image` block's picture. */
export function inlineImages(body: ReportBody): { field: string; url: string }[] {
  const out: { field: string; url: string }[] = [{ field: 'bgImage', url: body.bgImage }];
  for (const block of body.blocks) {
    if (block.kind === 'image') out.push({ field: `blocks.${block.id}.url`, url: block.url });
  }
  return out;
}

/**
 * Refuses what a save must not persist, with a 422 whose `details.code` names
 * the rule and `details.field` the slot, so the editor can point at the
 * image. The per-image cap counts characters of a `data:` URI; a plain URL is
 * never that long. The body cap counts the serialized bytes the row would
 * store.
 */
export function assertBodyWithinCaps(body: ReportBody): void {
  for (const { field, url } of inlineImages(body)) {
    if (url.startsWith('data:') && url.length > IMAGE_DATA_URL_MAX) {
      throw new ValidationFailedError(
        `The image in ${field} is ${String(url.length)} characters, over the cap of ${String(IMAGE_DATA_URL_MAX)}.`,
        { code: 'IMAGE_TOO_LARGE', field, length: url.length, cap: IMAGE_DATA_URL_MAX },
      );
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
export function acceptReportBody(raw: unknown): ReportBody {
  const body = normalizeReportBody(raw);
  assertBodyWithinCaps(body);
  return body;
}

/** The stored half of a body, for the repo's open `body` record (the invoice precedent's `bodyColumn`). */
export function bodyColumn(body: ReportBody): Record<string, unknown> {
  return { ...body };
}
