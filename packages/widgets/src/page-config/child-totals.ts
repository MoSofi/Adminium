// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A LIST OF LINES ADDS UP TO.
 *
 * ─── Why the fold is here and not in the expression language ───────────────
 *
 * `FieldExpr` (crud-derived.ts) has six leaves and two combinators and no way
 * to say "sum this over N rows". Adding one would not be a small change: the
 * same tree is compiled into SQL by the server's `compute=`, so a `Σ over rows`
 * leaf would be a wire change, a server change and a Studio change — for a
 * block that only ever runs in a browser, over values that have not been saved
 * yet and therefore cannot be summed by a database at all.
 *
 * So one LINE's total is an ordinary expression, evaluated by the ordinary
 * evaluator, and the fold over lines is this file: `addDecimal`, the same exact
 * arithmetic, at the same working scale.
 *
 * ─── Nothing here is stored ────────────────────────────────────────────────
 *
 * A row total is written to the child's own column only when the field names a
 * column for it. A totals BLOCK is never stored: it is a reading of the lines,
 * and computing a number into a column that does not exist is the one thing a
 * totals block must not do.
 */
import {
  addDecimal,
  DECIMAL_ZERO,
  formatDecimal,
  mulDecimal,
  parseDecimal,
  roundDecimal,
  type Decimal,
} from './decimal.js';
import { evaluateDerivedFields, type DerivedRowInput } from './derive-eval.js';
import type { FieldExpr } from './crud-derived.js';

/** How many decimals a money total shows when the field does not say. */
export const DEFAULT_TOTALS_SCALE = 2;

export interface TotalsRowSpec {
  label: string;
  of: 'sum' | 'rate' | 'total';
  rate?: string | undefined;
}

export interface TotalsSpec {
  row?: { expr: unknown } | undefined;
  scale?: number | undefined;
  rows: readonly TotalsRowSpec[];
}

export interface TotalsResult {
  /** One line's own total, in the request's order, at the declared scale. */
  lines: string[];
  /** The block under the table: the label and the value, ready to render. */
  rows: { label: string; of: TotalsRowSpec['of']; value: string; emphasis: boolean }[];
}

/**
 * Every line's total and the block beneath them.
 *
 * `sum` adds the line totals. `rate` takes its cut of that SUM — never of the
 * running total, because a tax on a tax is a different number and nobody asked
 * for one. `total` is the sum plus every rate declared before it, which is what
 * makes the comp's three-row block (subtotal, tax, total) mean what it reads.
 */
export function computeTotals(
  spec: TotalsSpec,
  lines: readonly Readonly<Record<string, unknown>>[],
): TotalsResult {
  const scale = spec.scale ?? DEFAULT_TOTALS_SCALE;
  const expr = spec.row?.expr as FieldExpr | undefined;

  const values: Decimal[] = lines.map((line) => {
    if (expr === undefined) return DECIMAL_ZERO;
    const input: DerivedRowInput = { row: line };
    const out = evaluateDerivedFields([{ id: 'line', expr, scale: 6 }], input);
    return parseDecimal(out.values['line']) ?? DECIMAL_ZERO;
  });

  const sum = values.reduce<Decimal>((total, value) => addDecimal(total, value), DECIMAL_ZERO);

  let rates: Decimal = DECIMAL_ZERO;
  const rows = spec.rows.map((row) => {
    if (row.of === 'sum') {
      return { label: row.label, of: row.of, value: formatDecimal(roundDecimal(sum, scale), scale), emphasis: false };
    }
    if (row.of === 'rate') {
      const rate = parseDecimal(row.rate ?? '0') ?? DECIMAL_ZERO;
      const amount = mulDecimal(sum, rate);
      rates = addDecimal(rates, amount);
      return { label: row.label, of: row.of, value: formatDecimal(roundDecimal(amount, scale), scale), emphasis: false };
    }
    const total = addDecimal(sum, rates);
    return { label: row.label, of: row.of, value: formatDecimal(roundDecimal(total, scale), scale), emphasis: true };
  });

  return {
    lines: values.map((value) => formatDecimal(roundDecimal(value, scale), scale)),
    rows,
  };
}
