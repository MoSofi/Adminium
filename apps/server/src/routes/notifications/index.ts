// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Notification-centre routes (M7 reports/notifications track;
 * 07-meta-store.md §3.20/§3.21, 09-generated-app.md §5.4), mounted under
 * `/api/v1`. Everything here is per-user `/me` surface — RBAC needs no new
 * keys, the session IS the scope:
 *
 * - `GET  /me/notifications`           — keyset list (newest first) + the
 *   badge's `unreadCount`; `?unread=true` narrows to the Unread tab.
 * - `POST /me/notifications/:id/read`  — owner-scoped read stamp (foreign ids
 *   are a silent no-op, never a 404 oracle).
 * - `POST /me/notifications/read-all`  — the bell's mark-all.
 * - `GET/PUT /me/notification-prefs`   — the event × channel matrix. Email is
 *   STORED but reported `available: false` with the no-SMTP reason; push
 *   likewise until a transport exists (§8.2 — explain, never hide).
 *
 * Read transitions publish `notification.read` on `notifications:<userId>`
 * so a second tab's badge follows without polling.
 */
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  DEFAULT_NOTIFICATION_CHANNELS,
  notificationPrefsRepo,
  notificationsRepo,
  type MetaDb,
  type Notification,
  type NotificationChannels,
} from '@adminium/meta';

import { isEmailConfigured } from '../../email/send.js';
import { UnauthorizedError } from '../../errors.js';
import {
  NOTIFICATION_READ_EVENT,
  notificationsChannel,
  type NotificationPublisher,
} from '../../notifications/notify.js';
import {
  notificationIdParams,
  notificationPrefsPutBody,
  notificationPrefsReply,
  notificationReadReply,
  notificationsListQuery,
  notificationsListReply,
  notificationsReadAllReply,
  notificationCursorRe,
  type ChannelAvailabilityView,
  type NotificationPrefView,
  type NotificationView,
} from './schema.js';

/**
 * Event keys with a live in-app producer TODAY — the prefs matrix lists these
 * even before the user stores a deviation. Stored rows for other keys are
 * merged in (they never vanish), so the catalog can grow producer-by-producer.
 */
export const NOTIFICATION_EVENT_KEYS: readonly string[] = [
  'report.ready',
  'report.failed',
  'desktop.backup.completed',
];

/**
 * §8.2. Email delivery EXISTS now; what may be missing is a configured relay,
 * so this reason describes an unconfigured install rather than a build that
 * cannot send at all. Push is still the "later release" case.
 */
export const EMAIL_CHANNEL_UNAVAILABLE_REASON =
  'No SMTP server is configured for this workspace — your email preferences are saved and take effect as soon as an administrator sets one up in Settings → Email.';
export const PUSH_CHANNEL_UNAVAILABLE_REASON =
  'Push delivery arrives in a later release — your push preferences are saved until then.';

export interface NotificationsRoutesDeps {
  meta: MetaDb;
  /** `app.realtime` in compose; optional so tests can pass a recorder/omit. */
  hub?: NotificationPublisher | undefined;
}

function requireUserId(request: FastifyRequest): string {
  const user = (request as unknown as { user?: { id?: string } }).user;
  const id = user?.id ?? null;
  if (id === null) throw new UnauthorizedError();
  return id;
}

function toView(row: Notification): NotificationView {
  return {
    id: row.id,
    kind: row.kind,
    actorLabel: row.actorLabel,
    title: row.title,
    body: row.body,
    entity: row.entity,
    actionUrl: row.actionUrl,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

/**
 * Availability is READ, not assumed: the email row flips the moment an admin
 * saves an SMTP config, so the matrix stops claiming a channel is dead on an
 * install that can in fact deliver. `notify.ts` gates on the same call, so the
 * badge and the actual send can never disagree.
 */
async function channelViews(meta: MetaDb): Promise<ChannelAvailabilityView[]> {
  const emailAvailable = await isEmailConfigured(meta, null);
  return [
    { id: 'inApp', available: true },
    emailAvailable
      ? { id: 'email', available: true }
      : { id: 'email', available: false, reason: EMAIL_CHANNEL_UNAVAILABLE_REASON },
    { id: 'push', available: false, reason: PUSH_CHANNEL_UNAVAILABLE_REASON },
  ];
}

export function notificationsRoutes(deps: NotificationsRoutesDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  const notifications = notificationsRepo(meta);
  const prefs = notificationPrefsRepo(meta);

  function publishRead(userId: string, unreadCount: number): void {
    deps.hub?.publish(notificationsChannel(userId), NOTIFICATION_READ_EVENT, { unreadCount });
  }

  async function prefsView(userId: string): Promise<{
    channels: ChannelAvailabilityView[];
    events: NotificationPrefView[];
  }> {
    const stored = await prefs.listForUser(userId);
    const byKey = new Map(stored.map((row) => [row.eventKey, row.channels] as const));
    const keys = [
      ...NOTIFICATION_EVENT_KEYS,
      ...stored.map((row) => row.eventKey).filter((key) => !NOTIFICATION_EVENT_KEYS.includes(key)),
    ];
    return {
      channels: await channelViews(meta),
      events: keys.map((key) => {
        const channels: NotificationChannels =
          byKey.get(key) ?? { ...DEFAULT_NOTIFICATION_CHANNELS };
        return { key, channels, custom: byKey.has(key) };
      }),
    };
  }

  return async (app) => {
    app.get(
      '/me/notifications',
      { schema: { querystring: notificationsListQuery, response: { 200: notificationsListReply } } },
      async (request) => {
        const userId = requireUserId(request);
        const { unread, limit, before } = request.query;
        let cursor;
        if (before !== undefined) {
          const match = notificationCursorRe.exec(before);
          // Regex-validated by the schema; the split cannot fail here.
          cursor = { createdAt: Number(match?.[1] ?? 0), id: match?.[2] ?? '' };
        }
        const rows = await notifications.listForUser(userId, {
          unreadOnly: unread === 'true',
          // Fetch one extra row to answer "is there a next page" honestly.
          limit: limit + 1,
          before: cursor,
        });
        const page = rows.slice(0, limit);
        const last = page[page.length - 1];
        return {
          data: {
            items: page.map(toView),
            unreadCount: await notifications.unreadCount(userId),
            nextCursor:
              rows.length > limit && last !== undefined ? `${last.createdAt}:${last.id}` : null,
          },
        };
      },
    );

    app.post(
      '/me/notifications/:id/read',
      { schema: { params: notificationIdParams, response: { 200: notificationReadReply } } },
      async (request) => {
        const userId = requireUserId(request);
        const updated = await notifications.markRead(request.params.id, userId);
        const unreadCount = await notifications.unreadCount(userId);
        if (updated) publishRead(userId, unreadCount);
        return { data: { updated, unreadCount } };
      },
    );

    app.post(
      '/me/notifications/read-all',
      { schema: { response: { 200: notificationsReadAllReply } } },
      async (request) => {
        const userId = requireUserId(request);
        const updated = await notifications.markAllRead(userId);
        if (updated > 0) publishRead(userId, 0);
        return { data: { updated, unreadCount: 0 } };
      },
    );

    app.get(
      '/me/notification-prefs',
      { schema: { response: { 200: notificationPrefsReply } } },
      async (request) => {
        const userId = requireUserId(request);
        return { data: await prefsView(userId) };
      },
    );

    app.put(
      '/me/notification-prefs',
      { schema: { body: notificationPrefsPutBody, response: { 200: notificationPrefsReply } } },
      async (request) => {
        const userId = requireUserId(request);
        // Intent is stored VERBATIM, email/push included — availability is a
        // transport fact reported alongside, never a write filter (§8.2).
        for (const event of request.body.events) {
          await prefs.upsert(userId, event.key, event.channels);
        }
        return { data: await prefsView(userId) };
      },
    );
  };
}
