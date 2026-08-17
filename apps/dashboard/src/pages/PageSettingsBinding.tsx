// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-settings` binding (09-generated-app.md §4.1; comp: Notification
 * Settings) — projects the PageSettings template onto the LIVE
 * `/me/notification-prefs` matrix with per-cell autosave:
 *
 *   toggle → optimistic cache flip + dirty dot + "Saving…"
 *          → PUT one event row
 *          → server truth back into the cache + "Saved"
 *          → (failure) rollback the flip + explain in the indicator.
 *
 * Channel availability is SERVER truth passed through verbatim (§8.2): email
 * arrives `available: false` with the no-SMTP reason and renders as a
 * togglable-but-explained column — the intent is stored either way.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageSettings, settingsCellId, type SettingsSaveState } from '@adminium/widgets';

import {
  notificationPrefsQuery,
  notificationsApi,
  type NotificationChannelsDto,
  type NotificationPrefsDto,
} from '../api/notifications.js';
import { t } from '../i18n/t.js';
import type { PageTemplateProps } from './template-types.js';

/** Known event keys → human labels (new producers add a line + i18n key). */
const EVENT_LABELS: Record<string, { key: string; en: string }> = {
  'report.ready': { key: 'notifications.event.reportReady', en: 'Scheduled report ready' },
  'report.failed': { key: 'notifications.event.reportFailed', en: 'Scheduled report failed' },
  'desktop.backup.completed': {
    key: 'notifications.event.backupCompleted',
    en: 'Backup completed',
  },
};

function eventLabel(eventKey: string): string {
  const known = EVENT_LABELS[eventKey];
  if (known !== undefined) return t(known.key, known.en);
  // Unknown producer: humanize `custom.thing-happened` → "Custom thing happened".
  const text = eventKey.replaceAll(/[.-]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const CHANNEL_LABELS: Record<string, { key: string; en: string }> = {
  inApp: { key: 'notifications.channel.inApp', en: 'In-app' },
  email: { key: 'notifications.channel.email', en: 'Email' },
  push: { key: 'notifications.channel.push', en: 'Push' },
};

export function PageSettingsBinding({ page }: PageTemplateProps) {
  const queryClient = useQueryClient();
  const prefs = useQuery(notificationPrefsQuery());
  const [pendingCells, setPendingCells] = useState<ReadonlySet<string>>(new Set());
  const [saveState, setSaveState] = useState<SettingsSaveState>({ state: 'idle' });

  const save = useMutation({
    mutationFn: (input: { key: string; channels: NotificationChannelsDto }) =>
      notificationsApi.putPrefs([input]),
  });

  const data = prefs.data;

  function onToggle(eventKey: string, channelId: string, next: boolean): void {
    if (data === undefined) return;
    const event = data.events.find((candidate) => candidate.key === eventKey);
    if (event === undefined) return;
    const nextChannels = { ...event.channels, [channelId]: next };
    const cell = settingsCellId(eventKey, channelId);
    const previous = data;

    // Optimistic flip — the template is fully controlled, so this IS the UI.
    queryClient.setQueryData<NotificationPrefsDto>(notificationPrefsQuery().queryKey, {
      ...previous,
      events: previous.events.map((candidate) =>
        candidate.key === eventKey
          ? { ...candidate, channels: nextChannels, custom: true }
          : candidate,
      ),
    });
    setPendingCells((cells) => new Set(cells).add(cell));
    setSaveState({ state: 'saving' });

    save.mutate(
      { key: eventKey, channels: nextChannels },
      {
        onSuccess: (reply) => {
          queryClient.setQueryData(notificationPrefsQuery().queryKey, reply);
          setSaveState({ state: 'saved' });
        },
        onError: (error) => {
          // Rollback: the controlled matrix visibly snaps the cell back.
          queryClient.setQueryData(notificationPrefsQuery().queryKey, previous);
          setSaveState({
            state: 'error',
            message:
              error instanceof Error
                ? error.message
                : t('settings.notifications.saveFailed', 'Could not save this change.'),
          });
        },
        onSettled: () => {
          setPendingCells((cells) => {
            const nextCells = new Set(cells);
            nextCells.delete(cell);
            return nextCells;
          });
        },
      },
    );
  }

  return (
    <PageSettings
      config={page.config}
      channels={(data?.channels ?? []).map((channel) => ({
        id: channel.id,
        label: t(
          CHANNEL_LABELS[channel.id]?.key ?? `notifications.channel.${channel.id}`,
          CHANNEL_LABELS[channel.id]?.en ?? channel.id,
        ),
        available: channel.available,
        // The server's reason passes through VERBATIM — it is the product
        // truth ("no SMTP in this build"), not client copy to soften.
        reason: channel.reason,
      }))}
      events={(data?.events ?? []).map((event) => ({
        key: event.key,
        label: eventLabel(event.key),
        channels: { ...event.channels },
      }))}
      status={prefs.isPending ? 'loading' : prefs.isError ? 'error' : 'ready'}
      errorMessage={prefs.error instanceof Error ? prefs.error.message : undefined}
      onRetry={() => void prefs.refetch()}
      saveState={saveState}
      pendingCells={pendingCells}
      onToggle={onToggle}
      labels={{
        title: t(page.title.key, page.title.fallback),
        subtitle: t(
          'settings.notifications.subtitle',
          "Choose what you're notified about and how",
        ),
        matrixLabel: t('settings.notifications.matrixLabel', 'Notify me about'),
        rowHeader: t('settings.notifications.rowHeader', 'Event'),
        saving: t('settings.notifications.saving', 'Saving…'),
        saved: t('settings.notifications.saved', 'Saved'),
        unavailableTag: t('settings.notifications.unavailable', 'Not available yet'),
        loading: t('settings.notifications.loading', 'Loading preferences'),
        errorTitle: t('settings.notifications.errorTitle', 'These settings failed to load'),
        retry: t('common.retry', 'Retry'),
        emptyTitle: t('settings.notifications.emptyTitle', 'Nothing to configure yet'),
        emptyBody: t(
          'settings.notifications.emptyBody',
          'Notification events appear here as producers ship.',
        ),
      }}
    />
  );
}
