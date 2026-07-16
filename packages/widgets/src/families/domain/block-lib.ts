/**
 * TRACK BUILDER — pure helpers behind `document-canvas` and the 22 `block-*`
 * document-vocabulary widgets (annex §13).
 *
 * JSX-free and DOM-free on purpose: money recomputation, payload projection and
 * the reorder algebra are all pure functions of their inputs, so they are
 * golden-testable and `blocks-config.ts` can import them for `demoData` without
 * dragging component code into the eager registry chunk (04 §2.3).
 *
 * MONEY + DATES go through the `@adminium/i18n` Intl layer (10 §4). `getFormatters`
 * already applies the data-context numeral policy (latn digits + gregorian for
 * mono cells), so callers never pass a `-u-nu-latn` tag themselves.
 *
 * TOTALS ARE DERIVED, NEVER STORED — the annex's canvas "live-recomputing
 * totals" is `computeTotals` below: `block-totals-summary`, `block-tax-breakdown`
 * and `block-qr-pay` all recompute from the same items + rates, so a canvas edit
 * can never desync one block's arithmetic from another's.
 */
import { getFormatters } from '@adminium/i18n';

import { asRecord, numberField, resolveLocale, stringField } from './domain-lib.js';
import type {
  BlockTwoColRow,
  CategoricalData,
  DocBlockInstance,
  DocLineItem,
  DocRates,
  DocRecord,
  DocTotals,
  DocType,
  RowData,
  RowsData,
} from './block-types.js';

// --- the block vocabulary -----------------------------------------------------

/**
 * The 22 `block-*` registry ids, in annex §13 bullet order. `document-canvas`
 * validates `blockOrder[]` against this set, so a doc row carrying a typo'd or
 * hostile block id renders nothing rather than resolving an arbitrary widget.
 */
export const BLOCK_IDS = [
  'block-totals-summary',
  'block-line-items',
  'block-kpi-row',
  'block-bar-chart',
  'block-line-chart',
  'block-two-col-table',
  'block-tax-breakdown',
  'block-multi-currency',
  'block-payment-history',
  'block-discount-codes',
  'block-loyalty-banner',
  'block-recurring-banner',
  'block-qr-pay',
  'block-delivery-stepper',
  'block-signature',
  'block-terms-checkbox',
  'block-approval',
  'block-attachments',
  'block-late-fees',
  'block-image-placeholder',
  'block-contact',
  'block-highlight-box',
] as const;

export type BlockId = (typeof BLOCK_IDS)[number];

const BLOCK_ID_SET: ReadonlySet<string> = new Set(BLOCK_IDS);

/** Is this an annex §13 document-block id? */
export function isBlockId(value: unknown): value is BlockId {
  return typeof value === 'string' && BLOCK_ID_SET.has(value);
}

export const DOC_TYPES = ['invoice', 'report', 'email'] as const;

/**
 * The blocks each document surface starts with (annex §13 evidence column —
 * which comp each block is cited from). `document-canvas` falls back to these
 * when a doc row carries no `blockOrder[]`, which is what makes a freshly
 * seeded doc render something useful instead of an empty page.
 */
export const DOC_TYPE_BLOCKS: Readonly<Record<DocType, readonly BlockId[]>> = {
  invoice: [
    'block-line-items',
    'block-tax-breakdown',
    'block-totals-summary',
    'block-payment-history',
    'block-qr-pay',
    'block-recurring-banner',
  ],
  report: [
    'block-kpi-row',
    'block-bar-chart',
    'block-line-chart',
    'block-two-col-table',
    'block-attachments',
    'block-signature',
  ],
  email: [
    'block-highlight-box',
    'block-discount-codes',
    'block-loyalty-banner',
    'block-delivery-stepper',
    'block-contact',
  ],
};

/** Coerce an untrusted value to a `DocType`, defaulting to `invoice`. */
export function docTypeOf(value: unknown, fallback: DocType = 'invoice'): DocType {
  return typeof value === 'string' && (DOC_TYPES as readonly string[]).includes(value)
    ? (value as DocType)
    : fallback;
}

// --- money --------------------------------------------------------------------

/** Fixed demo anchor for the block vocabulary — 2026-06-01T00:00:00Z. */
export const BLOCK_DEMO_EPOCH = Date.UTC(2026, 5, 1);

/** Milliseconds in a whole day. */
export const BLOCK_DAY_MS = 86_400_000;

/**
 * Currency formatting for a money figure (10 §4.4 — the code comes from the
 * doc/column metadata, never from the viewer's locale).
 *
 * `|| 'USD'` rather than `??`: `format.currency: ''` is schema-valid (the shared
 * config types it as a free string) and `{ style: 'currency', currency: '' }`
 * throws `RangeError` inside `Intl` — the exact crash the config-fuzz gate
 * samples for (see qa/zod-sample.ts's `FIELD_POOLS`).
 */
export function formatBlockMoney(
  value: number,
  options?: { locale?: string | undefined; currency?: string | undefined },
): string {
  if (!Number.isFinite(value)) return '—';
  return getFormatters(resolveLocale(options?.locale)).number(value, {
    style: 'currency',
    currency: options?.currency || 'USD',
  });
}

/**
 * Percent formatting for a FRACTIONAL rate (0.075 → "7.5%").
 *
 * The whole-percent test rounds BEFORE the modulo. `rate * 100` is a float:
 * `0.07 * 100` is `7.000000000000001` and `0.29 * 100` is `28.999999999999996`,
 * so testing `% 1 === 0` on the raw product answers "no" for two perfectly
 * ordinary tax rates — and the same tax table would then print `20%` next to
 * `7.00%`. Scaling to 1e6 keeps four decimal places of a percent (0.0001%),
 * which is finer than any rate this renders and coarse enough to swallow the
 * representation error.
 */
export function formatBlockRate(rate: number, locale?: string | undefined): string {
  if (!Number.isFinite(rate)) return '—';
  const wholePercent = Math.round(rate * 1e6) % 1e4 === 0;
  return getFormatters(resolveLocale(locale)).percent(rate, { fractionDigits: wholePercent ? 0 : 2 });
}

/** Plain number formatting (loyalty points, cycle counts). */
export function formatBlockNumber(value: number, locale?: string | undefined): string {
  if (!Number.isFinite(value)) return '—';
  return getFormatters(resolveLocale(locale)).number(value);
}

/** Short date formatting for a doc date field; blank input renders an em dash. */
export function formatBlockDate(value: string | number | undefined, locale?: string | undefined): string {
  if (value === undefined || value === '') return '—';
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return typeof value === 'string' ? value : '—';
  return getFormatters(resolveLocale(locale)).date(ms, 'medium');
}

/** Byte-size formatting for `block-attachments`' mono size column. */
export function formatBlockSize(bytes: number, locale?: string | undefined): string {
  if (!Number.isFinite(bytes)) return '—';
  return getFormatters(resolveLocale(locale)).bytes(bytes);
}

/**
 * Mask a payment method for `block-payment-history` — never render a full PAN.
 * Only the last four digits ever reach the DOM, and they come from the row's own
 * `last4` field (a masked column), not from a parsed number.
 */
export function maskMethod(method: string, last4?: string | undefined): string {
  const tail = (last4 ?? '').replace(/\D/g, '').slice(-4);
  return tail === '' ? method : `${method} ···· ${tail}`;
}

/**
 * The canvas's live-recomputing totals (annex §13): subtotal from the line
 * items, discount off the subtotal, tax on the discounted base, total due.
 *
 * Every figure is derived here and nowhere else, so `block-totals-summary`,
 * `block-tax-breakdown` and `block-qr-pay` can never disagree. Non-finite or
 * negative quantities are coerced to 0 rather than poisoning the arithmetic with
 * `NaN` — untrusted rows reach this from a live table.
 */
export function computeTotals(
  items: readonly DocLineItem[],
  rates?: DocRates | undefined,
  currencyFallback = 'USD',
): DocTotals {
  const subtotal = items.reduce((sum, item) => sum + safeMoney(item.qty) * safeMoney(item.rate), 0);
  const discountRate = clamp01(rates?.discountRate ?? 0);
  const taxRate = clamp01(rates?.taxRate ?? 0);
  const discount = round2(subtotal * discountRate);
  const taxable = round2(subtotal - discount);
  const tax = round2(taxable * taxRate);
  return {
    subtotal: round2(subtotal),
    discount,
    taxable,
    tax,
    total: round2(taxable + tax),
    currency: rates?.currency || currencyFallback,
  };
}

function safeMoney(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Rates are fractions; anything outside [0,1] is corrupt input, not a 900% tax. */
function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** Round to cents — float money must never render `19.999999999999998`. */
export function round2(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

// --- payload projection -------------------------------------------------------

/**
 * Project an untrusted `record` payload onto its row. Accepts both the canonical
 * `{ row }` envelope and a BARE object (what a hand-written manifest or a story
 * tends to pass), so a block never blanks out over an envelope detail.
 */
export function rowOf<T>(data: unknown): T | null {
  const record = asRecord(data);
  if (record === null) return null;
  if ('row' in record) return (asRecord(record.row) as T | null) ?? null;
  return record as T;
}

/** Project an untrusted `record-list` payload onto its rows. */
export function rowsOf(data: unknown): Record<string, unknown>[] {
  const record = asRecord(data);
  if (record === null) return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  const rows = record.rows;
  return Array.isArray(rows) ? (rows.filter((row) => asRecord(row) !== null) as Record<string, unknown>[]) : [];
}

/** Project an untrusted `categorical` payload onto its label/value items. */
export function categoricalItemsOf(data: unknown): { label: string; value: number }[] {
  const record = asRecord(data);
  const items = record?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((raw, index) => {
    const row = asRecord(raw);
    if (row === null) return [];
    const value = numberField(row, 'value');
    if (value === undefined) return [];
    return [{ label: stringField(row, 'label') ?? String(index + 1), value }];
  });
}

/** Project untrusted rows onto `DocLineItem`s via the configured field naming. */
export function lineItemsOf(
  data: unknown,
  fields: { idField: string; descField: string; qtyField: string; rateField: string },
): DocLineItem[] {
  return rowsOf(data).map((row, index) => ({
    id: stringField(row, fields.idField) ?? `item-${index}`,
    desc: stringField(row, fields.descField) ?? '',
    qty: numberField(row, fields.qtyField) ?? 0,
    rate: numberField(row, fields.rateField) ?? 0,
  }));
}

/** `block-two-col-table` rows: `rows[][]` coerced to [left, right] string pairs. */
export function twoColRowsOf(data: unknown): BlockTwoColRow[] {
  const record = asRecord(data);
  const rows = record?.rows;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((raw): BlockTwoColRow[] => {
    if (Array.isArray(raw)) {
      return [[cell(raw[0]), cell(raw[1])]];
    }
    const row = asRecord(raw);
    if (row === null) return [];
    const values = Object.values(row);
    return [[cell(values[0]), cell(values[1])]];
  });
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : String(value);
}

// --- document-canvas block order ---------------------------------------------

/**
 * Resolve the canvas's ordered block instances from an untrusted doc row.
 *
 * Precedence: the doc's own `blockOrder[]` → the `enabledBlocks` config → the
 * doc type's default composition. Unknown ids are DROPPED (never rendered as an
 * arbitrary widget), and `flags[blockId] === false` hides a block — the annex's
 * "~20 boolean show-flags per doc".
 */
export function blockOrderOf(
  doc: DocRecord | null,
  options: { docType: DocType; enabledBlocks?: readonly string[] | undefined },
): DocBlockInstance[] {
  const declared = doc?.blockOrder;
  const source: DocBlockInstance[] = Array.isArray(declared)
    ? declared.flatMap((raw, index) => {
        const row = asRecord(raw);
        // A blockOrder entry may be a bare id string or a full instance object.
        const block = row === null ? raw : row.block;
        if (!isBlockId(block)) return [];
        const id = row === null ? `${block}-${index}` : (stringField(row, 'id') ?? `${block}-${index}`);
        const label = row === null ? undefined : stringField(row, 'label');
        return [{ id, block, ...(label === undefined ? {} : { label }) }];
      })
    : (options.enabledBlocks ?? DOC_TYPE_BLOCKS[options.docType])
        .filter(isBlockId)
        .map((block, index) => ({ id: `${block}-${index}`, block }));

  const enabled = options.enabledBlocks === undefined ? null : new Set(options.enabledBlocks);
  const flags = doc?.flags;
  return source.filter((instance) => {
    if (enabled !== null && !enabled.has(instance.block)) return false;
    return flags?.[instance.block] !== false;
  });
}

/**
 * Project the canvas's single doc object onto ONE block's own §3 payload.
 *
 * The money blocks are DERIVED from the doc's `items` + `rates` rather than read
 * from storage — that is the annex's "live-recomputing totals", and it is what
 * guarantees `block-totals-summary`, `block-tax-breakdown` and `block-qr-pay`
 * can never disagree about the same invoice. Every other block is doc content
 * with no canonical derivation, so it comes from the `blocks` bag as-is; a block
 * with no payload gets `null` and renders its own empty copy.
 *
 * Pure, so the projection is golden-testable without mounting the canvas.
 */
export function blockDataOf(blockId: string, doc: DocRecord | null): unknown {
  if (doc === null) return null;
  const items = Array.isArray(doc.items) ? doc.items : [];
  switch (blockId) {
    case 'block-line-items':
      return rowsData(items);
    case 'block-totals-summary':
      return rowData({ items, rates: doc.rates ?? {} });
    case 'block-tax-breakdown': {
      // One derived line per declared rate — the doc's own tax lines win when it
      // carries them (a multi-jurisdiction invoice can't be derived from one rate).
      const declared = doc.blocks?.['block-tax-breakdown'];
      if (declared !== undefined) return declared;
      const rate = doc.rates?.taxRate;
      if (rate === undefined || rate === 0) return rowsData([]);
      const totals = computeTotals(items, doc.rates, doc.currency || 'USD');
      return rowsData([{ id: 'tax-1', label: 'Tax', rate, amount: totals.tax }]);
    }
    case 'block-qr-pay': {
      const totals = computeTotals(items, doc.rates, doc.currency || 'USD');
      return rowData({
        caption: 'Scan to pay',
        total: totals.total,
        currency: totals.currency,
      });
    }
    default:
      return doc.blocks?.[blockId] ?? null;
  }
}

/**
 * Move the item at `index` by `delta` positions, returning a NEW list. Out-of-
 * range moves return the list unchanged, so a "move up" on the first block is a
 * no-op rather than a wrap-around — the canvas's up/down controls rely on that
 * to stay predictable at the ends.
 *
 * This is deliberately an index algebra rather than a pointer drag: reorder in
 * the canvas is driven by keyboard-reachable buttons (and the page-builder page
 * may drive the same callback from a pointer layer), so the ordering logic stays
 * pure, testable, and identical for both input modes.
 */
export function moveBlock<T>(list: readonly T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved as T);
  return next;
}

// --- binding ------------------------------------------------------------------

/** The table a `mutate` intent addresses, resolved from the binding descriptor. */
export interface BlockBindingSource {
  connectionId: string;
  table: string;
}

/**
 * Resolve `config.binding` to the `{ connectionId, table }` a mutate intent
 * needs. The descriptor names the table at `binding.source.name` (+ an optional
 * `schema` qualifier for Postgres) — NOT `binding.table` (04 §5).
 *
 * `null` for an unbound (demo) widget: an edit then has nowhere to go, so the
 * blocks skip emitting rather than inventing a table name.
 */
export function blockBindingSourceOf(
  binding: { connectionId: string; source: { schema?: string | undefined; name: string } } | undefined,
): BlockBindingSource | null {
  if (binding === undefined) return null;
  const { schema, name } = binding.source;
  return { connectionId: binding.connectionId, table: schema === undefined ? name : `${schema}.${name}` };
}

// --- envelope constructors (shared by demoData + stories) ---------------------

export function rowsData<T>(rows: readonly T[]): RowsData<T> {
  return { rows, total: rows.length };
}

export function rowData<T>(row: T | null): RowData<T> {
  return { row };
}

export function categoricalData(items: readonly { label: string; value: number }[]): CategoricalData {
  return { items };
}
