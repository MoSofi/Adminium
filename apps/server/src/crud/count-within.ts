// SPDX-License-Identifier: AGPL-3.0-only
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';

/**
 * `COUNT(*)` of one table within a time budget, or null.
 *
 * A missing number is honest and a slow page is not: a table too large to
 * count in the budget shows no figure rather than holding the screen. The
 * snapshot's own estimate is the introspection's reading of the engine's
 * statistics — null on SQLite, and stale everywhere the moment rows are
 * written — so a screen that states how many rows a table HOLDS asks here.
 */
export async function countWithin(db: Kysely<SourceDatabase>, tableId: string, budgetMs: number): Promise<number | null> {
  const query = (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
    .selectFrom(tableId)
    .select((eb) => eb.fn.countAll<number | string | bigint>().as('n'))
    .executeTakeFirst()
    .then((row) => (row === undefined ? null : Number(row.n)))
    .catch(() => null);
  const budget = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), budgetMs).unref?.();
  });
  return Promise.race([query, budget]);
}
