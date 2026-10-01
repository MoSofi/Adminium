// SPDX-License-Identifier: AGPL-3.0-only
import type { DatabaseModel } from '@adminium/engine';

import type { ConnectionManager } from '../connections/manager.js';
import { countWithin } from '../crud/count-within.js';

/** How long the app page waits for one table's row count before showing the estimate. */
export const APP_TABLE_COUNT_BUDGET_MS = 400;

/**
 * How many rows each of an app's tables HOLDS, counted now, by table name.
 *
 * The snapshot's estimate is what the install saw — empty tables — and no
 * engine's statistics move when sample data lands, so the app page read
 * "0 rows" under 443 rows of a menu. Counted side by side within a budget
 * each; a table missing from the answer (too large to count in the budget, a
 * connection that will not open) falls back to the estimate at the caller.
 */
export async function liveRowCounts(
  manager: ConnectionManager,
  connectionId: string,
  model: DatabaseModel,
  tableNames: readonly string[],
  budgetMs: number = APP_TABLE_COUNT_BUDGET_MS,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const handle = await manager.data(await manager.mustFind(connectionId));
    await Promise.all(
      tableNames.map(async (name) => {
        const id = model.tables.find((table) => table.name === name)?.id;
        if (id === undefined) return;
        const count = await countWithin(handle.db, id, budgetMs);
        if (count !== null) out.set(name, count);
      }),
    );
  } catch {
    // A connection that cannot be opened shows the estimates it has.
  }
  return out;
}
