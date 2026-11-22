// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Finding a person known only by phone, for the erasure.
 *
 * A source column holds a number however it was typed, so SQL cannot compare
 * it. Each value is read with `parsePhone` and kept only when its E.164 form
 * is exactly the number asked for. The fuzzy `samePhone` is not used: this
 * answers who a person IS, and a near match would empty a stranger's row.
 *
 * A batch at a time by primary key. A table with no key is not searched, as
 * the erasure cannot name a row of it. A value that is not text cannot match:
 * a numeric column has already lost its `+` and any leading zero.
 */
import { sql, type Kysely, type RawBuilder, type SqlBool } from 'kysely';

import type { SourceDatabase } from '../../connections/manager.js';
import type { ResolvedTable } from '../../crud/identifiers.js';
import { parsePhone } from '../../phone/index.js';

const BATCH = 500;

type Row = Record<string, unknown>;

/** Past this row in key order: `(a > x) or (a = x and b > y)`. */
function pastKey(primaryKey: readonly string[], last: Row): RawBuilder<SqlBool> {
  const branches = primaryKey.map((column, index) => {
    const equal = primaryKey.slice(0, index).map((before) => sql<SqlBool>`${sql.ref(before)} = ${last[before]}`);
    return sql<SqlBool>`(${sql.join([...equal, sql<SqlBool>`${sql.ref(column)} > ${last[column]}`], sql` and `)})`;
  });
  return sql<SqlBool>`(${sql.join(branches, sql` or `)})`;
}

export interface PhoneRowsQuery {
  db: Kysely<SourceDatabase>;
  table: Pick<ResolvedTable, 'id' | 'primaryKey'>;
  /** The column holding the number. */
  column: string;
  /** The exact number, from `parsePhone`. */
  e164: string;
  /** The business's country, to read a local number in. */
  country: string | null;
}

/** The primary keys of the rows holding exactly this number. */
export async function findRowsByPhone(query: PhoneRowsQuery): Promise<Row[]> {
  const { db, table, column, e164, country } = query;
  const primaryKey = table.primaryKey;
  if (primaryKey.length === 0) return [];
  const columns = [...new Set([...primaryKey, column])];
  const found: Row[] = [];
  let last: Row | undefined;
  for (;;) {
    let select = db
      .selectFrom(table.id as never)
      .select(columns as never)
      .where(sql<SqlBool>`${sql.ref(column)} is not null`);
    if (last !== undefined) select = select.where(pastKey(primaryKey, last));
    for (const key of primaryKey) select = select.orderBy(key as never, 'asc');
    const rows = (await select.limit(BATCH).execute()) as Row[];
    for (const row of rows) {
      const phone = parsePhone(row[column], country);
      if (phone.ok && phone.e164 === e164) found.push(Object.fromEntries(primaryKey.map((key) => [key, row[key]])));
    }
    if (rows.length < BATCH) return found;
    last = rows.at(-1);
  }
}
