// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Exact fixed-point decimal arithmetic over BigInt — the money law for derived
 * columns.
 *
 * WHY THIS EXISTS AT ALL. Every aggregate Postgres and MySQL return arrives as
 * a JS **string**, `count` included, and no dialect in this tree configures a
 * driver type parser. A decimal string is not an inconvenience to be coerced
 * away — it is the only lossless carrier: measured, `Intl.NumberFormat`
 * formats `'1234567890123456789.55'` exactly and the same value routed through
 * `Number()` renders `…800.00`. So values cross the wire as canonical decimal
 * strings and all arithmetic between them happens here, in integers.
 *
 * THE REPRESENTATION. A {@link Decimal} is a `bigint` holding the value scaled
 * by 10^{@link WORKING_SCALE} — `1266.00` is `1266000000n`. Six digits is the
 * working width for every intermediate, which makes this module's contract
 * three sentences long:
 *
 * 1. A driver string carrying more than six decimals is rounded to six **on
 *    entry, once** ({@link parseDecimal}). `avg(rate)` on real data returns
 *    sixteen; the discount fold returns twenty. "Parse the decimal string"
 *    does not say what to do with digit seven, so this does.
 * 2. Intermediates are carried at the working width — never at a field's
 *    declared `scale`. A field that reads an earlier field reads its
 *    **unrounded** working value; rounding twice is how `1.0049 × 3` becomes
 *    `3.00` instead of `3.01`.
 * 3. Rounding is half-up **away from zero**, and happens on output only
 *    ({@link formatDecimal}, {@link roundDecimal}).
 *
 * WHY BIGINT AND NOT A LIBRARY. There is no decimal dependency in the
 * lockfile and adding one is a locked-stack change. Eight operations over
 * integers is less code than the adapter would be.
 *
 * WHAT THIS IS NOT. It is a DISPLAY arithmetic with one declared rounding, not
 * the ledger arithmetic of a document of record: `packages/invoices/src/money.ts`
 * stays authoritative there, and the two numbers may legitimately differ by cents
 * on a many-line invoice because a stored `line_total` rounds per line while a
 * fold over the gross does not.
 *
 * Pure: imports nothing, touches no locale, allocates no `Intl` object. Lives
 * in the page-config leaf so the server (through `@adminium/engine/config`),
 * the dashboard binding and the Studio live preview run the identical code —
 * one money law, one implementation (D3/D4).
 */

/**
 * Digits of working precision every intermediate is carried at.
 *
 * Six, not two: `tax_rate/100` on a 0–100 percent needs four to stay exact,
 * and a `qty × rate` fold on `numeric(10,2) × numeric(12,2)` lands at four
 * before any factor is applied. Two would round the inputs of the arithmetic
 * rather than its result. Not more than six, because this is also the
 * truncation point for driver strings (rule 1 above) and every extra digit is
 * a digit of somebody's `avg()` that has to be justified.
 */
export const WORKING_SCALE = 6;

/** 10^{@link WORKING_SCALE} — one unit of the representation. */
const WORKING_UNIT = 1_000_000n;

/**
 * A fixed-point decimal: an integer count of 10^-{@link WORKING_SCALE} units.
 *
 * Deliberately a bare `bigint` rather than a branded wrapper — the whole point
 * is that `+`/`-` on two of these are already correct, and a brand that has to
 * be cast away at every arithmetic site buys nothing a comment cannot say.
 */
export type Decimal = bigint;

/** The additive identity, and what an empty `sum` fold reads as (D18). */
export const DECIMAL_ZERO: Decimal = 0n;

/**
 * The widest input this module will read.
 *
 * A guard on work, not on ambition: without it `'1e1000000'` would build a
 * million-digit BigInt inside a per-row loop. Sixty integer digits is past
 * every money value that exists and short enough that the parse stays O(1) in
 * practice; anything wider is answered `null` (unreadable), never silently
 * truncated to something that looks like a number.
 */
const MAX_INTEGER_DIGITS = 60;

const POW10: readonly bigint[] = Array.from({ length: 70 }, (_, i) => 10n ** BigInt(i));

function pow10(exponent: number): bigint {
  const cached = POW10[exponent];
  return cached ?? 10n ** BigInt(exponent);
}

/**
 * `n / d`, rounded half-up away from zero. The single rounding primitive —
 * every other rounding in this module funnels through it, so "half-up away
 * from zero" is stated in exactly one place and cannot drift between
 * multiplication, division and serialization.
 */
function divRoundHalfUpAway(n: bigint, d: bigint): bigint {
  let num = n;
  let den = d;
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const negative = num < 0n;
  const abs = negative ? -num : num;
  const quotient = abs / den;
  const remainder = abs % den;
  const rounded = remainder * 2n >= den ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/**
 * The accepted decimal-string grammar, wide enough for what drivers actually
 * hand back: an optional sign, digits with an optional fractional part, and an
 * optional exponent — SQLite returns JS numbers, and `String(1e21)` is
 * `'1e+21'`, so exponent form is a driver reality, not a convenience.
 */
const NUMERIC_INPUT = /^([+-]?)(?=[0-9]|\.[0-9])([0-9]*)(?:\.([0-9]*))?(?:[eE]([+-]?[0-9]+))?$/;

/**
 * Read a driver value into the working representation, rounding to
 * {@link WORKING_SCALE} half-up away from zero **once, here**.
 *
 * TAKES A DRIVER VALUE, NOT A {@link Decimal}. A `Decimal` is itself a bigint,
 * and a bigint is read here as a whole number of UNITS — so passing a parsed
 * value back through this function scales it by 10^{@link WORKING_SCALE} a
 * second time. Format a `Decimal`; never re-parse one.
 *
 * Answers `null` — never `0` — for anything it cannot read: `null`/`undefined`
 * (the column was NULL, or masking removed it), a non-finite number, a
 * malformed string, a value wider than {@link MAX_INTEGER_DIGITS}. Callers
 * must keep that distinction: `null` is "no number", which absorbs through
 * arithmetic and renders as an em-dash, while `0` is a real answer a fold
 * legitimately produced.
 */
export function parseDecimal(input: unknown): Decimal | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'bigint') {
    return absoluteDigitsOf(input) > MAX_INTEGER_DIGITS ? null : input * WORKING_UNIT;
  }
  const raw =
    typeof input === 'number'
      ? Number.isFinite(input)
        ? String(input)
        : null
      : typeof input === 'string'
        ? input.trim()
        : null;
  if (raw === null || raw === '') return null;

  const match = NUMERIC_INPUT.exec(raw);
  if (match === null) return null;
  const sign = match[1] === '-' ? -1n : 1n;
  const intPart = match[2] ?? '';
  const fracPart = match[3] ?? '';
  const exponent = match[4] === undefined ? 0 : Number(match[4]);
  if (!Number.isSafeInteger(exponent)) return null;

  const digits = `${intPart}${fracPart}`;
  // The value is `digits × 10^-scale`; a positive exponent moves the point right.
  const scale = fracPart.length - exponent;
  if (digits.length - scale > MAX_INTEGER_DIGITS) return null;

  const shift = WORKING_SCALE - scale;
  if (shift >= 0) return sign * BigInt(digits) * pow10(shift);
  // More precision than we carry: round it away, once, here.
  const drop = -shift;
  if (drop > digits.length) return 0n;
  return sign * divRoundHalfUpAway(BigInt(digits), pow10(drop));
}

function absoluteDigitsOf(value: bigint): number {
  const abs = value < 0n ? -value : value;
  return abs.toString().length;
}

/**
 * Serialize to a canonical decimal string with exactly `scale` fraction
 * digits, rounding half-up away from zero.
 *
 * Exactly `scale` digits, not a trimmed shortest form: `'1234.50'` and
 * `'1234.00'` are what a money column must hand a formatter, and a trimmed
 * `'1234'` is where `maximumFractionDigits: Number.isInteger(x) ? 0 : 2`
 * came from — one column rendering `$1,234` above `$1,234.50`.
 */
export function formatDecimal(value: Decimal, scale: number = WORKING_SCALE): string {
  const width = clampScale(scale);
  const units = divRoundHalfUpAway(value, pow10(WORKING_SCALE - width));
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const digits = abs.toString().padStart(width + 1, '0');
  const whole = digits.slice(0, digits.length - width);
  const fraction = width > 0 ? `.${digits.slice(digits.length - width)}` : '';
  // `-0.00` is not a number anybody wants to read.
  return `${negative && abs !== 0n ? '-' : ''}${whole}${fraction}`;
}

function clampScale(scale: number): number {
  if (!Number.isInteger(scale)) return WORKING_SCALE;
  if (scale < 0) return 0;
  return scale > WORKING_SCALE ? WORKING_SCALE : scale;
}

/**
 * Quantize to `scale` decimals, half-up away from zero, **staying in the
 * working representation**.
 *
 * Used where a value must be rounded but still participate in arithmetic. It
 * is deliberately NOT what a `{field: x}` reference reads: D7 carries the
 * unrounded working value forward and rounds on serialization only.
 */
export function roundDecimal(value: Decimal, scale: number): Decimal {
  const unit = pow10(WORKING_SCALE - clampScale(scale));
  return divRoundHalfUpAway(value, unit) * unit;
}

export function addDecimal(a: Decimal, b: Decimal): Decimal {
  return a + b;
}

export function subDecimal(a: Decimal, b: Decimal): Decimal {
  return a - b;
}

/** Product at working precision — the scale-squared digits are rounded away once. */
export function mulDecimal(a: Decimal, b: Decimal): Decimal {
  return divRoundHalfUpAway(a * b, WORKING_UNIT);
}

/**
 * Quotient at working precision, or `null` for a zero divisor.
 *
 * `null` rather than a throw: a zero divisor cannot reach here from a valid
 * stored config (a field-level denominator must be a non-zero literal, D6),
 * so this branch is a belt on top of the braces, and a per-row read is the
 * wrong place to raise.
 */
export function divDecimal(a: Decimal, b: Decimal): Decimal | null {
  if (b === 0n) return null;
  return divRoundHalfUpAway(a * WORKING_UNIT, b);
}

/** `-1 | 0 | 1`, for the comparison operators of a conditional field. */
export function compareDecimal(a: Decimal, b: Decimal): -1 | 0 | 1 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
