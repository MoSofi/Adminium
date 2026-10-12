// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LINK INTO AN ADD-ON'S TABLE, JUDGED AS IT IS WRITTEN.
 *
 * A column that links a row to an add-on's row (`addOnLink`: an order line's
 * stock item, a payment's gift card) has no foreign key behind it — the app
 * installs whether or not the add-on is there. So the database judges
 * nothing, and a write has to:
 *
 *  - while the add-on is NOT there for this table (not installed, or not
 *    connected to the app whose table it is) the link is inert, and a value
 *    for it is refused: a row that names an item nobody keeps could never be
 *    posted;
 *  - while it IS there, the value must be the key of a row of that table.
 *
 * An empty link is always taken. Rows brought in as history (an import, a
 * sample) keep whatever they name: the row it pointed at may be long gone.
 * The row is read plainly, on the write's own handle, never held.
 */
import { sql, type Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { FieldIssues, SoftLink, TableRules } from './column-rules.js';
import type { Row } from './mask.js';

type Db = Kysely<SourceDatabase>;

const empty = (value: unknown): boolean => value === null || value === undefined || value === '';

/** The link columns a write carries a value for. */
export function linksWritten(rules: Pick<TableRules, 'addOnLinks'> | null, values: Row): SoftLink[] {
  return (rules?.addOnLinks ?? []).filter((link) => Object.prototype.hasOwnProperty.call(values, link.column) && !empty(values[link.column]));
}

/** The first link written while its add-on is not there for this table, or null. */
export function inertLinkWritten(rules: Pick<TableRules, 'addOnLinks'> | null, values: Row): SoftLink | null {
  return linksWritten(rules, values).find((link) => link.tableId === null || link.key === null) ?? null;
}

/**
 * Whether a value could be a key of this kind at all. A text column may link
 * into an add-on whose keys are whole numbers: "12" finds row 12, and
 * "bench-desk" names no row — said here, because Postgres does not answer
 * that comparison with "no row" but with an error of its own.
 */
function couldBeKey(keyType: string | undefined, value: unknown): boolean {
  if (keyType === 'integer' || keyType === 'bigint') {
    if (typeof value === 'number') return Number.isSafeInteger(value);
    if (typeof value === 'bigint') return true;
    return typeof value === 'string' && /^-?\d{1,18}$/.test(value.trim());
  }
  if (keyType === 'decimal' || keyType === 'float') return typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim());
  if (keyType === 'uuid') return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
  return true;
}

/** Each link whose value names no row of the add-on's table: a field issue a form can mark. */
export async function softLinkIssues(db: Db, rules: Pick<TableRules, 'addOnLinks'> | null, values: Row): Promise<FieldIssues | null> {
  let issues: FieldIssues | null = null;
  for (const link of linksWritten(rules, values)) {
    if (link.tableId === null || link.key === null) continue;
    if (!couldBeKey(link.keyType, values[link.column])) {
      (issues ??= {})[link.column] = { code: 'not-found' };
      continue;
    }
    const found = await db
      .selectFrom(link.tableId as never)
      .select(sql<number>`1`.as('one'))
      .where(sql.ref(link.key), '=', values[link.column] as never)
      .limit(1)
      .executeTakeFirst();
    if (found === undefined) (issues ??= {})[link.column] = { code: 'not-found' };
  }
  return issues;
}
