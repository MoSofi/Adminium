// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /api/v1/setup/state`: whether this instance still needs its first
 * account. Its own module because the router reads it on every navigation, so
 * it is on the first paint; the wizard's calls (`setupApi.ts`) load with the
 * wizard. Shapes mirror apps/server src/routes/setup/schema.ts.
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from '../app/api.js';

export interface SetupState {
  /** True only on a never-bootstrapped instance (zero users AND no claim). */
  required: boolean;
  passwordMinLength: number;
  /**
   * A database was connected before anyone signed in (a project's
   * `databases`, or the first-boot source seed). Optional so a fixture, or a
   * server one release behind, that leaves it out reads as "not connected".
   */
  databaseConnected?: boolean;
  /**
   * The server printed a one-time setup token at boot and asks for it before
   * anything else (`server/src/setup/token.ts`). Optional for the same reason
   * as `databaseConnected`: absent reads as "not asked".
   */
  tokenRequired?: boolean;
}

export const SETUP_STATE_QUERY_KEY = ['setup', 'state'] as const;

export function setupStateQuery() {
  return queryOptions({
    queryKey: SETUP_STATE_QUERY_KEY,
    queryFn: async () => (await api.get<{ data: SetupState }>('/api/v1/setup/state')).data,
    // Setup state is a one-way door (required: true → false, never back), and
    // the route guards read it on every navigation — cache it for the session.
    staleTime: Infinity,
  });
}
