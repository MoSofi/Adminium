// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TRACK BUILDER — config schemas + deterministic demo generators for
 * `document-canvas` and the 22 `block-*` document-vocabulary widgets
 * (annex §13). PURE module: zod + block-lib/domain-lib only, no React, no
 * @adminium/ui, no lucide.
 *
 * WHY THIS EXISTS: `blocks-track.definitions.ts` imports these schemas and
 * `demoData` generators for its registry metadata. If they lived beside the
 * components, importing the metadata would drag every block component into the
 * eager registry chunk — the components load ONLY through
 * `lazy(() => import('./blocks-track-components.js'))` (04 §2.3; the
 * chunk-budget gate walks the transitive metadata graph and enforces exactly
 * this). Same convention as `media-config.ts` / `domain-config.ts`.
 *
 * ONE MODULE FOR 23 WIDGETS: the annex specifies the blocks as a single shared
 * library ("Document blocks (shared library used by `document-canvas`)") whose
 * members are a few lines of schema each; splitting them across 23 files would
 * be 23 copies of the same import header for no isolation gain, and they are
 * versioned, reviewed and rendered together.
 *
 * DETERMINISM (04 §7.7): every generator derives from `mulberry32(seed)` and the
 * fixed `BLOCK_DEMO_EPOCH` — never `Math.random()` / `Date.now()`. Distinct
 * seeds must yield distinct payloads (the determinism gate asserts it), so each
 * generator threads the seed into a value the payload actually carries.
 *
 * LABELS: widgets are locale-agnostic (04 §2) — user-visible copy arrives as
 * already-translated strings via config, with English developer fallbacks. The
 * dashboard fills them from `t('…')`; en-US entries live at `widgets.domain.*`.
 */
import { z } from 'zod';

import {
  BLOCK_DAY_MS,
  BLOCK_DEMO_EPOCH,
  BLOCK_IDS,
  DOC_TYPES,
  DOC_TYPE_BLOCKS,
  categoricalData,
  computeTotals,
  rowData,
  rowsData,
} from './block-lib.js';
import type {
  BlockApproval,
  BlockAttachment,
  BlockContact,
  BlockDiscountCode,
  BlockFxLine,
  BlockHighlight,
  BlockImagePlaceholder,
  BlockKpi,
  BlockLateFees,
  BlockLoyalty,
  BlockMultiCurrency,
  BlockPayment,
  BlockQrPay,
  BlockRecurring,
  BlockSignature,
  BlockStep,
  BlockTaxLine,
  BlockTerms,
  CategoricalData,
  DocLineItem,
  DocRecord,
  RowData,
  RowsData,
} from './block-types.js';
import { mulberry32, pickFrom } from './domain-lib.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

/** ISO date `days` after the fixed demo epoch (never reads the wall clock). */
function dayAfterEpoch(days: number): string {
  return new Date(BLOCK_DEMO_EPOCH + days * BLOCK_DAY_MS).toISOString();
}

/** Empty-copy keys every block carries (04 §4 — per-widget empty copy). */
const emptyCopy = {
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
};

// ═══════════════════════════════════════════════════════════════════════════
// document-canvas (annex §13)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `document-canvas` config — the annex's declared `docType`, `enabledBlocks`
 * and `brand` (accent, logo), plus the canvas's own interaction switches.
 *
 * `brand.accent` is a TOKEN NAME, never a raw color: the repo bans raw hex, and
 * a doc that could inject an arbitrary color string into the DOM would defeat
 * the theming contract. Unknown accents fall back to the app accent.
 */
export const documentCanvasConfigSchema = widgetSharedConfigSchema.extend({
  docType: z.enum(DOC_TYPES).default('invoice'),
  /** Block ids this canvas may render; absent → the doc type's default set. */
  enabledBlocks: z.array(z.enum(BLOCK_IDS)).optional(),
  brand: z
    .object({
      /** Semantic accent token name (`accent`, `info`, `pos`, …). */
      accent: z.enum(['accent', 'info', 'pos', 'warn', 'danger', 'neutral']).default('accent'),
      /** Logo text/initials rendered in the paper header (no remote images). */
      logo: z.string().optional(),
    })
    .optional(),
  /** Blocks are click-to-select with an accent outline (annex §13). */
  selectable: z.boolean().default(true),
  /** Show the per-block move up/down + remove controls. */
  reorderable: z.boolean().default(true),
  /** Instance id selected on first render (the page owns it thereafter). */
  selectedBlockId: z.string().optional(),
  ...emptyCopy,
  addBlockLabel: z.string().optional(),
  removeBlockLabel: z.string().optional(),
  moveUpLabel: z.string().optional(),
  moveDownLabel: z.string().optional(),
  /** Accessible name for the ordered block list. */
  blockListLabel: z.string().optional(),
  billedToLabel: z.string().optional(),
  issuedLabel: z.string().optional(),
  dueLabel: z.string().optional(),
});
export type DocumentCanvasConfig = z.infer<typeof documentCanvasConfigSchema>;

const DEMO_ITEM_POOL: readonly { desc: string; qty: number; rate: number }[] = [
  { desc: 'Design system audit', qty: 12, rate: 180 },
  { desc: 'Dashboard implementation', qty: 40, rate: 165 },
  { desc: 'Schema migration', qty: 8, rate: 210 },
  { desc: 'Accessibility review', qty: 6, rate: 150 },
  { desc: 'Localization pass (8 locales)', qty: 16, rate: 140 },
  { desc: 'Performance profiling', qty: 10, rate: 195 },
];

/** Deterministic line items — the seed picks how many and at what quantities. */
function demoItems(random: () => number, count: number): DocLineItem[] {
  return DEMO_ITEM_POOL.slice(0, count).map((item, index) => ({
    id: `li-${index + 1}`,
    desc: item.desc,
    // Seed nudges the quantity so distinct seeds yield distinct money.
    qty: item.qty + Math.floor(random() * 6),
    rate: item.rate,
  }));
}

/**
 * Deterministic `record` doc (04 §7.7) — an invoice-shaped doc object with the
 * items, rates, flags and `blockOrder[]` the canvas renders. The seed varies the
 * document number, the staffed line items and the rates.
 */
export function documentCanvasDemoData(seed: number): RowData<DocRecord> {
  const random = mulberry32(seed || 1);
  const count = 3 + Math.floor(random() * 3);
  const items = demoItems(random, count);
  const number = `INV-${2600 + Math.floor(random() * 400)}`;
  const blocks = DOC_TYPE_BLOCKS.invoice;
  return rowData<DocRecord>({
    docType: 'invoice',
    title: 'Invoice',
    number,
    issuedAt: dayAfterEpoch(0),
    dueAt: dayAfterEpoch(30),
    fromLines: ['Northwind Studio', '18 Harbour Road', 'Lisbon, 1200-109', 'PT'],
    toLines: ['Acme Corporation', '400 Market Street', 'San Francisco, CA 94105', 'US'],
    currency: 'USD',
    items,
    rates: { taxRate: 0.2, discountRate: random() < 0.5 ? 0.1 : 0, currency: 'USD' },
    blockOrder: blocks.map((block, index) => ({ id: `${block}-${index}`, block })),
    flags: Object.fromEntries(blocks.map((block) => [block, true])),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// block-line-items / block-totals-summary / block-tax-breakdown (money core)
// ═══════════════════════════════════════════════════════════════════════════

/** Field naming shared by every block that reads line-item rows (04 §5). */
const lineItemFields = {
  idField: z.string().default('id'),
  descField: z.string().default('desc'),
  qtyField: z.string().default('qty'),
  rateField: z.string().default('rate'),
};

/**
 * `block-line-items` — editable qty/rate/desc rows feeding the totals. Edits
 * emit `mutate` intents; the block never writes (04 §2.1).
 */
export const blockLineItemsConfigSchema = widgetSharedConfigSchema.extend({
  ...lineItemFields,
  /** Render the inline qty/rate inputs (off → a read-only printed table). */
  editable: z.boolean().default(true),
  showAmountColumn: z.boolean().default(true),
  descHeader: z.string().optional(),
  qtyHeader: z.string().optional(),
  rateHeader: z.string().optional(),
  amountHeader: z.string().optional(),
  ...emptyCopy,
});
export type BlockLineItemsConfig = z.infer<typeof blockLineItemsConfigSchema>;

export function blockLineItemsDemoData(seed: number): RowsData<DocLineItem> {
  const random = mulberry32(seed || 1);
  return rowsData(demoItems(random, 3 + Math.floor(random() * 3)));
}

/**
 * `block-totals-summary` — Subtotal → Discount (green negative) → Tax → Total
 * due (accent mono). Binds the doc's items + rates as ONE `record`, because the
 * annex's data note is "items[] + rates": the block recomputes rather than
 * trusting a stored total (`computeTotals`).
 */
export const blockTotalsSummaryConfigSchema = widgetSharedConfigSchema.extend({
  ...lineItemFields,
  itemsField: z.string().default('items'),
  ratesField: z.string().default('rates'),
  subtotalLabel: z.string().optional(),
  discountLabel: z.string().optional(),
  taxLabel: z.string().optional(),
  totalLabel: z.string().optional(),
  /** Hide the discount row when the doc has no discount rate. */
  hideZeroDiscount: z.boolean().default(true),
  ...emptyCopy,
});
export type BlockTotalsSummaryConfig = z.infer<typeof blockTotalsSummaryConfigSchema>;

export interface BlockTotalsPayload {
  items: readonly DocLineItem[];
  rates: { taxRate: number; discountRate: number; currency: string };
}

export function blockTotalsSummaryDemoData(seed: number): RowData<BlockTotalsPayload> {
  const random = mulberry32(seed || 1);
  const items = demoItems(random, 3 + Math.floor(random() * 3));
  return rowData<BlockTotalsPayload>({
    items,
    rates: { taxRate: 0.2, discountRate: random() < 0.5 ? 0.1 : 0, currency: 'USD' },
  });
}

/**
 * `block-tax-breakdown` — label/rate/amount rows applied to the subtotal. The
 * amount is derived from `rate × subtotal` unless the row carries an explicit
 * one, so an edit to the items reflows the tax lines (annex: "applied to
 * subtotal").
 */
export const blockTaxBreakdownConfigSchema = widgetSharedConfigSchema.extend({
  idField: z.string().default('id'),
  labelField: z.string().default('label'),
  rateField: z.string().default('rate'),
  amountField: z.string().default('amount'),
  /** Subtotal the rates apply to when the payload carries no explicit amounts. */
  subtotal: z.number().default(0),
  showRateColumn: z.boolean().default(true),
  ...emptyCopy,
});
export type BlockTaxBreakdownConfig = z.infer<typeof blockTaxBreakdownConfigSchema>;

const TAX_POOL: readonly { label: string; rate: number }[] = [
  { label: 'VAT (standard)', rate: 0.2 },
  { label: 'State sales tax', rate: 0.075 },
  { label: 'City surcharge', rate: 0.015 },
  { label: 'Digital services levy', rate: 0.03 },
];

export function blockTaxBreakdownDemoData(seed: number): RowsData<BlockTaxLine> {
  const random = mulberry32(seed || 1);
  const count = 1 + Math.floor(random() * 3);
  const subtotal = 2000 + Math.floor(random() * 4000);
  return rowsData(
    TAX_POOL.slice(0, count).map((tax, index) => ({
      id: `tax-${index + 1}`,
      label: tax.label,
      rate: tax.rate,
      amount: Math.round(subtotal * tax.rate * 100) / 100,
    })),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// block-kpi-row / block-bar-chart / block-line-chart / block-two-col-table
// (the Report Builder vocabulary)
// ═══════════════════════════════════════════════════════════════════════════

/** `block-kpi-row` — stat tiles with sign-aware delta coloring. */
export const blockKpiRowConfigSchema = widgetSharedConfigSchema.extend({
  idField: z.string().default('id'),
  labelField: z.string().default('label'),
  valueField: z.string().default('value'),
  deltaField: z.string().default('delta'),
  unitField: z.string().default('unit'),
  /** Tiles beyond this are dropped (the row must stay one line on paper). */
  maxTiles: z.number().int().min(1).max(6).default(4),
  /** A rising delta is good (revenue) or bad (churn) — flips the tone mapping. */
  invertDelta: z.boolean().default(false),
  ...emptyCopy,
});
export type BlockKpiRowConfig = z.infer<typeof blockKpiRowConfigSchema>;

const KPI_POOL: readonly { label: string; value: number; unit: BlockKpi['unit'] }[] = [
  { label: 'Revenue', value: 128_400, unit: 'currency' },
  { label: 'Active users', value: 8420, unit: 'plain' },
  { label: 'Conversion', value: 0.042, unit: 'percent' },
  { label: 'Avg order', value: 96.4, unit: 'currency' },
];

export function blockKpiRowDemoData(seed: number): RowsData<BlockKpi> {
  const random = mulberry32(seed || 1);
  return rowsData(
    KPI_POOL.map((kpi, index) => ({
      id: `kpi-${index + 1}`,
      label: kpi.label,
      value: Math.round(kpi.value * (0.85 + random() * 0.3) * 1000) / 1000,
      delta: Math.round((random() * 0.4 - 0.15) * 1000) / 1000,
      unit: kpi.unit,
    })),
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'] as const;

/**
 * `block-bar-chart` / `block-line-chart` — the annex's "mini pure-div/SVG
 * charts, currentColor accent. Data: series[]".
 *
 * Both take the §3 `categorical` envelope: the annex gives them the SAME data
 * note and groups them as one entry, so declaring one shape keeps them
 * interchangeable in a canvas slot (swapping bar↔line must never re-bind the
 * doc). Empty ⇔ no items, via the shared `isEmptyByShape.categorical`.
 */
const miniChartConfig = {
  /** Bars/points beyond this are dropped — a doc block is ~200px wide. */
  maxPoints: z.number().int().min(2).max(24).default(8),
  showValues: z.boolean().default(false),
  showAxis: z.boolean().default(true),
  ...emptyCopy,
};

export const blockBarChartConfigSchema = widgetSharedConfigSchema.extend({ ...miniChartConfig });
export type BlockBarChartConfig = z.infer<typeof blockBarChartConfigSchema>;

export const blockLineChartConfigSchema = widgetSharedConfigSchema.extend({
  ...miniChartConfig,
  /** Fill the area under the line (the Report Builder's default). */
  area: z.boolean().default(true),
});
export type BlockLineChartConfig = z.infer<typeof blockLineChartConfigSchema>;

function miniSeries(seed: number, scale: number): CategoricalData {
  const random = mulberry32(seed || 1);
  return categoricalData(
    MONTHS.map((label) => ({
      label,
      value: Math.round((0.4 + random()) * scale),
    })),
  );
}

export function blockBarChartDemoData(seed: number): CategoricalData {
  return miniSeries(seed, 4200);
}

export function blockLineChartDemoData(seed: number): CategoricalData {
  return miniSeries(seed, 1800);
}

/**
 * `block-two-col-table` — first row styled header, right col mono. The payload
 * is the annex's `rows[][]`, carried in a `record-list` envelope so the shared
 * `total === 0` predicate routes an empty table to the empty state.
 */
export const blockTwoColTableConfigSchema = widgetSharedConfigSchema.extend({
  /** Treat the first row as the header (annex: "first row styled header"). */
  headerRow: z.boolean().default(true),
  /** Right column renders mono/tabular (annex: "right col mono"). */
  monoRightColumn: z.boolean().default(true),
  ...emptyCopy,
});
export type BlockTwoColTableConfig = z.infer<typeof blockTwoColTableConfigSchema>;

const TWO_COL_POOL: readonly (readonly [string, string])[] = [
  ['Metric', 'Value'],
  ['Total sessions', '48,209'],
  ['Bounce rate', '32.4%'],
  ['Avg. duration', '4m 12s'],
  ['New vs returning', '61 / 39'],
  ['Top referrer', 'search'],
];

export function blockTwoColTableDemoData(seed: number): RowsData<readonly [string, string]> {
  const random = mulberry32(seed || 1);
  const count = 4 + Math.floor(random() * 3);
  const rows: (readonly [string, string])[] = [
    TWO_COL_POOL[0] as readonly [string, string],
    ...TWO_COL_POOL.slice(1, count).map(
      (row) => [row[0], row[1]] as readonly [string, string],
    ),
  ];
  return rowsData(rows);
}

// ═══════════════════════════════════════════════════════════════════════════
// Payment vocabulary (multi-currency, history, discounts, loyalty, recurring, QR)
// ═══════════════════════════════════════════════════════════════════════════

/** `block-multi-currency` — base × rate per currency, indicative-rates footnote. */
export const blockMultiCurrencyConfigSchema = widgetSharedConfigSchema.extend({
  amountField: z.string().default('amount'),
  fxField: z.string().default('fx'),
  baseCurrencyField: z.string().default('baseCurrency'),
  /** The annex's indicative-rates footnote; omitted → no footnote. */
  footnote: z.string().optional(),
  ...emptyCopy,
});
export type BlockMultiCurrencyConfig = z.infer<typeof blockMultiCurrencyConfigSchema>;

const FX_POOL: readonly BlockFxLine[] = [
  { currency: 'EUR', rate: 0.92 },
  { currency: 'GBP', rate: 0.79 },
  { currency: 'JPY', rate: 157.2 },
  { currency: 'CAD', rate: 1.36 },
];

export function blockMultiCurrencyDemoData(seed: number): RowData<BlockMultiCurrency> {
  const random = mulberry32(seed || 1);
  const count = 2 + Math.floor(random() * 3);
  return rowData<BlockMultiCurrency>({
    amount: Math.round((2000 + random() * 6000) * 100) / 100,
    baseCurrency: 'USD',
    fx: FX_POOL.slice(0, count).map((fx) => ({
      currency: fx.currency,
      rate: Math.round(fx.rate * (0.97 + random() * 0.06) * 10_000) / 10_000,
    })),
  });
}

/** `block-payment-history` — date, masked method, amount, status pill rows. */
export const blockPaymentHistoryConfigSchema = widgetSharedConfigSchema.extend({
  idField: z.string().default('id'),
  dateField: z.string().default('date'),
  methodField: z.string().default('method'),
  last4Field: z.string().default('last4'),
  amountField: z.string().default('amount'),
  statusField: z.string().default('status'),
  maxRows: z.number().int().min(1).max(20).default(6),
  ...emptyCopy,
});
export type BlockPaymentHistoryConfig = z.infer<typeof blockPaymentHistoryConfigSchema>;

const PAY_METHODS = ['Visa', 'Mastercard', 'Amex', 'Bank transfer'] as const;
const PAY_STATUSES = ['paid', 'pending', 'failed', 'refunded'] as const;

export function blockPaymentHistoryDemoData(seed: number): RowsData<BlockPayment> {
  const random = mulberry32(seed || 1);
  const count = 2 + Math.floor(random() * 4);
  const rows: BlockPayment[] = [];
  for (let index = 0; index < count; index += 1) {
    rows.push({
      id: `pay-${index + 1}`,
      date: dayAfterEpoch(-index * 30),
      method: pickFrom(random, PAY_METHODS),
      last4: String(1000 + Math.floor(random() * 8999)).slice(-4),
      amount: Math.round((400 + random() * 2400) * 100) / 100,
      // First row is always settled so the demo never reads as all-failing.
      status: index === 0 ? 'paid' : pickFrom(random, PAY_STATUSES),
    });
  }
  return rowsData(rows);
}

/** `block-discount-codes` — mono code chip + label + green amount. */
export const blockDiscountCodesConfigSchema = widgetSharedConfigSchema.extend({
  idField: z.string().default('id'),
  codeField: z.string().default('code'),
  labelField: z.string().default('label'),
  amountField: z.string().default('amount'),
  ...emptyCopy,
});
export type BlockDiscountCodesConfig = z.infer<typeof blockDiscountCodesConfigSchema>;

const DISCOUNT_POOL: readonly { code: string; label: string }[] = [
  { code: 'WELCOME10', label: 'First order discount' },
  { code: 'LOYAL5', label: 'Loyalty tier credit' },
  { code: 'BUNDLE20', label: 'Bundle promotion' },
];

export function blockDiscountCodesDemoData(seed: number): RowsData<BlockDiscountCode> {
  const random = mulberry32(seed || 1);
  const count = 1 + Math.floor(random() * 3);
  return rowsData(
    DISCOUNT_POOL.slice(0, count).map((discount, index) => ({
      id: `disc-${index + 1}`,
      code: discount.code,
      label: discount.label,
      amount: Math.round((20 + random() * 180) * 100) / 100,
    })),
  );
}

/** `block-loyalty-banner` — award icon, balance pts · tier, green earned. */
export const blockLoyaltyBannerConfigSchema = widgetSharedConfigSchema.extend({
  balanceField: z.string().default('balance'),
  earnedField: z.string().default('earned'),
  tierField: z.string().default('tier'),
  /** "{balance} pts · {tier}" — placeholders filled by the block. */
  balanceLabel: z.string().optional(),
  /** "+{earned} earned on this order". */
  earnedLabel: z.string().optional(),
  ...emptyCopy,
});
export type BlockLoyaltyBannerConfig = z.infer<typeof blockLoyaltyBannerConfigSchema>;

const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum'] as const;

export function blockLoyaltyBannerDemoData(seed: number): RowData<BlockLoyalty> {
  const random = mulberry32(seed || 1);
  return rowData<BlockLoyalty>({
    balance: 500 + Math.floor(random() * 9500),
    earned: 20 + Math.floor(random() * 400),
    tier: pickFrom(random, TIERS),
  });
}

/** `block-recurring-banner` — "Recurring — Monthly · Next on … · N cycles". */
export const blockRecurringBannerConfigSchema = widgetSharedConfigSchema.extend({
  freqField: z.string().default('freq'),
  nextField: z.string().default('next'),
  countField: z.string().default('count'),
  /** "Recurring — {freq} · Next on {next} · {count} cycles". */
  template: z.string().optional(),
  ...emptyCopy,
});
export type BlockRecurringBannerConfig = z.infer<typeof blockRecurringBannerConfigSchema>;

const FREQUENCIES = ['Weekly', 'Monthly', 'Quarterly', 'Annually'] as const;

export function blockRecurringBannerDemoData(seed: number): RowData<BlockRecurring> {
  const random = mulberry32(seed || 1);
  return rowData<BlockRecurring>({
    freq: pickFrom(random, FREQUENCIES),
    next: dayAfterEpoch(7 + Math.floor(random() * 60)),
    count: 2 + Math.floor(random() * 22),
  });
}

/**
 * `block-qr-pay` — forced-white QR tile + caption + amount due.
 *
 * The tile is a deterministic PLACEHOLDER matrix, not a real QR encoding: the
 * annex specifies the visual, and shipping a QR codec here would add a runtime
 * dependency to render a block whose payload URL the host owns. `qrSeed` keeps
 * the placeholder's module pattern stable across captures.
 */
export const blockQrPayConfigSchema = widgetSharedConfigSchema.extend({
  captionField: z.string().default('caption'),
  totalField: z.string().default('total'),
  /** Placeholder matrix size (modules per side). */
  modules: z.number().int().min(9).max(29).default(21),
  /** Pins the placeholder pattern so VRT captures stay byte-identical. */
  qrSeed: z.number().int().default(7),
  amountLabel: z.string().optional(),
  ...emptyCopy,
});
export type BlockQrPayConfig = z.infer<typeof blockQrPayConfigSchema>;

export function blockQrPayDemoData(seed: number): RowData<BlockQrPay> {
  const random = mulberry32(seed || 1);
  return rowData<BlockQrPay>({
    caption: 'Scan to pay this invoice',
    total: Math.round((800 + random() * 7000) * 100) / 100,
    currency: 'USD',
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Status / approval vocabulary
// ═══════════════════════════════════════════════════════════════════════════

/** `block-delivery-stepper` — horizontal done/current/todo dots with connector. */
export const blockDeliveryStepperConfigSchema = widgetSharedConfigSchema.extend({
  idField: z.string().default('id'),
  labelField: z.string().default('label'),
  stateField: z.string().default('state'),
  ...emptyCopy,
});
export type BlockDeliveryStepperConfig = z.infer<typeof blockDeliveryStepperConfigSchema>;

const DELIVERY_STEPS = ['Ordered', 'Packed', 'Shipped', 'Out for delivery', 'Delivered'] as const;

export function blockDeliveryStepperDemoData(seed: number): RowsData<BlockStep> {
  const random = mulberry32(seed || 1);
  const current = Math.floor(random() * DELIVERY_STEPS.length);
  return rowsData(
    DELIVERY_STEPS.map((label, index) => ({
      id: `step-${index + 1}`,
      label,
      state: index < current ? 'done' : index === current ? 'current' : 'todo',
    })),
  );
}

/** `block-signature` — name/title editable signature lines + date. */
export const blockSignatureConfigSchema = widgetSharedConfigSchema.extend({
  nameField: z.string().default('sigName'),
  titleField: z.string().default('sigTitle'),
  dateField: z.string().default('sigDate'),
  editable: z.boolean().default(true),
  showDate: z.boolean().default(true),
  namePlaceholder: z.string().optional(),
  titlePlaceholder: z.string().optional(),
  dateLabel: z.string().optional(),
  ...emptyCopy,
});
export type BlockSignatureConfig = z.infer<typeof blockSignatureConfigSchema>;

const SIGNERS: readonly { sigName: string; sigTitle: string }[] = [
  { sigName: 'Ava Reyes', sigTitle: 'Chief Executive' },
  { sigName: 'Morgan Lee', sigTitle: 'VP Engineering' },
  { sigName: 'Riley Cho', sigTitle: 'VP Design' },
  { sigName: 'Casey Ford', sigTitle: 'VP Operations' },
];

export function blockSignatureDemoData(seed: number): RowData<BlockSignature> {
  const random = mulberry32(seed || 1);
  const signer = pickFrom(random, SIGNERS);
  return rowData<BlockSignature>({
    sigName: signer.sigName,
    sigTitle: signer.sigTitle,
    sigDate: dayAfterEpoch(Math.floor(random() * 20)),
  });
}

/**
 * `block-terms-checkbox` — toggle + editable label. Declared `form-state`
 * (04 §3): the payload IS the control's own state, so it is never "empty" and
 * the shared predicate correctly never routes it to the empty card.
 */
export const blockTermsCheckboxConfigSchema = widgetSharedConfigSchema.extend({
  labelField: z.string().default('label'),
  checkedField: z.string().default('checked'),
  editableLabel: z.boolean().default(true),
  /** Fallback copy when the payload carries no label. */
  defaultLabel: z.string().optional(),
});
export type BlockTermsCheckboxConfig = z.infer<typeof blockTermsCheckboxConfigSchema>;

const TERMS_POOL = [
  'I accept the terms and conditions',
  'I agree to the statement of work',
  'I confirm the figures above are accurate',
  'I authorize the recurring charge',
] as const;

export function blockTermsCheckboxDemoData(seed: number): BlockTerms {
  const random = mulberry32(seed || 1);
  return { label: pickFrom(random, TERMS_POOL), checked: random() < 0.5 };
}

/** `block-approval` — approver card, status-tinted pill (Pending/Approved/Rejected). */
export const blockApprovalConfigSchema = widgetSharedConfigSchema.extend({
  nameField: z.string().default('name'),
  titleField: z.string().default('title'),
  statusField: z.string().default('status'),
  /** Render Approve/Reject actions (they emit `mutate` intents). */
  actionable: z.boolean().default(false),
  approveLabel: z.string().optional(),
  rejectLabel: z.string().optional(),
  pendingLabel: z.string().optional(),
  approvedLabel: z.string().optional(),
  rejectedLabel: z.string().optional(),
  ...emptyCopy,
});
export type BlockApprovalConfig = z.infer<typeof blockApprovalConfigSchema>;

const APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const;

export function blockApprovalDemoData(seed: number): RowData<BlockApproval> {
  const random = mulberry32(seed || 1);
  const signer = pickFrom(random, SIGNERS);
  return rowData<BlockApproval>({
    name: signer.sigName,
    title: signer.sigTitle,
    status: pickFrom(random, APPROVAL_STATUSES),
  });
}

/** `block-attachments` — paperclip rows w/ mono sizes. */
export const blockAttachmentsConfigSchema = widgetSharedConfigSchema.extend({
  idField: z.string().default('id'),
  nameField: z.string().default('name'),
  sizeField: z.string().default('size'),
  maxRows: z.number().int().min(1).max(20).default(6),
  ...emptyCopy,
});
export type BlockAttachmentsConfig = z.infer<typeof blockAttachmentsConfigSchema>;

const ATTACHMENT_POOL: readonly { name: string; size: number }[] = [
  { name: 'Statement of work.pdf', size: 2_400_000 },
  { name: 'Timesheet - June.xlsx', size: 84_000 },
  { name: 'Design handoff.fig', size: 18_400_000 },
  { name: 'Receipts.zip', size: 5_100_000 },
];

export function blockAttachmentsDemoData(seed: number): RowsData<BlockAttachment> {
  const random = mulberry32(seed || 1);
  const count = 1 + Math.floor(random() * 4);
  return rowsData(
    ATTACHMENT_POOL.slice(0, count).map((file, index) => ({
      id: `att-${index + 1}`,
      name: file.name,
      size: Math.round(file.size * (0.6 + random() * 0.8)),
    })),
  );
}

/** `block-late-fees` — warn callout with templated rate/days copy. */
export const blockLateFeesConfigSchema = widgetSharedConfigSchema.extend({
  rateField: z.string().default('rate'),
  daysField: z.string().default('days'),
  /** "A {rate} late fee applies after {days} days." */
  template: z.string().optional(),
  ...emptyCopy,
});
export type BlockLateFeesConfig = z.infer<typeof blockLateFeesConfigSchema>;

export function blockLateFeesDemoData(seed: number): RowData<BlockLateFees> {
  const random = mulberry32(seed || 1);
  return rowData<BlockLateFees>({
    rate: Math.round((0.01 + random() * 0.04) * 1000) / 1000,
    days: 7 + Math.floor(random() * 24),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Content vocabulary (image placeholder, contact, highlight)
// ═══════════════════════════════════════════════════════════════════════════

/** `block-image-placeholder` — dashed diagonal-stripe box + caption. */
export const blockImagePlaceholderConfigSchema = widgetSharedConfigSchema.extend({
  textField: z.string().default('text'),
  /** Box aspect ratio — a paper block, not a hero. */
  ratio: z.enum(['16/9', '4/3', '1/1']).default('16/9'),
  ...emptyCopy,
});
export type BlockImagePlaceholderConfig = z.infer<typeof blockImagePlaceholderConfigSchema>;

const PLACEHOLDER_POOL = [
  'Chart export drops in here',
  'Product photo',
  'Cover image',
  'Floor plan — Rev C',
] as const;

export function blockImagePlaceholderDemoData(seed: number): RowData<BlockImagePlaceholder> {
  const random = mulberry32(seed || 1);
  return rowData<BlockImagePlaceholder>({ text: pickFrom(random, PLACEHOLDER_POOL) });
}

/** `block-contact` — icon rows name/email/phone, mono values. */
export const blockContactConfigSchema = widgetSharedConfigSchema.extend({
  nameField: z.string().default('name'),
  emailField: z.string().default('email'),
  phoneField: z.string().default('phone'),
  ...emptyCopy,
});
export type BlockContactConfig = z.infer<typeof blockContactConfigSchema>;

const CONTACT_POOL: readonly BlockContact[] = [
  { name: 'Ava Reyes', email: 'ava@northwind.studio', phone: '+351 21 000 0000' },
  { name: 'Sam Park', email: 'sam@northwind.studio', phone: '+351 21 000 0001' },
  { name: 'Nadia Haq', email: 'nadia@northwind.studio', phone: '+351 21 000 0002' },
];

export function blockContactDemoData(seed: number): RowData<BlockContact> {
  const random = mulberry32(seed || 1);
  return rowData<BlockContact>(pickFrom(random, CONTACT_POOL));
}

/** `block-highlight-box` — gray callout, label + large mono value. */
export const blockHighlightBoxConfigSchema = widgetSharedConfigSchema.extend({
  labelField: z.string().default('label'),
  valueField: z.string().default('value'),
  ...emptyCopy,
});
export type BlockHighlightBoxConfig = z.infer<typeof blockHighlightBoxConfigSchema>;

export function blockHighlightBoxDemoData(seed: number): RowData<BlockHighlight> {
  const random = mulberry32(seed || 1);
  const amount = Math.round((80 + random() * 900) * 100) / 100;
  return rowData<BlockHighlight>({
    label: 'Amount charged',
    // The annex's own example renders an already-formatted string ("$290.00"),
    // because the email surface prints a value the host formatted at send time.
    value: `$${amount.toFixed(2)}`,
  });
}

/** Re-exported so stories/tests can pin the same anchor the generators use. */
export { BLOCK_DEMO_EPOCH, computeTotals };
