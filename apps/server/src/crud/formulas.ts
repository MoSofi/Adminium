// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FORMULA — the values Adminium works out from the other columns of a row,
 * and the places every decimal keeps.
 *
 *     FILL → RESOLVE → DECIDE → before hooks → FORMULA → CHECK → statement
 *
 * It runs after the hooks, so what a hook changed is what a formula reads,
 * and nothing a hook sets survives in a formula column: the column is dropped
 * from every writer's values before the hooks (`withoutReadOnly`) and filled
 * here. On an update it reads the STORED row with the new values over it, so
 * a change of `qty` alone still has the `rate` it multiplies.
 *
 * Two things happen, in this order:
 *
 *  - SCALE: every decimal the write sends, in a column with a scale rule, is
 *    rounded to that scale — half away from zero, exactly, never through a
 *    float. `currency` means the decimals of the row's OWN `currency` column
 *    (JPY 0, EUR 2, KWD 3) when the table has one, else the connection's,
 *    else 2: a document keeps the places of the currency it was written in,
 *    whatever the connection says later.
 *  - FORMULAS: each formula column the write touches — every one on a create,
 *    and on an update each whose inputs changed, directly or through another
 *    formula — worked out with the manifest's own evaluator, in dependency
 *    order, at its scale. One implementation for the server and an app's demo.
 *
 * A formula that reads a total over child rows (a document's `tax` over its
 * `subtotal`) is worked out again inside the settle that moves the total, so
 * it never reads a total the next line has already changed.
 */
import { currencyScale, evaluateFormula, ratioText, toRatio } from '@adminium/manifest';

import type { ColumnFormula, Scale, TableRules } from './column-rules.js';
import type { Row } from './mask.js';
import type { WriteAction } from './write-context.js';

const has = (values: Row, column: string) => Object.prototype.hasOwnProperty.call(values, column);

/**
 * The places `scale` means for this row. `currency` reads the row's own
 * currency column first: a later change of the connection's currency must
 * never re-round a document written in another.
 */
export function placesFor(scale: Scale, row: Row, currencyColumn: string | undefined, connectionCurrency: string | null): number {
  if (typeof scale === 'number') return scale;
  const own = currencyColumn === undefined ? null : row[currencyColumn];
  if (typeof own === 'string' && own.trim() !== '') return currencyScale(own.trim());
  return currencyScale(connectionCurrency);
}

/** A number rounded to `places` as decimal text, or the value untouched when it is not a number (CHECK refuses it). */
export function rounded(value: unknown, places: number): unknown {
  if (value === null || value === undefined || value === '') return value;
  const exact = toRatio(value);
  return exact === null ? value : ratioText(exact, places);
}

/** Whether the table has anything for this step to do. */
export function worksOut(rules: TableRules | null): boolean {
  return (rules?.formulas?.length ?? 0) + (rules?.scales?.length ?? 0) > 0;
}

/**
 * The formulas an update touches: each whose inputs are among the written
 * columns, and each that reads one of those — in dependency order.
 */
export function touchedFormulas(formulas: readonly ColumnFormula[], written: Iterable<string>): ColumnFormula[] {
  const moved = new Set(written);
  const out: ColumnFormula[] = [];
  for (const formula of formulas) {
    if (!formula.reads.some((column) => moved.has(column))) continue;
    out.push(formula);
    moved.add(formula.column);
  }
  return out;
}

/** Work formulas out over `row`, in order, each result read by the ones after it. The results, as decimal text or null. */
export function evaluateAll(
  formulas: readonly ColumnFormula[],
  row: Row,
  currencyColumn: string | undefined,
  connectionCurrency: string | null,
): Row {
  const working: Row = { ...row };
  const out: Row = {};
  for (const formula of formulas) {
    const value = evaluateFormula(formula.expr, working, placesFor(formula.scale, working, currencyColumn, connectionCurrency));
    working[formula.column] = value;
    out[formula.column] = value;
  }
  return out;
}

/**
 * The FORMULA step: the write's values with every scaled decimal rounded and
 * every touched formula worked out. `stored` is the row as it is (an update);
 * null for a create. The same object when there is nothing to do.
 */
export function workOut(
  rules: TableRules | null,
  action: WriteAction,
  values: Row,
  stored: Row | null,
  connectionCurrency: string | null,
): Row {
  if (rules === null || action === 'delete' || !worksOut(rules)) return values;
  let out: Row | null = null;
  const currencyColumn = rules.currencyColumn;
  const base = (): Row => ({ ...(stored ?? {}), ...(out ?? values) });
  for (const { column, scale } of rules.scales ?? []) {
    if (!has(values, column)) continue;
    // A formula column is filled below, at its own scale.
    if ((rules.formulas ?? []).some((formula) => formula.column === column)) continue;
    const next = rounded(values[column], placesFor(scale, base(), currencyColumn, connectionCurrency));
    if (next === values[column]) continue;
    out ??= { ...values };
    out[column] = next;
  }
  // An update of a row nobody could read matches nothing: it works nothing out.
  const formulas =
    action === 'create' ? (rules.formulas ?? []) : stored === null ? [] : touchedFormulas(rules.formulas ?? [], Object.keys(values));
  if (formulas.length > 0) {
    out ??= { ...values };
    Object.assign(out, evaluateAll(formulas, base(), currencyColumn, connectionCurrency));
  }
  return out ?? values;
}
