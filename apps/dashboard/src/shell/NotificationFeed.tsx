// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The body of the topbar bell's popover: the feed over `/me/notifications`
 * and the way to the notification settings.
 *
 * A module of its own so the Topbar can load it on first open. The popover
 * is closed on every first paint, and the feed's row times come from the
 * widgets' relative-time formatter, whose module would otherwise ride in the
 * entry chunk for every user on every route.
 */
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatRelativeTime } from '@adminium/widgets';

import { notificationsQuery, type NotificationDto } from '../api/notifications.js';
import { t } from '../i18n/t.js';

export interface NotificationFeedProps {
  /** What shows while the feed loads: the Topbar's own spinner, the one it shows while this module loads. */
  loading: ReactNode;
  onOpenItem: (item: NotificationDto) => void;
  onOpenSettings: () => void;
}

export function NotificationFeed({ loading, onOpenItem, onOpenSettings }: NotificationFeedProps) {
  // Mounted only while the popover is open, so the feed loads on first open.
  const feed = useQuery(notificationsQuery({ limit: 20 }));
  return (
    <>
      {feed.isPending ? (
        loading
      ) : feed.isError ? (
        <p className="px-3.5 py-6 text-body-sm text-fg-muted" role="alert">
          {t('topbar.notificationsError', 'Couldn’t load notifications.')}
        </p>
      ) : feed.data.items.length === 0 ? (
        <p className="px-3.5 py-6 text-body-sm text-fg-muted">
          {t('topbar.notificationsEmpty', 'You’re all caught up.')}
        </p>
      ) : (
        <ul className="nb-scroll m-0 max-h-[360px] list-none overflow-y-auto p-1">
          {feed.data.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpenItem(item)}
                className="flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-start transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
              >
                <span className="flex w-full items-center gap-2">
                  {item.readAt === null && (
                    <span
                      data-part="notification-unread-dot"
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full bg-accent"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-fg">
                    {item.title}
                  </span>
                  <span className="shrink-0 text-caption text-fg-subtle">
                    {formatRelativeTime(new Date(item.createdAt).toISOString())}
                  </span>
                </span>
                {item.body !== null && (
                  <span className="w-full truncate text-caption text-fg-muted">{item.body}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-border p-1">
        <button
          type="button"
          onClick={onOpenSettings}
          className="w-full rounded-md px-2.5 py-2 text-start text-body-sm font-semibold text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          {t('nav.notificationSettings', 'Notification settings')}
        </button>
      </div>
    </>
  );
}
