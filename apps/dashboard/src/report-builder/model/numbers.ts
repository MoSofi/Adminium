// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two figures this surface computes and the three it formats
 * (43-report-builder.md D11).
 *
 * THIS IS NOT AN INVOICE'S MONEY LAW. There is no ladder here — no subtotal,
 * no discount, no tax base, no total (43 §5 item 4). One multiply exists: the
 * multi-currency row's `sym + amount × rate` (comp 618). It is done in
 * INTEGER MINOR UNITS with one half-away-from-zero rounding, copied from
 * `invoices/model/money.ts`'s `parseMinor`/`roundHalfAway`, because
 * `48200 × 0.92` in floats is `44344.000000000007` and a document of record
 * must not drift between a save and a reload.
 *
 * THE COMP'S `toLocaleString('en-US')` (618) BECOMES THE VIEWER'S LOCALE.
 * That is the porting checklist's step (16 §5 step 2), not a departure: the
 * comp hard-codes one locale because it has no viewer.
 */

/** Half away from zero — `Math.round` alone sends −0.5 to −0. */
export function roundHalfAway(value: number): number {
  const rounded = Math.round(Math.abs(value));
  return value < 0 ? -rounded : rounded;
}

const DECIMAL = /^([+−-]?)(\d*)(?:[.,](\d*))?$/;

/**
 * Decimal text → a number; anything unparseable is 0 (the comp's
 * `Number(x) || 0`, 618). Accepts a comma as the decimal mark and the
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

/** The multi-currency row (comp 618): the base amount times the typed rate, in that currency's minor units. */
export function fxMinor(amountText: string, rateText: string): number {
  return roundHalfAway(parseMinor(amountText) * parseDecimal(rateText));
}

/** `sym + figure`, two decimals, grouped in the viewer's locale (comp 618). */
export function formatFx(minor: number, sym: string, locale: string): string {
  const negative = minor < 0;
  const figure = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(minor) / 100);
  return `${negative ? '−' : ''}${sym}${figure}`;
}

/** A plain integer, grouped in the viewer's locale — the loyalty balance and points earned (comp 618). */
export function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** The comp's `(Number(b.lateRate) || 0) + '%'` (618). */
export function formatRatePercent(text: string): string {
  return `${String(parseDecimal(text))}%`;
}
