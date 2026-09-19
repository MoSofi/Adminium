// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Realtime event → TanStack Query invalidation map:
 *
 * - `config-changed` → `['bootstrap']` + every `['page', *]` (regeneration and
 *   nav edits propagate live without reload), and the project queries; its
 * `project-changed` event is a rebuilt project;
 * - `table:{connectionId}:{schema.table}` (CRUD mutation fan-out) →
 *   `['data', connectionId, table, *]` lists + the `['widget-data']` prefix;
 * - `widget-data:{connectionId}:{table}` publications → same as above;
 * - `jobs:{jobId}` terminal events of an `email.campaign-run` job → the
 * `['email-templates']` prefix: a run that finished, failed or was cancelled
 *   changes a campaign's status pill and counts. The editor and the manager
 *   subscribe per run (`email/useRunProgress.ts`) and route every
 *   non-progress event through here, so this stays the one map.
 *
 * Pure function so the AppShell subscription stays a one-liner and the map is
 * unit-testable without a socket.
 */
import type { QueryClient } from '@tanstack/react-query';

import type { RealtimeEvent } from '../app/ws.js';

const TABLE_CHANNEL = /^(?:table|widget-data):([^:]+):(.+)$/;

/**
 * Everything a generic `config-changed` refreshes.
 *
 * Exported because a (re)connect must run it with no event to react to.
 * `app.realtime.publish` is fire-and-forget — one emit, no replay — so
 * anything published while this tab had no live subscription reached nobody:
 * the gap between a page's bootstrap fetch and its socket opening, or a
 * backoff window after a drop. `['bootstrap']` is `staleTime: Infinity`, so
 * nothing else ever refetches it, and a screen that read a stale payload (a
 * project page "not in the running build", a project cell reported as an
 * unknown widget) stays wrong until a reload rather than merely being late.
 * AppShell's `onStatusChange` calls this on every open — the same
 * at-least-once floor `resyncOverrides` already gives translations.
 */
export function invalidateConfigDependent(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
  void queryClient.invalidateQueries({ queryKey: ['page'] });
  // Connecting/generating changes the reactive onboarding checklist too.
  void queryClient.invalidateQueries({ queryKey: ['onboarding'] });
  // A project server's page edits, and its `project-changed` (code rebuilt
  // under `adminium dev`), change the project's actions and Studio's
  // overview. Rebuilt pages and widgets need nothing more: the bootstrap
  // lists them under new URLs, and open pages load those.
  void queryClient.invalidateQueries({ queryKey: ['project'] });
  void queryClient.invalidateQueries({ queryKey: ['studio', 'project'] });
}

export function invalidateForRealtimeEvent(queryClient: QueryClient, event: RealtimeEvent): void {
  if (event.channel === 'config-changed' && event.type === 'settings.defaults.updated') {
    // Global defaults changed: re-resolve prefs for
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
    invalidateConfigDependent(queryClient);
    return;
  }

  // notifications:<userId> (M7 T6): fresh rows / read stamps → the sidebar
  // unread badge, the notification feed and the prefs matrix share the
  // ['notifications'] prefix.
  if (event.channel.startsWith('notifications:')) {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    return;
  }

  if (event.channel.startsWith('jobs:') && event.type !== 'progress' && isCampaignRunEvent(event.data)) {
    void queryClient.invalidateQueries({ queryKey: ['email-templates'] });
    return;
  }

  const match = TABLE_CHANNEL.exec(event.channel);
  if (match === null) return;
  const [, connectionId, table] = match as unknown as [string, string, string];
  void queryClient.invalidateQueries({ queryKey: ['data', connectionId, table] });
  void queryClient.invalidateQueries({ queryKey: ['widget-data'] });
}

/** The worker's `completed` / `failed` / `cancelled` payloads name the job kind; `progress` does not. */
function isCampaignRunEvent(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as { kind?: unknown }).kind === 'email.campaign-run';
}
