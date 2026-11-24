// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which installed app a row's table belongs to, for text consent's scope: a
 * yes given on a row of one app's tables counts for that app's texts alone.
 *
 * Read by the one name the app's own record of the table gives, as "Send a
 * text" finds the app of a record. Built once for `compose.ts`, so the
 * consent service needs nothing of connections or snapshots.
 */
import { appTablesRepo, realTableOf, type ConsentPerson, type MetaDb } from '@adminium/meta';

import { tableOf } from '../privacy/sources.js';
import { factsViewFor } from '../routes/pages/column-facts.js';

export function appOfRow(meta: MetaDb): (person: ConsentPerson) => Promise<string | null> {
  return async (person) => {
    const view = await factsViewFor(meta, person.connectionId);
    if (view === null || !view.model.tables.some((one) => one.id === person.table)) return null;
    for (const record of await appTablesRepo(meta).forConnection(person.connectionId)) {
      if (record.role !== 'app' || record.state === 'released' || record.state === 'dropped' || record.state === 'pending') continue;
      if (tableOf(view, realTableOf(record))?.id === person.table) return record.appKey;
    }
    return null;
  };
}
