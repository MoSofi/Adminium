// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the notification-centre resource (M7 reports/notifications
 * track): `/me/notifications` (keyset list + read transitions) and
 * `/me/notification-prefs` (event × channel matrix).
 */
import { notificationQuietSchema } from '@adminium/meta';
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
  /**
   * Where the notice opens. For a notice about a record whose app gives it a
   * screen of its own, and a reader whose roles open that app's staff side,
   * this is that screen's address on this server; for everybody else the link
   * the notice was written with (the dashboard's record page).
   */
  actionUrl: z.string().nullable(),
  /**
   * Set with an `actionUrl` that is an app's own screen: the app, and the
   * address under its staff side (`/deals/12`), so the app's screens can go
   * there in place.
   */
  opens: z.object({ appKey: z.string(), path: z.string() }).optional(),
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
    /** The nav-badge number (`unread-count`) — always the full count. */
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

/** Event keys: dotted kebab/lower segments, same grammar as `kind`. */
export const eventKeySchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);

/**
 * One delivery channel's availability. `available: false` ALWAYS carries a
 * `reason` — the never-hide-always-explain rule: the client renders the
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

// --- when a person is told ---------------------------------------------------

const scheduleFields = {
  /** IANA zone; null follows the business's. */
  timezone: z.string().min(1).max(64).nullable(),
  /** The quiet hours of each weekday (0 = Sunday); null for none. */
  quiet: notificationQuietSchema.nullable(),
  /** 0 (Sunday) to 6; null sends a summary the day it is made. */
  digestDay: z.number().int().min(0).max(6).nullable(),
  /** `HH:MM` on the person's clock; null sends a summary when its rule runs. */
  digestTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
};

/**
 * The two switches a person keeps beside the hours. Left out of a write, each
 * stays as it was: a client that knows only the four fields above never
 * switches either one by saving.
 */
const switchFields = {
  /** Quiet hours on. Off holds nothing, and keeps the hours for when they are on again. */
  quietOn: z.boolean(),
  /** Summaries made for this person; false is "not me", the day and time kept. */
  summariesOn: z.boolean(),
};

export const notificationSchedulePutBody = z.object({ ...scheduleFields, quietOn: switchFields.quietOn.optional(), summariesOn: switchFields.summariesOn.optional() }).strict();

export const notificationScheduleReply = z.object({
  data: z.object({ ...scheduleFields, ...switchFields, fallbackTimezone: z.string() }),
});
