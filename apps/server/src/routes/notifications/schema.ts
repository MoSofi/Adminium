// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the notification-centre resource (M7 reports/notifications
 * track; 07-meta-store.md §3.20/§3.21, 09-generated-app.md §5.4):
 * `/me/notifications` (keyset list + read transitions) and
 * `/me/notification-prefs` (event × channel matrix).
 */
import { z } from 'zod';
import { notificationChannelsSchema } from '@adminium/meta';

// --- notifications ---------------------------------------------------------------

export const notificationView = z.object({
  id: z.string(),
  /** Stable localization key (`report.ready`, `desktop.backup.completed`). */
  kind: z.string(),
  actorLabel: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  /** Kind-specific substitutions the client localizes at render time. */
  entity: z.record(z.string(), z.unknown()).nullable(),
  actionUrl: z.string().nullable(),
  readAt: z.number().nullable(),
  createdAt: z.number(),
});
export type NotificationView = z.infer<typeof notificationView>;

/** Opaque keyset cursor: `<createdAt>:<id>` of the previous page's last row. */
export const notificationCursorRe = /^(\d+):(.+)$/;

export const notificationsListQuery = z.object({
  /** `true` narrows to unread rows (the bell's Unread tab). */
  unread: z.enum(['true', 'false']).default('false'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z.string().regex(notificationCursorRe).optional(),
});

export const notificationsListReply = z.object({
  data: z.object({
    items: z.array(notificationView),
    /** The nav-badge number (09 §5.4 `unread-count`) — always the full count. */
    unreadCount: z.number(),
    /** Pass back as `?before=` for the next page; null = no more rows. */
    nextCursor: z.string().nullable(),
  }),
});

export const notificationIdParams = z.object({ id: z.string().min(1) });

export const notificationReadReply = z.object({
  data: z.object({
    /** False when the row was already read or is not yours (no leak). */
    updated: z.boolean(),
    unreadCount: z.number(),
  }),
});

export const notificationsReadAllReply = z.object({
  data: z.object({ updated: z.number(), unreadCount: z.number() }),
});

// --- notification prefs -----------------------------------------------------------

/** §3.21 event keys: dotted kebab/lower segments, same grammar as `kind`. */
export const eventKeySchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);

/**
 * One delivery channel's availability. `available: false` ALWAYS carries a
 * `reason` — the §8.2 never-hide-always-explain rule: the client renders the
 * toggle (intent is stored) plus the explanation, never a silent gap.
 */
export const channelAvailabilityView = z.object({
  id: z.enum(['inApp', 'email', 'push']),
  available: z.boolean(),
  reason: z.string().optional(),
});
export type ChannelAvailabilityView = z.infer<typeof channelAvailabilityView>;

export const notificationPrefView = z.object({
  key: eventKeySchema,
  channels: notificationChannelsSchema,
  /** True when a stored row deviates from the defaults (vs. implicit default). */
  custom: z.boolean(),
});
export type NotificationPrefView = z.infer<typeof notificationPrefView>;

export const notificationPrefsReply = z.object({
  data: z.object({
    channels: z.array(channelAvailabilityView),
    events: z.array(notificationPrefView),
  }),
});

export const notificationPrefsPutBody = z.object({
  events: z.array(z.object({ key: eventKeySchema, channels: notificationChannelsSchema })).min(1),
});
export type NotificationPrefsPutBody = z.infer<typeof notificationPrefsPutBody>;
