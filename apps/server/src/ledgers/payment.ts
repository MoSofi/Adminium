// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A PAYMENT TOOK, AND WHAT IS STILL TO PAY.
 *
 * A row whose amount Adminium decides — a gift card paying for an order, as
 * far as it goes — is saved without one, and the save answers what it came
 * to: the amount decided for the request's first such row, what is still due
 * once every row of the request is in (the column the row's rule maps as
 * `due`, read after the save's last settle), and — for somebody who may read
 * the rows the ledger wrote — the balance the payment left behind. Nothing
 * else of the ledger leaves through this: no card, no code, no row.
 */
import { ratioText, toRatio } from '@adminium/manifest';

import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { PostedOutcome } from '../crud/ledger-write.js';
import type { Row } from '../crud/mask.js';
import { placesOfColumn } from '../routes/public/tree.js';

export interface PaymentAnswer {
  amount: string;
  due: string;
  balanceAfter?: string;
}

/** A row the request wrote, as the save left it. */
export interface PaidRow {
  table: ResolvedTable;
  row: Row;
}

const keyText = (table: ResolvedTable, row: Row): string => table.primaryKey.map((column) => String(row[column])).join('/');
const money = (view: SnapshotView, table: ResolvedTable, column: string, value: unknown): string | null => {
  const ratio = toRatio(value);
  return ratio === null ? null : ratioText(ratio, placesOfColumn(view, table, column));
};

/**
 * The payment a save decided, or undefined when it decided none (or its rule
 * maps nothing as `due`). `rows`: what the request wrote, in its order, each
 * as the save left it. `parentOf`: a row above one of them that the request
 * did not write (the order a payment was added to), read after the save.
 * `balanceAfter` is answered apart: the door says who may hear it.
 */
export async function paymentOf(input: {
  view: SnapshotView;
  rows: readonly PaidRow[];
  outcomes: readonly PostedOutcome[] | undefined;
  parentOf: (table: ResolvedTable, key: unknown) => Promise<Row | null>;
}): Promise<{ payment: { amount: string; due: string }; balanceAfter?: string; wrote: readonly ResolvedTable[] } | undefined> {
  const { view } = input;
  for (const written of input.rows) {
    for (const posting of written.table.table?.postings ?? []) {
      const key = keyText(written.table, written.row);
      for (const outcome of input.outcomes ?? []) {
        if (outcome.posting !== posting.id) continue;
        // The row's own call (it is the source), or a call for the row as a line of the one it hangs under.
        const own = outcome.record !== undefined && outcome.record.table.id === written.table.id && keyText(written.table, outcome.record.pk) === key;
        const decided = outcome.decided.filter((entry) => (own ? entry.line === '' || entry.line === key : entry.line === key));
        const amount = decided.find((entry) => entry.input === 'amount');
        if (amount === undefined) continue;
        const mapped = posting.map['due'];
        let due: string | null = null;
        if (typeof mapped === 'string') due = money(view, written.table, mapped, written.row[mapped]);
        else if (mapped !== null && typeof mapped === 'object' && 'parent' in mapped && typeof mapped.parent === 'string' && typeof posting.via === 'string') {
          const link = view.model.relations.find((r) => r.through === null && r.from.tableId === written.table.id && r.from.columns.length === 1 && r.from.columns[0] === posting.via && r.to.columns.length === 1);
          const parentTable = link === undefined ? null : view.table(link.to.tableId);
          const parentKey = written.row[posting.via];
          if (parentTable !== null && link !== undefined && parentKey !== null && parentKey !== undefined) {
            // The row above, as the request left it when it wrote it too; else as it stands after the save.
            const among = input.rows.find((candidate) => candidate.table.id === parentTable.id && String(candidate.row[link.to.columns[0]!]) === String(parentKey));
            const parent = among?.row ?? (await input.parentOf(parentTable, parentKey));
            if (parent !== null) due = money(view, parentTable, mapped.parent, parent[mapped.parent]);
          }
        }
        if (due === null) continue;
        const paid = money(view, written.table, amount.column, amount.value) ?? amount.value;
        const after = decided.find((entry) => entry.input === 'balance_after' || entry.input === 'balanceAfter');
        const left = after === undefined ? null : (money(view, written.table, after.column, after.value) ?? after.value);
        return { payment: { amount: paid, due }, ...(left === null ? {} : { balanceAfter: left }), wrote: [...new Map(outcome.written.map((one) => [one.table.id, one.table])).values()] };
      }
    }
  }
  return undefined;
}
