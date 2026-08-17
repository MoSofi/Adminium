// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TRACK BUILDER — payload types for `document-canvas` and the 22 `block-*`
 * document-vocabulary widgets (annex §13, "Document blocks").
 *
 * DOM-free and React-free: these are the §3 data-contract envelopes the blocks
 * bind to, so `blocks-config.ts` can describe them (and generate demo payloads
 * for them) without the definitions module ever reaching component code
 * (04 §2.3; the chunk-budget gate).
 *
 * ENVELOPE CHOICE (04 §3) — the annex gives each block a bespoke "Data:" note
 * rather than naming a canonical shape, so each note is mapped onto the closest
 * §3 envelope and the mapping is documented on the definition:
 *   - a bag of scalars for ONE document field group ({sigName, sigTitle},
 *     {balance, earned, tier}, …) → `record`, i.e. `{ row }` — the shape the
 *     shared `isEmptyByShape.record` predicate reads via `row == null`;
 *   - a repeating row set (items[], taxLines[], payHist[], steps[], files[]) →
 *     `record-list`, i.e. `{ rows, total }` — empty ⇔ `total === 0 && !cursor`;
 *   - the mini report charts → `categorical` (`{ items }`, label/value);
 *   - `block-terms-checkbox` → `form-state` (a control whose payload is its own
 *     checked state, never "empty").
 */

// --- document-canvas ---------------------------------------------------------

/** The three document surfaces the canvas renders (annex §13 `docType`). */
export type DocType = 'invoice' | 'report' | 'email';

/**
 * One block instance on the canvas. `block` is the annex registry id
 * (`block-line-items`, …) — the canvas renders the ordered list, and the
 * page-builder page owns add/remove/reorder through callbacks.
 */
export interface DocBlockInstance {
  /** Stable instance key (`blockOrder[]` entry). */
  id: string;
  /** Registry id of the block widget to render. */
  block: string;
  /** Localized section heading shown above the block. */
  label?: string | undefined;
}

/**
 * The single doc object `document-canvas` binds to (annex §13: "single doc
 * object (strings, address lines, items[], rates, flags, blockOrder[])").
 * Carried in the §3 `record` envelope, so `{ row: null }` routes to the empty
 * state through the host's shared predicate.
 */
export interface DocRecord {
  docType?: DocType | undefined;
  title?: string | undefined;
  number?: string | undefined;
  issuedAt?: string | undefined;
  dueAt?: string | undefined;
  /** Sender / recipient address lines, rendered as-is. */
  fromLines?: readonly string[] | undefined;
  toLines?: readonly string[] | undefined;
  currency?: string | undefined;
  items?: readonly DocLineItem[] | undefined;
  rates?: DocRates | undefined;
  /** Ordered block instances — the canvas's render order. */
  blockOrder?: readonly DocBlockInstance[] | undefined;
  /** ~20 per-doc boolean show-flags keyed by block id (annex §13). */
  flags?: Readonly<Record<string, boolean>> | undefined;
  /**
   * Per-block payload bag, keyed by block registry id.
   *
   * The money blocks (`block-line-items`, `block-totals-summary`,
   * `block-tax-breakdown`, `block-qr-pay`) are DERIVED from `items` + `rates`
   * and ignore this — that is what makes the canvas's totals live-recompute and
   * keeps two blocks from disagreeing. Everything else (payment history, the
   * banners, the signature…) is doc content with no canonical derivation, so it
   * rides here and `blockDataOf` hands it straight to the block.
   */
  blocks?: Readonly<Record<string, unknown>> | undefined;
}

export interface DocData {
  row: DocRecord | null;
}

// --- money -------------------------------------------------------------------

/** An editable line item feeding the totals (annex `block-line-items`). */
export interface DocLineItem {
  id: string;
  desc: string;
  qty: number;
  rate: number;
}

/** The rate set the totals block applies to the line-item subtotal. */
export interface DocRates {
  /** Fractional tax rate (0.2 = 20%). */
  taxRate?: number | undefined;
  /** Fractional discount rate applied before tax. */
  discountRate?: number | undefined;
  currency?: string | undefined;
}

/** Recomputed money for a doc — every figure derived, never stored. */
export interface DocTotals {
  subtotal: number;
  discount: number;
  taxable: number;
  tax: number;
  total: number;
  currency: string;
}

// --- per-block payloads ------------------------------------------------------

/** `block-kpi-row` — stat tiles with sign-aware delta coloring. */
export interface BlockKpi {
  id: string;
  label: string;
  value: number;
  delta?: number | undefined;
  unit?: 'plain' | 'currency' | 'percent' | undefined;
}

/** `block-tax-breakdown` — label/rate/amount rows applied to the subtotal. */
export interface BlockTaxLine {
  id: string;
  label: string;
  /** Fractional rate (0.075 = 7.5%). */
  rate: number;
  /** Explicit amount; derived from `rate × subtotal` when absent. */
  amount?: number | undefined;
}

/** `block-multi-currency` — base amount × indicative rate per currency. */
export interface BlockFxLine {
  currency: string;
  rate: number;
}

export interface BlockMultiCurrency {
  amount: number;
  baseCurrency?: string | undefined;
  fx: readonly BlockFxLine[];
}

/** `block-payment-history` — date, masked method, amount, status pill. */
export interface BlockPayment {
  id: string;
  date: string;
  method: string;
  last4?: string | undefined;
  amount: number;
  status: string;
}

/** `block-discount-codes` — mono code chip + label + green amount. */
export interface BlockDiscountCode {
  id: string;
  code: string;
  label: string;
  amount: number;
}

/** `block-loyalty-banner` — award icon, balance pts · tier, green earned. */
export interface BlockLoyalty {
  balance: number;
  earned: number;
  tier: string;
}

/** `block-recurring-banner` — "Recurring — Monthly · Next on … · N cycles". */
export interface BlockRecurring {
  freq: string;
  next: string;
  count: number;
}

/** `block-qr-pay` — QR tile + caption + amount due. */
export interface BlockQrPay {
  caption: string;
  total: number;
  currency?: string | undefined;
}

/** `block-delivery-stepper` — horizontal done/current/todo dots. */
export interface BlockStep {
  id: string;
  label: string;
  state: 'done' | 'current' | 'todo';
}

/** `block-signature` — editable signature lines + date. */
export interface BlockSignature {
  sigName: string;
  sigTitle: string;
  sigDate?: string | undefined;
}

/** `block-terms-checkbox` — toggle + editable label (a `form-state` payload). */
export interface BlockTerms {
  label: string;
  checked: boolean;
}

/** `block-approval` — approver card + status-tinted pill. */
export interface BlockApproval {
  name: string;
  title: string;
  status: 'pending' | 'approved' | 'rejected';
}

/** `block-attachments` — paperclip rows with mono sizes. */
export interface BlockAttachment {
  id: string;
  name: string;
  size: number;
}

/** `block-late-fees` — warn callout with templated rate/days copy. */
export interface BlockLateFees {
  /** Fractional rate (0.015 = 1.5%). */
  rate: number;
  days: number;
}

/** `block-image-placeholder` — dashed diagonal-stripe box + caption. */
export interface BlockImagePlaceholder {
  text: string;
}

/** `block-contact` — icon rows name/email/phone, mono values. */
export interface BlockContact {
  name: string;
  email: string;
  phone: string;
}

/** `block-highlight-box` — gray callout, label + large mono value. */
export interface BlockHighlight {
  label: string;
  value: string;
}

/** `block-two-col-table` — first row styled header, right col mono. */
export type BlockTwoColRow = readonly [string, string];

// --- §3 envelopes ------------------------------------------------------------

/** Canonical `record-list` envelope (04 §3). */
export interface RowsData<T> {
  rows: readonly T[];
  total: number;
}

/** Canonical `record` envelope (04 §3) — empty ⇔ `row == null`. */
export interface RowData<T> {
  row: T | null;
}

/** Canonical `categorical` envelope (04 §3) — the mini report charts. */
export interface CategoricalData {
  items: readonly { label: string; value: number }[];
}
