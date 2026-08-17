// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Out-of-request SnapshotView loading (M7-T07): the export/import jobs and
 * routes need the same snapshot-allowlisted identifier resolution the data
 * routes use (08 §7 item 1), but run outside `dataRoutes`' request-scoped
 * cache. Same recipe: latest snapshot + active overrides → effective model.
 */

import { overridesRepo, snapshotsRepo, type MetaDb } from '@adminium/meta';
import type { DatabaseModel } from '@adminium/engine';

import { applyOverrides } from '../connections/effective-schema.js';
import { SnapshotView } from '../crud/identifiers.js';
import { NotFoundError } from '../errors.js';

export async function loadSnapshotView(meta: MetaDb, connectionId: string): Promise<SnapshotView> {
  const snapshot = await snapshotsRepo(meta).latest(connectionId);
  if (snapshot === null) {
    throw new NotFoundError('No schema snapshot — introspect the connection first.', { connectionId });
  }
  const active = await overridesRepo(meta).listForConnection(connectionId, { status: 'active' });
  return new SnapshotView(connectionId, applyOverrides(snapshot.schema as DatabaseModel, active));
}
