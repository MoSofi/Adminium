/**
 * `page-queue-inbox` binding (09-generated-app.md §4.1, §7.4): projects the
 * page envelope onto the `PageQueueInbox` template from `@adminium/widgets`
 * and implements its `QueueApi` over the bound CRUD adapter.
 *
 * Undo-first bulk semantics (§4.1): `crud.bulk('update', ids, values)`
 * returns the single-use undo token (the server captured the exact prior
 * values of the exact id set); the template renders the Undo toast and
 * calls `undo(token)` back through here. Both directions invalidate the
 * `['data', …]` and `['widget-data']` caches so the queue list, its KPI
 * cards and any sibling pages agree after every decision.
 *
 * The notification-feed flavor's `mutate` intents flow through
 * `adapters.onEvent` instead — the host runs them with its own undo toast.
 *
 * REAL NOTIFICATION FEEDS (M7 T6): a `notification-feed` layout item WITHOUT
 * a stored binding cannot ride the widget-data batch (adminium_notifications
 * is meta, not source data), so this binding overlays its state with the live
 * `/me/notifications` rows mapped onto the feed vocabulary — the
 * `['notifications']` query key keeps it fresh through the WS
 * `notifications:<userId>` invalidation. Items WITH a stored binding keep
 * their widget-data state untouched.
 */
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { pageLayoutSchema } from '@adminium/engine/config';
import { PageQueueInbox, type QueueApi, type WidgetDataState } from '@adminium/widgets';

import { notificationFeedRow, notificationsQuery } from '../api/notifications.js';
import { t } from '../i18n/t.js';
import type { PageTemplateProps } from './template-types.js';
import { usePageTemplateData } from './usePageTemplateData.js';

export function PageQueueInboxBinding({ page, adapters }: PageTemplateProps) {
  const { states } = usePageTemplateData(page);
  const crud = adapters.crud;
  const queryClient = useQueryClient();

  // Unbound notification-feed layout items → the live /me/notifications rows.
  const feedInstanceIds = useMemo(() => {
    const layout = pageLayoutSchema.safeParse(page.config['layout']);
    if (!layout.success) return [];
    return layout.data.items
      .filter((item) => item.widget === 'notification-feed' && item.config['binding'] === undefined)
      .map((item) => item.i);
  }, [page]);
  const feed = useQuery({ ...notificationsQuery({ limit: 50 }), enabled: feedInstanceIds.length > 0 });

  const mergedStates = useMemo(() => {
    if (feedInstanceIds.length === 0) return states;
    const feedState: WidgetDataState = feed.isPending
      ? { status: 'loading' }
      : feed.isError
        ? { status: 'error', error: feed.error, refetch: () => void feed.refetch() }
        : {
            status: 'success',
            // feedRowsOf tolerates the `{ data: rows }` envelope.
            data: { data: feed.data.items.map(notificationFeedRow) },
            refetch: () => void feed.refetch(),
          };
    const merged = { ...states };
    for (const instanceId of feedInstanceIds) merged[instanceId] = feedState;
    return merged;
  }, [states, feedInstanceIds, feed]);

  const api = useMemo<QueueApi | undefined>(() => {
    if (crud === null) return undefined;
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ['data', crud.connectionId, crud.table] });
      void queryClient.invalidateQueries({ queryKey: ['widget-data'] });
    };
    return {
      async bulkUpdate(ids, values) {
        if (crud.bulk === undefined) {
          // No bulk endpoint on this adapter — sequential fallback, no undo
          // token (a partial set must never pretend to be exact-restorable).
          for (const id of ids) await crud.update(id, values);
          invalidate();
          return { undoToken: null };
        }
        const result = await crud.bulk('update', [...ids], values);
        invalidate();
        // The bulk route reports per-id outcomes WITHOUT failing the request
        // (unmatched ids → ok:false NOT_FOUND, okCount 0, undoToken null).
        // Swallowing that here would turn a written-nothing reply into a
        // success toast over a lying optimistic overlay — reject instead so
        // the template rolls back and toasts the failure.
        const failed = result.results.filter((entry) => !entry.ok).length;
        if (failed > 0) {
          throw new Error(
            t('templates.queueInbox.bulkFailed',
              '{failed} of {total} selected rows could not be updated.', { failed: String(failed), total: String(result.results.length) }),
          );
        }
        return { undoToken: result.undoToken };
      },
      async undo(token) {
        const restored = await crud.undo(token);
        invalidate();
        return restored;
      },
    };
  }, [crud, queryClient]);

  return (
    <PageQueueInbox
      config={page.config}
      states={mergedStates}
      api={api}
      onEvent={(instanceId, event) => {
        void instanceId;
        return adapters.onEvent(event);
      }}
      labels={{
        approve: t('templates.queueInbox.approve', 'Approve'),
        reject: t('templates.queueInbox.reject', 'Reject'),
        allSegment: t('templates.queueInbox.allSegment', 'All'),
        undo: t('common.undo', 'Undo'),
        dismiss: t('common.dismiss', 'Dismiss'),
        approvedToast: t('templates.queueInbox.approvedToast', '{count} approved.'),
        rejectedToast: t('templates.queueInbox.rejectedToast', '{count} rejected.'),
        undoneToast: t('templates.queueInbox.undoneToast', 'Decision undone.'),
        failedToast: t('templates.queueInbox.failedToast', 'Decision failed.'),
        undoFailedToast: t('templates.queueInbox.undoFailedToast', 'Could not undo this decision.'),
        rejectTitle: t('templates.queueInbox.rejectTitle', 'Reject requests'),
        rejectCount: t('templates.queueInbox.rejectCount', 'Selected · {count}'),
        rejectNote: t('templates.queueInbox.rejectNote', 'The requester will be notified with your note.'),
        rejectPlaceholder: t('templates.queueInbox.rejectPlaceholder', 'Add a note for the requester…'),
        rejectConfirm: t('templates.queueInbox.rejectConfirm', 'Reject'),
        cancel: t('common.cancel', 'Cancel'),
        close: t('common.close', 'Close'),
        emptyTitle: t('templates.queueInbox.emptyTitle', 'Nothing in the queue'),
        emptyBody: t('templates.queueInbox.emptyBody', 'New requests appear here as they arrive.'),
        caughtUpTitle: t('templates.queueInbox.caughtUpTitle', "You're all caught up"),
        caughtUpBody: t('templates.queueInbox.caughtUpBody', 'No requests in this tab right now.'),
        errorTitle: t('templates.queueInbox.errorTitle', 'This queue failed to load'),
        retry: t('common.retry', 'Retry'),
        loading: t('templates.queueInbox.loading', 'Loading queue'),
        selectPrompt: t('templates.queueInbox.selectPrompt', 'Select a request'),
        daysUnit: t('templates.queueInbox.daysUnit', '{count} days'),
      }}
    />
  );
}
