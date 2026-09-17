// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The invoice arithmetic law (as amended by O25):
 *
 *   a line rounds once           lineMinor  = round(qty × rate, in minor units)
 *   a document discount applies  discount   = round(subtotal × discountRate)
 *   to the rounded subtotal      taxBase    = subtotal − discount
 *   tax on the discounted        tax        = round(taxBase × taxRate)
 *   subtotal                     total      = taxBase + tax
 *
 * and a tax-breakdown component is computed on the SAME base as the ladder
 * (the comp computed it on the undiscounted subtotal, 1709 — the second base
 * O25 corrected).
 *
 * INTEGERS ONLY. Money is integer minor units, a rate is basis points, and
 * every product is divided with one half-away-from-zero rounding, so the same
 * subject gives the same cents on every runtime. `money-fixture.json` beside
 * this file is the table three trees assert: this one, the server's summary
 * and, once it ships, the add-on's renderer — `scripts/check-invoice-
 * money-fixture.mjs` keeps the copies byte-equal.
 *
 * "Total", not the comp's "Total due" (452): recorded payments never reduce
 * it (1712) — there is no balance model, so "due" would be a claim the
 * document cannot support (O25).
 */
import type { InvoiceBody, LineItem, TaxLine } from './envelope.js';

/** Half away from zero — `Math.round` alone sends −0.5 to −0. */
export function roundHalfAway(value: number): number {
  const rounded = Math.round(Math.abs(value));
  return value < 0 ? -rounded : rounded;
}

const DECIMAL = /^([+−-]?)(\d*)(?:[.,](\d*))?$/;

/**
 * Decimal text → a number; anything unparseable is 0 (the comp's
 * `parseFloat(val) || 0`, 1355). Accepts a comma as the decimal mark and the
 * typographic minus the sheet itself prints.
 */
export function parseDecimal(text: string): number {
  const match = DECIMAL.exec(text.trim().replace(/[\s_']/g, ''));
  if (match === null) return 0;
  const [, sign, whole = '', frac = ''] = match;
  if (whole === '' && frac === '') return 0;
  const value = Number(`${whole === '' ? '0' : whole}.${frac === '' ? '0' : frac}`);
  if (!Number.isFinite(value)) return 0;
  return sign === '-' || sign === '−' ? -value : value;
}

/**
 * Major-unit decimal text → integer minor units (two decimals), rounding a
 * third decimal half away from zero. String arithmetic: `"0.1"` must give 10,
 * never 10.000000000000002.
 */
export function parseMinor(text: string): number {
  const match = DECIMAL.exec(text.trim().replace(/[\s_']/g, ''));
  if (match === null) return 0;
  const [, sign, whole = '', frac = ''] = match;
  if (whole === '' && frac === '') return 0;
  const digits = (frac + '000').slice(0, 3);
  const cents = Number(whole === '' ? '0' : whole) * 100 + Number(digits.slice(0, 2)) + (Number(digits[2]) >= 5 ? 1 : 0);
  if (!Number.isFinite(cents)) return 0;
  return sign === '-' || sign === '−' ? -cents : cents;
}

/** A percentage in decimal text → basis points (integer). */
export function parseBasisPoints(text: string): number {
  return roundHalfAway(parseDecimal(text) * 100);
}

/** `round(base × rate)` with `rate` in basis points. */
export function percentOf(baseMinor: number, rateText: string): number {
  return roundHalfAway((baseMinor * parseBasisPoints(rateText)) / 10_000);
}

/** One line, rounded once: quantity (which may be fractional) times the rate in minor units. */
export function lineMinor(item: Pick<LineItem, 'qty' | 'rate'>): number {
  return roundHalfAway(parseDecimal(item.qty) * parseMinor(item.rate));
}

export interface Totals {
  /** Per item, in `items` order. */
  lines: number[];
  subtotal: number;
  discount: number;
  taxBase: number;
  tax: number;
  total: number;
}

export function totalsOf(body: Pick<InvoiceBody, 'items' | 'taxRate' | 'discountRate'>): Totals {
  const lines = body.items.map(lineMinor);
  const subtotal = lines.reduce((sum, line) => sum + line, 0);
  const discount = percentOf(subtotal, body.discountRate);
  const taxBase = subtotal - discount;
  const tax = percentOf(taxBase, body.taxRate);
  return { lines, subtotal, discount, taxBase, tax, total: taxBase + tax };
}

/** Each component on the ladder's own base (O25). */
export function taxBreakdown(taxBase: number, lines: readonly TaxLine[]): { label: string; rate: string; amount: number }[] {
  return lines.map((line) => ({ label: line.label, rate: line.rate, amount: percentOf(taxBase, line.rate) }));
}

/** The multi-currency row (comp 1698): the total times the typed rate, rounded to that currency's minor unit. */
export function fxMinor(totalMinor: number, rateText: string): number {
  return roundHalfAway(totalMinor * parseDecimal(rateText));
}

/**
 * The comp's `fmt` (1332): `en-US` grouping, the symbol before the figure, a
 * typographic minus, and no decimals when the document hides them.
 */
export function formatMoney(minor: number, currency: string, cents: boolean): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const major = cents ? abs / 100 : Math.round(abs / 100);
  const figure = major.toLocaleString('en-US', {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
  return `${negative ? '−' : ''}${currency}${figure}`;
}

/** The comp's `(Number(rate) || 0) + '%'` (1613). */
export function formatPercent(text: string): string {
  const value = parseDecimal(text);
  return `${Number.isInteger(value) ? String(value) : String(value)}%`;
}
