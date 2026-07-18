/**
 * The shared in-app notification writer (07-meta-store.md §3.20,
 * 08-server-api.md §3 `notifications:<userId>`): every producer inserts
 * through `notificationsRepo` and, when it has the hub, publishes the row on
 * the recipient's channel so an open session's bell/badge updates without a
 * refetch cycle.
 *
 * Channel-preference gating lives HERE, not in the repo: a producer names its
 * `kind` (which doubles as the §3.21 `event_key`) and the writer consults
 * `notificationPrefsRepo.channelsFor(...).inApp` — a user who switched the
 * event off gets no row. Email/push channels are stored intent only in this
 * build (no SMTP / no push transport); the prefs ROUTE explains that, per the
 * never-hide-always-explain rule — the writer just ignores them.
 */
import {
  notificationPrefsRepo,
  notificationsRepo,
  type CreateNotificationInput,
  type MetaDb,
  type Notification,
} from '@adminium/meta';

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
}

/**
 * Insert one notification (prefs permitting) and publish it. Returns the row,
 * or `null` when the recipient has the event's in-app channel switched off.
 * Best-effort belongs at the CALL SITE (backup/notify.ts precedent): a failed
 * courtesy row must not fail the operation that succeeded.
 */
export async function notify(
  meta: MetaDb,
  input: CreateNotificationInput,
  opts: NotifyOptions = {},
): Promise<Notification | null> {
  if (opts.respectPrefs ?? true) {
    const channels = await notificationPrefsRepo(meta).channelsFor(input.userId, input.kind);
    if (!channels.inApp) return null;
  }
  const row = await notificationsRepo(meta).create(input, opts.at);
  opts.hub?.publish(notificationsChannel(row.userId), NOTIFICATION_CREATED_EVENT, {
    notification: row,
  });
  return row;
}
