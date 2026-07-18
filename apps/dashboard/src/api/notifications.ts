/**
 * Notification-centre client (M7 reports/notifications track) — thin typed
 * wrappers over `/api/v1/me/notifications` + `/me/notification-prefs`.
 * Shapes mirror the server Zod reply schemas
 * (`apps/server/src/routes/notifications/schema.ts`) — the copied-mirror
 * convention from app/bootstrap.ts: change both together.
 *
 * Every query keys under the `['notifications']` prefix so the realtime
 * `notifications:<userId>` events (api/realtime.ts) invalidate the badge,
 * the feed and the prefs matrix in one stroke.
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from '../app/api.js';

export interface NotificationDto {
  id: string;
  /** Stable localization key (`report.ready`, `desktop.backup.completed`). */
  kind: string;
  actorLabel: string;
  title: string;
  body: string | null;
  entity: Record<string, unknown> | null;
  actionUrl: string | null;
  readAt: number | null;
  createdAt: number;
}

export interface NotificationsPage {
  items: NotificationDto[];
  unreadCount: number;
  nextCursor: string | null;
}

export interface NotificationChannelsDto {
  inApp: boolean;
  email: boolean;
  push: boolean;
}

export interface ChannelAvailabilityDto {
  id: 'inApp' | 'email' | 'push';
  available: boolean;
  /** Always present when `available` is false — render it, never hide it. */
  reason?: string;
}

export interface NotificationPrefDto {
  key: string;
  channels: NotificationChannelsDto;
  custom: boolean;
}

export interface NotificationPrefsDto {
  channels: ChannelAvailabilityDto[];
  events: NotificationPrefDto[];
}

const BASE = '/api/v1/me/notifications';

export const notificationsApi = {
  list: async (opts: { unread?: boolean; limit?: number; before?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.unread === true) params.set('unread', 'true');
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.before !== undefined) params.set('before', opts.before);
    const qs = params.size > 0 ? `?${params.toString()}` : '';
    return (await api.get<{ data: NotificationsPage }>(`${BASE}${qs}`)).data;
  },

  markRead: async (id: string) =>
    (
      await api.post<{ data: { updated: boolean; unreadCount: number } }>(
        `${BASE}/${encodeURIComponent(id)}/read`,
      )
    ).data,

  markAllRead: async () =>
    (await api.post<{ data: { updated: number; unreadCount: number } }>(`${BASE}/read-all`)).data,

  getPrefs: async () =>
    (await api.get<{ data: NotificationPrefsDto }>('/api/v1/me/notification-prefs')).data,

  putPrefs: async (events: { key: string; channels: NotificationChannelsDto }[]) =>
    (
      await api.put<{ data: NotificationPrefsDto }>('/api/v1/me/notification-prefs', { events })
    ).data,
};

export function notificationsQuery(opts: { unread?: boolean; limit?: number } = {}) {
  return queryOptions({
    queryKey: ['notifications', 'list', opts] as const,
    queryFn: () => notificationsApi.list(opts),
  });
}

/** The sidebar badge count (bootstrap nav `badge: 'unread-count'`). */
export function unreadCountQuery() {
  return queryOptions({
    queryKey: ['notifications', 'unread-count'] as const,
    queryFn: async () => (await notificationsApi.list({ limit: 1 })).unreadCount,
    // WS `notifications:<userId>` events invalidate this; the interval is the
    // WS-less degradation, not the primary path.
    refetchInterval: 60_000,
  });
}

export function notificationPrefsQuery() {
  return queryOptions({
    queryKey: ['notifications', 'prefs'] as const,
    queryFn: () => notificationsApi.getPrefs(),
  });
}

/**
 * Notification → `notification-feed` widget row (families/feeds vocabulary:
 * actor/action/target/ts/read/category). The feed widget localizes nothing —
 * `title`/`body` are the server's stable en-US fallbacks (§3.20 write-once
 * convention), which is exactly what a feed row wants.
 */
export function notificationFeedRow(row: NotificationDto): Record<string, unknown> {
  return {
    id: row.id,
    actor: row.actorLabel,
    action: row.title,
    target: row.body ?? '',
    ts: new Date(row.createdAt).toISOString(),
    read: row.readAt !== null,
    category: row.kind.split('.')[0] ?? row.kind,
  };
}
