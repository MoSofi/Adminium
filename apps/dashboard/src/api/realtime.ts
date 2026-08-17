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
  if (event.channel === 'config-changed' && event.type === 'settings.defaults.updated') {
    // Global defaults changed (10-i18n-theming.md §7.2): re-resolve prefs for
    // sessions following a workspace default (bootstrap carries the resolved
    // axes) and refresh the Global Defaults admin page if it is open. Pages
    // are untouched — this event never changes page configs.
    void queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
    void queryClient.invalidateQueries({ queryKey: ['settings', 'defaults'] });
    // The "Set workspace defaults" onboarding step derives from this.
    void queryClient.invalidateQueries({ queryKey: ['onboarding'] });
    return;
  }

  if (event.channel === 'config-changed' && event.type === 'settings.branding.updated') {
    // White-label chrome (name, logo, version chip) is on every screen at
    // once, so a rebrand has to repaint open sessions rather than wait for
    // their next cold load. Nothing else derives from it — no bootstrap or
    // page invalidation here.
    void queryClient.invalidateQueries({ queryKey: ['branding'] });
    void queryClient.invalidateQueries({ queryKey: ['settings', 'workspace'] });
    return;
  }

  if (event.channel === 'config-changed') {
    void queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
    void queryClient.invalidateQueries({ queryKey: ['page'] });
    // Connecting/generating changes the reactive onboarding checklist too.
    void queryClient.invalidateQueries({ queryKey: ['onboarding'] });
    return;
  }

  // notifications:<userId> (M7 T6): fresh rows / read stamps → the sidebar
  // unread badge, the notification feed and the prefs matrix share the
  // ['notifications'] prefix.
  if (event.channel.startsWith('notifications:')) {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    return;
  }

  const match = TABLE_CHANNEL.exec(event.channel);
  if (match === null) return;
  const [, connectionId, table] = match as unknown as [string, string, string];
  void queryClient.invalidateQueries({ queryKey: ['data', connectionId, table] });
  void queryClient.invalidateQueries({ queryKey: ['widget-data'] });
}
