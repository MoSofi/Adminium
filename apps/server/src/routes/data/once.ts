// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A NEW ROW'S MONEY CODE, HANDED TO ITS MAKER ONCE.
 *
 * A row that carries a money code (a gift card's) is read afterwards without
 * it by most roles: the code is shown in full exactly once. The person who
 * made the row is that once — whatever their role reads, the reply of their
 * own save carries the code of each coded row it made, with a print token
 * good for one draw of that row's document within ten minutes.
 *
 * Only on a signed-in person's own create through the staff routes: the
 * single create, a create with its rows, and each row made one by one.
 * Never on an import, a sample load, a bulk create, a change, a public
 * route, or a row a posting inserted.
 */
import { z } from 'zod';

import type { ResolvedTable } from '../../crud/identifiers.js';
import type { Row } from '../../crud/mask.js';
import { moneyCodeColumns } from '../../documents/money-code.js';
import { printRow, printStore, type PrintStore } from '../../documents/print-tokens.js';

export const onceEntrySchema = z.object({
  /** The table the row was made in, and the row's key. */
  table: z.string(),
  key: z.string(),
  column: z.string(),
  /** The code, as the save stored it. */
  value: z.string(),
  /** The token the document route's `once` takes: one print of this row, by this person. */
  print: z.string(),
});
export type OnceEntry = z.infer<typeof onceEntrySchema>;

/** The `once` entries for the rows a save inserted, or undefined when none carries a money code (or nobody is signed in). */
export function onceFor(connectionId: string, userId: string | null, made: readonly { table: ResolvedTable; row: Row }[], store: PrintStore = printStore): OnceEntry[] | undefined {
  if (userId === null || made.length === 0) return undefined;
  const out: OnceEntry[] = [];
  for (const { table, row } of made) {
    if (table.primaryKey.length !== 1) continue;
    const columns = moneyCodeColumns(table.table);
    const keyColumn = table.primaryKey[0]!;
    const key = row[keyColumn];
    // (A table keyed by its own code names the code in every address: it gets no entry.)
    if (columns.length === 0 || columns.includes(keyColumn) || key === null || key === undefined) continue;
    let print: string | undefined;
    for (const column of columns) {
      const value = row[column];
      if (typeof value !== 'string' || value === '') continue;
      print ??= store.mintToken(userId, printRow(connectionId, table.id, key));
      out.push({ table: table.id, key: String(key), column, value, print });
    }
  }
  return out.length === 0 ? undefined : out;
}
