// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ORDER WORKED OUT IN MEMORY — pure.
 *
 * What an order's own figures would be with other reductions on its lines:
 * each line's formulas that read what was put in, the order's totals added up
 * from those lines exactly as a settle adds them up, then the order's own
 * formulas and balances — the steps of a save, in a save's order, on copies.
 * Nothing is read and nothing is written: the rows are handed in.
 *
 * Two questions are answered from it. A discount tried before it is saved
 * (what would this order cost?), and what a return gives back (the order as
 * it would be with the returned things gone, against the order as it is).
 */
import { ratioText, rollupValue, toRatio } from '@adminium/manifest';

import type { RollupInto, TableBalance, TableRules } from '../column-rules.js';
import { evaluateAll, placesFor, touchedFormulas } from '../formulas.js';
import type { Row } from '../mask.js';
import { sameValue } from '../write-values.js';

/** A row under the order, of one of its child tables, with the rules of that table. */
export interface FiguredRow {
  /** The child table's id. */
  table: string;
  /** The column that links the row to the order, as the rows were read: a total kept through another link is not theirs to add up. */
  via?: string | undefined;
  rules: TableRules | null;
  row: Row;
  /** Columns put in place of the stored ones before anything is worked out (a reduction, a quantity kept). */
  overlay?: Row | undefined;
}

export interface OrderFigures {
  /** The order's row with its totals, formulas and balances worked out again. */
  order: Row;
  /** Each row handed in, in the same order, with its formulas worked out again. */
  rows: Row[];
}

/** Whether a child row is one a total adds up — as the settle's own statement asks: its `unlessSet` column empty, its `where` held. */
function counted(rollup: Pick<RollupInto, 'unlessSet' | 'where'>, row: Row): boolean {
  if (rollup.unlessSet !== undefined && row[rollup.unlessSet] !== null && row[rollup.unlessSet] !== undefined) return false;
  return rollup.where === undefined || sameValue(row[rollup.where.column], rollup.where.eq);
}

/** A balance: what it is of, less its total and everything else taken from it. An empty part counts as nothing. */
function balanceOf(balance: TableBalance, row: Row, places: number): string {
  const part = (column: string) => toRatio(row[column]) ?? { n: 0n, d: 1n };
  let left = part(balance.of);
  for (const column of [balance.total, ...balance.minus]) {
    const taken = part(column);
    left = { n: left.n * taken.d - taken.n * left.d, d: left.d * taken.d };
  }
  return ratioText(left, places);
}

/**
 * The order and its rows as they would stand. `orderRules`: the rules of the
 * order's table (its totals over child tables, its formulas, its balances).
 * A total over a child table none of whose rows was handed in — or kept
 * through another link than the one they were read by — is left as the order
 * holds it (what was paid is not part of the question). Only what
 * follows from what was put in is worked out again: a figure nothing reaches
 * stays as it is stored.
 */
export function orderFigures(input: { order: Row; orderRules: TableRules | null; rows: readonly FiguredRow[]; overlay?: Row | undefined; currency: string | null }): OrderFigures {
  const { orderRules, currency } = input;
  const rows = input.rows.map((one) => {
    const overlay = one.overlay ?? {};
    const row = { ...one.row, ...overlay };
    return { ...row, ...evaluateAll(touchedFormulas(one.rules?.formulas ?? [], Object.keys(overlay)), row, one.rules?.currencyColumn, currency) };
  });
  let order: Row = { ...input.order, ...(input.overlay ?? {}) };
  const moved = new Set(Object.keys(input.overlay ?? {}));
  /** Whether a row handed in is one this total is over: of its child table, read through the link the total adds up by. */
  const of = (rollup: RollupInto, one: FiguredRow): boolean => one.table === rollup.child && (one.via === undefined || one.via === rollup.via);
  for (const rollup of orderRules?.ownRollups ?? []) {
    if (!input.rows.some((one) => of(rollup, one))) continue;
    const under = rows.filter((row, index) => of(rollup, input.rows[index]!) && counted(rollup, row));
    const places = placesFor(rollup.scale, order, orderRules?.currencyColumn, currency);
    order[rollup.column] = rollupValue(under, { sum: rollup.sum, times: rollup.times, count: rollup.count }, places);
    moved.add(rollup.column);
  }
  order = { ...order, ...evaluateAll(touchedFormulas(orderRules?.formulas ?? [], moved), order, orderRules?.currencyColumn, currency) };
  for (const balance of orderRules?.balances ?? []) {
    order[balance.column] = balanceOf(balance, order, placesFor(balance.scale, order, orderRules?.currencyColumn, currency));
  }
  return { order, rows };
}
