// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The connections list, as every studio screen reads it. Its own module, so a
 * screen that Data connections opens (Save as app's wizard, from a workspace
 * row) can read it without importing Data connections back.
 */
import { queryOptions } from '@tanstack/react-query';

import { studioApi } from '../api.js';

export function connectionsQuery() {
  return queryOptions({
    queryKey: ['studio', 'connections'] as const,
    queryFn: () => studioApi.listConnections(),
  });
}
