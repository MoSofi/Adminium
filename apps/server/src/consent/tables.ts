// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The source tables the consent door reads and writes: a connection's
 * current schema (the same cache the public routes and the payments read)
 * and its data connection.
 */
import type { MetaDb } from '@adminium/meta';

import type { ConnectionManager } from '../connections/manager.js';
import type { ResolvedTable } from '../crud/identifiers.js';
import { createPublicViews, type PublicViews } from '../public-api/runtime.js';
import type { ConsentTableSource } from './apply-column.js';

export function consentTableSource(deps: { meta: MetaDb; manager: Pick<ConnectionManager, 'data'>; views?: PublicViews | undefined }): ConsentTableSource {
  const views = deps.views ?? createPublicViews(deps.meta);
  return {
    async table(connectionId, name) {
      const view = await views.viewFor(connectionId);
      if (view === null) return null;
      let table: ResolvedTable;
      try {
        table = view.table(name);
      } catch {
        return null;
      }
      const { db, dialect } = await deps.manager.data(connectionId);
      return { view, table, db, dialect };
    },
  };
}
