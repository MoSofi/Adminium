// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The shared in-app notification writer (07-meta-store.md §3.20,
 * 08-server-api.md §3 `notifications:<userId>`): every producer inserts
 * through `notificationsRepo` and, when it has the hub, publishes the row on
 * the recipient's channel so an open session's bell/badge updates without a
 * refetch cycle.
 *
 * Channel-preference gating lives HERE, not in the repo: a producer names its
 * `kind` (which doubles as the §3.21 `event_key`) and the writer consults
 * `notificationPrefsRepo.channelsFor(...)`. `inApp` decides whether a row is
 * written; `email` queues a message through `email/send.ts`. The two are
 * INDEPENDENT — a user who wants mail but no bell badge gets exactly that, so
 * the email leg runs even when the in-app leg is switched off and this
 * function returns `null`. `push` remains stored intent (no transport).
 *
 * A CONSEQUENCE WORTH SAYING OUT LOUD: `DEFAULT_NOTIFICATION_CHANNELS.email`
 * is `true`, and it was set that way while email could not deliver. Wiring the
 * channel up therefore switches notification mail ON for every user who never
 * touched the prefs matrix, the moment an operator configures SMTP. That is
 * the honest reading of a stored preference — the alternative is to keep
 * ignoring an answer the user already gave — but it is a real change in what a
 * fresh install does, and the prefs screen is where a user turns it back off.
 *
 * The email leg is strictly best-effort, and deliberately so: `notify` is
 * called from producers that have already succeeded at the thing the user
 * cares about (a report ran, a backup completed). A courtesy message must
 * never be able to fail that.
 */
import {
  notificationPrefsRepo,
  notificationsRepo,
  settingsRepo,
  usersRepo,
  type CreateNotificationInput,
  type MetaDb,
  type Notification,
} from '@adminium/meta';

import {
  NOTIFICATION_EMAIL_TEMPLATE_KEY,
  NOTIFICATION_FALLBACK_TEMPLATE,
  enqueueEmail,
  type EmailLogger,
} from '../email/send.js';
import { recipientLocale } from '../i18n/server-i18n.js';

/** Event type published on `notifications:<userId>` for a fresh row. */
export const NOTIFICATION_CREATED_EVENT = 'notification.created';
/** Event type published when rows flip to read (badge sync across tabs). */
export const NOTIFICATION_READ_EVENT = 'notification.read';

/** The §3 channel name for one user's notification stream. */
export function notificationsChannel(userId: string): string {
  return `notifications:${userId}`;
}

/** The slice of RealtimeHub the writer needs (tests pass a recorder). */
export interface NotificationPublisher {
  publish(channel: string, type: string, data: unknown): unknown;
}

export interface NotifyOptions {
  /** When present, the row is fanned out on `notifications:<userId>`. */
  hub?: NotificationPublisher | undefined;
  /**
   * Consult the user's §3.21 prefs for `kind` before inserting; default true.
   * Producers of rows the user cannot opt out of (none today) pass false.
   */
  respectPrefs?: boolean | undefined;
  at?: number | undefined;
  /**
   * Absolute origin (`https://admin.example.com`) used to turn the row's
   * `actionUrl` into a clickable link in the email. Producers that run inside
   * a request pass `requestOrigin(request)`; background producers (the report
   * scheduler) have none, and the email then carries the path as stored.
   */
  origin?: string | undefined;
  /** Skip the email leg entirely (tests, and producers that mail their own). */
  email?: boolean | undefined;
  logger?: EmailLogger | undefined;
}

/**
 * Insert one notification (prefs permitting), publish it, and queue the email
 * copy when the recipient's `email` channel is on. Returns the row, or `null`
 * when the recipient has the event's IN-APP channel switched off — which says
 * nothing about whether an email went out.
 *
 * Best-effort belongs at the CALL SITE (backup/notify.ts precedent): a failed
 * courtesy row must not fail the operation that succeeded.
 */
export async function notify(
  meta: MetaDb,
  input: CreateNotificationInput,
  opts: NotifyOptions = {},
): Promise<Notification | null> {
  const channels = await notificationPrefsRepo(meta).channelsFor(input.userId, input.kind);

  // Ordered so the email leg is reached even when the in-app leg returns early.
  if (channels.email && (opts.email ?? true)) {
    await deliverEmail(meta, input, opts);
  }

  if ((opts.respectPrefs ?? true) && !channels.inApp) return null;

  const row = await notificationsRepo(meta).create(input, opts.at);
  opts.hub?.publish(notificationsChannel(row.userId), NOTIFICATION_CREATED_EVENT, {
    notification: row,
  });
  return row;
}

/**
 * One template for every notification kind, seeded by nobody: the row's own
 * `title`/`body` ARE the content, so a per-kind template would be thirty
 * near-identical rows for an operator to keep in sync — and every kind added
 * later would silently have no email at all. `NOTIFICATION_FALLBACK_TEMPLATE`
 * carries it until an operator creates a `notification` row in the editor, at
 * which point theirs wins.
 */
async function deliverEmail(
  meta: MetaDb,
  input: CreateNotificationInput,
  opts: NotifyOptions,
): Promise<void> {
  try {
    const user = await usersRepo(meta).findById(input.userId);
    // A suspended account keeps its prefs row but must stop receiving mail.
    if (user === null || user.status === 'suspended') return;
    await enqueueEmail(
      { meta, ...(opts.logger === undefined ? {} : { logger: opts.logger }) },
      {
        to: user.email,
        templateKey: NOTIFICATION_EMAIL_TEMPLATE_KEY,
        locale: await recipientLocale(meta, user.id),
        vars: {
          appName: await settingsRepo(meta).get('branding.appName'),
          name: user.name,
          kind: input.kind,
          title: input.title,
          body: input.body ?? '',
          actionUrl: absoluteActionUrl(input.actionUrl ?? null, opts.origin),
        },
        fallback: NOTIFICATION_FALLBACK_TEMPLATE,
      },
    );
  } catch (error) {
    opts.logger?.warn(
      { err: error, userId: input.userId, kind: input.kind },
      'could not queue the notification email',
    );
  }
}

function absoluteActionUrl(actionUrl: string | null, origin: string | undefined): string {
  if (actionUrl === null || actionUrl.length === 0) return '';
  if (/^https?:\/\//.test(actionUrl)) return actionUrl;
  if (origin === undefined || origin.length === 0) return actionUrl;
  return `${origin.replace(/\/+$/, '')}${actionUrl.startsWith('/') ? '' : '/'}${actionUrl}`;
}
