// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SHOPPER'S LIST — what a list anyone reads (a catalogue entry a manifest
 * declares) lets a visitor ask, on top of what the entry shows.
 *
 *  - FILTERS: each column with its own operators (`eq`, `in`, `gte`, `lte`,
 *    `gt`, `lt`, as the entry names them), all of them ANDed: no `or`, no
 *    pattern of the visitor's own (`like`), an `in` of at most fifty values.
 *    The dashboard's grammar is wider; a stranger is given this much.
 *  - A FILTER THROUGH ANOTHER LIST (`via=`): conditions on the rows of
 *    another list anyone reads, whose rows point at this one (a product's
 *    variants). All of them compile to ONE `EXISTS` on that list's table,
 *    under that list's own fixed filters, so "Slate and M" holds on one
 *    variant, and an inactive variant the variants list does not show makes
 *    no product match.
 *
 * The search's minimum, its own bucket, the offset cap and the count are the
 * list route's (`routes/public/index.ts`), with the numbers in the manifest
 * package (`SHOPPER_*`).
 */
import type { Dialect } from '@adminium/engine';
import { SHOPPER_IN_MOST, type ShopperOp } from '@adminium/manifest';
import { sql, type Expression, type Kysely, type SqlBool } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import { compileFilter, type RecordFilter } from '../crud/filters.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';

/**
 * Whether a parsed filter asks only what a shopper may: every condition on a
 * column the list names, with one of that column's operators, ANDed; an `in`
 * a list of at most fifty values. False refuses the request.
 */
export function shopperAsks(filter: RecordFilter, ops: ReadonlyMap<string, ReadonlySet<ShopperOp>>): boolean {
  if ('or' in filter) return false;
  if ('and' in filter) return filter.and.every((child) => shopperAsks(child, ops));
  const allowed = ops.get(filter.column);
  if (allowed === undefined || !allowed.has(filter.op as ShopperOp)) return false;
  if (filter.op === 'in' && (!Array.isArray(filter.value) || filter.value.length > SHOPPER_IN_MOST)) return false;
  return true;
}

/**
 * The EXISTS a row of the list (selected by its own name, `outer`) passes
 * when ONE row of the other list's table points at it (`on`) and holds both
 * that list's own fixed filters and every condition the visitor sent. The
 * other table is aliased, so a column both tables have is the inner one's
 * inside the subquery; the fixed filters are the server's own and compare a
 * masked column as any other, the visitor's only what that list shows.
 */
export function throughCondition(input: {
  db: Kysely<SourceDatabase>;
  dialect: Dialect;
  view: SnapshotView;
  /** The list's own table, and the other list's. */
  table: ResolvedTable;
  through: ResolvedTable;
  /** The other table's link to this one. */
  on: string;
  /** The other list's fixed filters, as a request works them out. */
  fixed: RecordFilter | null;
  /** What the visitor asked of the other list's rows. */
  asked: RecordFilter;
}): (outer: string) => Expression<SqlBool> {
  const { db, dialect, view, table, through, on, fixed, asked } = input;
  const key = table.primaryKey[0];
  if (key === undefined || table.primaryKey.length !== 1) throw new Error('a list filtered through another has one key column');
  return (outer) => {
    const alias = 'adm_via';
    let sub = db
      .selectFrom(`${through.id} as ${alias}` as never)
      .select(sql.lit(1).as('one'))
      .where(sql.ref(`${alias}.${on}`), '=', sql.ref(`${outer}.${key}`));
    if (fixed !== null) {
      const own = { view, table: through, canReadPii: true, dynamic: db.dynamic, dialect };
      sub = sub.where((eb) => compileFilter(eb as never, own, fixed));
    }
    const visitor = { view, table: through, canReadPii: false, dynamic: db.dynamic, dialect };
    sub = sub.where((eb) => compileFilter(eb as never, visitor, asked));
    return sql<SqlBool>`exists ${sub}`;
  };
}
