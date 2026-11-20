// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE TOTALS, WORKED OUT AGAIN: when a reviews add-on is installed or
 * updated, every total of its database is rebuilt from the published
 * reviews (`recountTotals`). The totals move with every change of a review's
 * state, in its own transaction; this is the repair, should one ever have
 * been written around Adminium.
 */
import type { MetaDb } from '@adminium/meta';
import type { Kysely } from 'kysely';

import type { AddOnInstalls } from '../apps/table-ref.js';
import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { recountTotals, reviewTablesOn } from './tables.js';

/** Rebuilds the totals of one add-on's reviews on one database; nothing when it keeps none there. */
export async function recountReviewsOf(deps: { meta: MetaDb; manager: Pick<ConnectionManager, 'data'>; installs: () => Promise<AddOnInstalls> }, connectionId: string, addOnKey: string): Promise<void> {
  const keeper = reviewTablesOn(await deps.installs(), connectionId).find((one) => one.addOn === addOnKey);
  if (keeper === undefined) return;
  const view = await loadSnapshotView(deps.meta, connectionId);
  const reviews = view.linkTable(keeper.reviews);
  const totals = view.linkTable(keeper.totals);
  if (reviews === null || totals === null) return;
  const { db, dialect } = await deps.manager.data(connectionId);
  await recountTotals(db as Kysely<SourceDatabase>, dialect, reviews, totals);
}
