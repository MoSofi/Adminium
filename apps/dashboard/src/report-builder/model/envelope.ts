// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The report document envelope in the dashboard (the comp's `blk()` /
 * `newBlockContent()` / `fromStarter()`, 474, 536, 494).
 *
 * A DELIBERATE COPY of `apps/server/src/report-documents/document.ts`. The
 * two trees may not import each other (01 2.3), so the types and the
 * normalizing algorithm are restated here field for field. Change the two
 * together; the server file carries the same note.
 *
 * NOT the invoice envelope. `src/invoices/model/envelope.ts` is one FLAT body
 * with a `blockOrder` and eighteen `*Show` flags, where a kind occurs at most
 * once. This one is a header plus an ORDERED ARRAY of self-contained blocks:
 * a kind REPEATS, every block carries its own `title`, `w` and `show`, and
 * `show: false` DIMS a block — it never removes it and never re-orders. None
 * of `invoices/model/ops.ts`'s pre-filter-index arithmetic applies here
 * (trap 2).
 */

/** The comp's three-value vocabulary, shared by both kinds (`statusMeta` 563). */
export type ReportStatus = 'draft' | 'sent' | 'live';
export const REPORT_STATUSES: readonly ReportStatus[] = ['draft', 'sent', 'live'];

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
  /** Text as typed — "$482k", "1.9%". */
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
  /** Text as the comp types it — "128 KB". */
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
  amount: string;
}

export interface TaxLine {
  label: string;
  amount: string;
}

export interface PaymentRecord {
  date: string;
  method: string;
  amount: string;
  status: PaymentStatus;
}

export interface DeliveryStep {
  label: string;
  status: DeliveryStepStatus;
}

export interface BlockCommon {
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

/** One block of a given kind — `BlockOf<'kpi'>` is the KPI member of the union. */
export type BlockOf<K extends ReportBlockKind> = Extract<ReportBlock, { kind: K }>;

/** The document: the header the comp draws above the hairline, plus the stack (comp 494). */
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

/** The two caps, inherited unchanged (puts the second image behind the same
 * one). */
export const IMAGE_DATA_URL_MAX = 512 * 1024;
export const BODY_BYTES_MAX = 4 * 1024 * 1024;
/** The comp's slider range (363): 0 – 95 %. */
export const BG_TINT_MAX = 0.95;

// --- decoding -------------------------------------------------------------------------

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
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** The server's `unknownBlockText`, restated: a block a newer server wrote is LABELLED, never blank. */
export function unknownBlockText(kind: string): string {
  return `This block (“${kind}”) was made by a newer version of Adminium and can’t be shown here.`;
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
      return {
        ...common,
        kind,
        kpis: records(r['kpis']).map((row) => ({ label: str(row['label'], ''), value: str(row['value'], ''), delta: str(row['delta'], '') })),
      };
    case 'bar':
    case 'line':
      return { ...common, kind, series: records(r['series']).map((row) => ({ label: str(row['label'], ''), value: num(row['value'], 0) })) };
    case 'table':
      return {
        ...common,
        kind,
        rows: (Array.isArray(r['rows']) ? r['rows'] : [])
          .filter((row): row is unknown[] => Array.isArray(row))
          .map((row): TableRow => [str(row[0], ''), str(row[1], '')]),
      };
    case 'signature':
      return { ...common, kind, sigName: str(r['sigName'], ''), sigTitle: str(r['sigTitle'], '') };
    case 'terms':
      return { ...common, kind, termsLabel: str(r['termsLabel'], ''), termsChecked: bool(r['termsChecked'], false) };
    case 'attachments':
      return { ...common, kind, attachments: records(r['attachments']).map((row) => ({ name: str(row['name'], ''), size: str(row['size'], '') })) };
    case 'approval':
      return { ...common, kind, apprName: str(r['apprName'], ''), apprTitle: str(r['apprTitle'], ''), apprStatus: approvalStatus(r['apprStatus']) };
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
      return { ...common, kind, recurFreq: recurFreq(r['recurFreq']), recurNext: str(r['recurNext'], ''), recurCount: str(r['recurCount'], '') };
    case 'discount':
      return {
        ...common,
        kind,
        discCodes: records(r['discCodes']).map((row) => ({ code: str(row['code'], ''), label: str(row['label'], ''), amount: str(row['amount'], '') })),
      };
    case 'taxbreak':
      return { ...common, kind, taxLines: records(r['taxLines']).map((row) => ({ label: str(row['label'], ''), amount: str(row['amount'], '') })) };
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
      return { ...common, kind, conName: str(r['conName'], ''), conEmail: str(r['conEmail'], ''), conPhone: str(r['conPhone'], '') };
    case 'loyalty':
      return {
        ...common,
        kind,
        loyBalance: Math.round(num(r['loyBalance'], 0)),
        loyEarned: Math.round(num(r['loyEarned'], 0)),
        loyLevel: str(r['loyLevel'], ''),
      };
    case 'delivery':
      return { ...common, kind, delSteps: records(r['delSteps']).map((row) => ({ label: str(row['label'], ''), status: stepStatus(row['status']) })) };
    case 'image':
      return { ...common, kind, text: str(r['text'], ''), url: str(r['url'], '') };
    case 'divider':
      return { ...common, kind };
  }
}

/** The STRUCTURAL defaults — every field present, nothing authored. */
export function emptyBody(): ReportBody {
  return { accent: DEFAULT_ACCENT, kicker: '', reportTitle: '', subtitle: '', bgImage: '', bgTint: 0.82, blocks: [] };
}

/** Anything (a detail reply, a stored row) → the complete envelope. Lenient: an unknown value gets its default. */
export function normalizeReportBody(raw: unknown): ReportBody {
  const base = emptyBody();
  if (!isRecord(raw)) return base;
  const r = raw;
  const accent = str(r['accent'], '');
  const seen = new Set<string>();
  const blocks = (Array.isArray(r['blocks']) ? r['blocks'] : []).map((block, index) => {
    const decoded = normalizeReportBlock(block, index);
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
    bgTint: Math.min(BG_TINT_MAX, Math.max(0, num(r['bgTint'], base.bgTint))),
    blocks,
  };
}
