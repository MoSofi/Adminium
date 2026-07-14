/**
 * Realtime event → TanStack Query invalidation map (09-generated-app.md §2.1
 * step 5, §4.1):
 *
 * - `config-changed` → `['bootstrap']` + every `['page', *]` (regeneration and
 *   nav edits propagate live without reload);
 * - `table:{connectionId}:{schema.table}` (CRUD mutation fan-out) →
 *   `['data', connectionId, table, *]` lists + the `['widget-data']` prefix;
 * - `widget-data:{connectionId}:{table}` publications → same as above.
 *
 * Pure function so the AppShell subscription stays a one-liner and the map is
 * unit-testable without a socket.
 */
import type { QueryClient } from '@tanstack/react-query';

import type { RealtimeEvent } from '../app/ws.js';

const TABLE_CHANNEL = /^(?:table|widget-data):([^:]+):(.+)$/;

export function invalidateForRealtimeEvent(queryClient: QueryClient, event: RealtimeEvent): void {
  if (event.channel === 'config-changed') {
    void queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
    void queryClient.invalidateQueries({ queryKey: ['page'] });
    return;
  }

  const match = TABLE_CHANNEL.exec(event.channel);
  if (match === null) return;
  const [, connectionId, table] = match as unknown as [string, string, string];
  void queryClient.invalidateQueries({ queryKey: ['data', connectionId, table] });
  void queryClient.invalidateQueries({ queryKey: ['widget-data'] });
}
