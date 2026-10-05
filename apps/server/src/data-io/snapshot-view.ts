// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Out-of-request SnapshotView loading: the export/import jobs and routes
 * need the same snapshot-allowlisted identifier resolution the data routes
 * use, but run outside `dataRoutes`' request-scoped cache. Same recipe:
 * latest snapshot + active overrides → effective model.
 */

import { optionListsRepo, overridesRepo, snapshotsRepo, type MetaDb } from '@adminium/meta';
import type { DatabaseModel } from '@adminium/engine';

import { addOnTablesFor } from '../apps/add-on-tables.js';
import { applyOverrides } from '../connections/effective-schema.js';
import { SnapshotView } from '../crud/identifiers.js';
import { NotFoundError } from '../errors.js';

/**
 * `lists`: also carry the values of each option list a rule names, so a
 * create checked against this view refuses a value its list does not hold —
 * as a person's create does. Custom lists only: a rule naming a built-in list
 * or one that is gone accepts anything, as it does on the data routes.
 */
export async function loadSnapshotView(meta: MetaDb, connectionId: string, opts: { lists?: boolean } = {}): Promise<SnapshotView> {
  const snapshot = await snapshotsRepo(meta).latest(connectionId);
  if (snapshot === null) {
    throw new NotFoundError('No schema snapshot — introspect the connection first.', { connectionId });
  }
  const active = await overridesRepo(meta).listForConnection(connectionId, { status: 'active' });
  const model = snapshot.schema as DatabaseModel;
  const effective = applyOverrides(model, active, { addOnTables: await addOnTablesFor(meta, connectionId, model) });
  if (opts.lists !== true) return new SnapshotView(connectionId, effective);
  const values = new Map<string, readonly string[]>();
  for (const row of active) {
    const key = row.op === 'column.options' ? (row.value as { list?: unknown }).list : undefined;
    if (typeof key !== 'string' || values.has(key)) continue;
    const stored = await optionListsRepo(meta).findByKey(key);
    if (stored !== null) values.set(key, stored.items.map((item) => item.value));
  }
  return new SnapshotView(connectionId, effective, values);
}
