// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The desktop runtime chip's connection-health poll.
 *
 * ─── Why it lives in the shell and not in `studio/api.ts` ──────────────────
 *
 * It used to live there, beside the hub's own connection calls, and its only
 * consumer has always been `RuntimeChipHost` — which renders on the FIRST
 * PAINT. So one query function put the entire Studio API module (its DTOs, its
 * two dozen endpoints, its zod-adjacent types) into the entry chunk for every
 * user on every route, to serve a poll that is `enabled` only on desktop.
 *
 * The request is one line and it is the same endpoint the hub reads; what
 * matters is that the two use SEPARATE query keys, which is explained below.
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from '../app/api.js';
import type { ConnectionHealth } from './runtimeChipState.js';

/**
 * 11-electron.md §8.1's "lightweight connection-health poll" — the second of the
 * two feeds behind the desktop runtime chip (`shell/RuntimeChipHost.tsx`).
 *
 * It is the same `GET /api/v1/connections` the Studio hub reads, under a
 * SEPARATE query key, and the separation is the point. `['studio','connections']`
 * is the hub's: it is fetched when someone opens Studio and invalidated when
 * they act, which is right for a page and wrong for a badge that has to notice a
 * database going away while the user is somewhere else entirely. Sharing the key
 * would mean either polling the hub's data for every user who never opens it, or
 * a chip that only tells the truth on one route.
 *
 * "Lightweight" is the persisted-health part: the reply's `status` is the last
 * test's recorded outcome (`connections/schema.ts`), so this polls the meta
 * store, never the source databases. The chip cannot cause a connection storm —
 * and, honestly, cannot notice a database dying faster than something else
 * re-tests it.
 */
const CONNECTION_HEALTH_POLL_MS = 30_000;

export function connectionHealthQuery() {
  return queryOptions({
    queryKey: ['system', 'connection-health'] as const,
    queryFn: async () =>
      (await api.get<{ connections: ConnectionHealth[] }>('/api/v1/connections')).connections,
    /**
     * STOPS DEAD ON ERROR, and that is not a nicety. `GET /api/v1/connections`
     * is guarded by the Admin-only `system:connections:manage`, while the chip
     * that reads this renders in the topbar for EVERY signed-in user — so for an
     * Editor, a Viewer, or any of the §8.3 LAN users, this query's steady state
     * is 403. A plain interval would re-ask, and be refused, every 30 s for the
     * length of their session: a permanent background loop generating audit
     * noise and load to compute a badge they will never be shown.
     *
     * A 403 is not a flake. Nothing about waiting 30 s changes the answer, so
     * the poll stops until something invalidates the key.
     */
    refetchInterval: (query) => (query.state.error === null ? CONNECTION_HEALTH_POLL_MS : false),
    // A poll behind a badge must never escalate into a retry storm or a toast;
    // the previous answer is a better chip than no chip.
    retry: false,
  });
}
