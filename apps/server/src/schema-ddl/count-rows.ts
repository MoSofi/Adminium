// SPDX-License-Identifier: AGPL-3.0-only
import { sql } from 'kysely';

import type { DataHandle } from '../connections/manager.js';
import { DEFAULT_REWRITE_REFUSE_ABOVE } from './preflight.js';

/**
 * A capped exact row count for one table, for preflight's rewrite gate.
 *
 * Capped at one past the refusal ceiling: below it the number is exact and the
 * consequence can say "250,000 rows will be rewritten"; a count that reaches
 * the cap has already proved the table is over the ceiling, and paying to count
 * the remaining rows of a 400-million-row table to render a dialog would be its
 * own outage.
 *
 * Errors are swallowed to `null`. A count is decoration on a plan; a table that
 * cannot be counted (a permission quirk, a lock) must not stop the operator
 * seeing the statements.
 */
export async function countTableRows(
  handle: DataHandle,
  tableId: string,
): Promise<{ value: number; capped: boolean } | null> {
  /*
   * QUALIFIED, because `public.orders` and `archive.orders` are different
   * tables and the DDL writes to the qualified one.
   *
   * This took the bare name, so on any database with more than one schema the
   * ceiling was measured against whichever `orders` the session's search_path
   * happened to resolve — an empty archive copy would have waved through a
   * rewrite of the live one. SQLite has no schemas to qualify with and MySQL's
   * "schema" IS the database the handle is already connected to, so both take
   * the bare name; only postgres qualifies.
   */
  const dot = tableId.lastIndexOf('.');
  const bare = tableId.slice(dot + 1);
  const schema = dot === -1 ? null : tableId.slice(0, dot);
  const q = (identifier: string): string =>
    handle.dialect === 'mysql'
      ? `\`${identifier.replace(/`/g, '``')}\``
      : `"${identifier.replace(/"/g, '""')}"`;
  const target =
    handle.dialect === 'postgres' && schema !== null ? `${q(schema)}.${q(bare)}` : q(bare);

  const cap = DEFAULT_REWRITE_REFUSE_ABOVE + 1;
  try {
    const result = await sql
      .raw<{ n: number | bigint | string }>(
        `SELECT count(*) AS n FROM (SELECT 1 AS one FROM ${target} LIMIT ${String(cap)}) AS capped`,
      )
      .execute(handle.db as never);
    const raw = result.rows[0]?.n ?? 0;
    const value = typeof raw === 'number' ? raw : Number(raw);
    /*
     * A count that came back unreadable is not a count. `Number('nonsense')` is
     * NaN, and every comparison against NaN is false — including
     * `value > refuseAbove`, which would silently open the ceiling.
     */
    if (!Number.isFinite(value)) return null;
    return { value, capped: value >= cap };
  } catch {
    /*
     * `null` means "could not establish the size", and preflight now REFUSES on
     * it rather than skipping the gate. It used to mean "no ceiling for this
     * table", which is the opposite.
     */
    return null;
  }
}
