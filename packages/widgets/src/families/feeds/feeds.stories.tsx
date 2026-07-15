/**
 * Track F `feeds` family stories (annex §4): each widget's loaded variant, the
 * four WidgetFrame states through WidgetHost (acceptance #4), and light/dark ×
 * LTR/RTL matrices (acceptance #9). Widgets resolve through a LOCAL registry
 * override so stories work before the green loop merges the definitions into
 * the global map. Payloads are the same seeded generators `demoData` uses.
 */
import type { ReactNode } from 'react';

import { activityFeedDemoData } from './ActivityFeed.js';
import {
  activityFeedDefinition,
  notificationFeedDefinition,
  realtimeFeedDefinition,
  timelineVerticalDefinition,
  unreadBadgeDefinition,
} from './feeds-track-f.definitions.js';
import { notificationFeedDemoData } from './NotificationFeed.js';
import { realtimeFeedDemoData } from './RealtimeFeed.js';
import { timelineVerticalDemoData } from './TimelineVertical.js';
import { unreadBadgeDemoData } from './UnreadBadge.js';
import { WidgetHost } from '../../frame/WidgetHost.js';
import { buildRegistry } from '../../registry/index.js';
import type { WidgetDefinition } from '../../registry/types.js';

const definitions: WidgetDefinition[] = [
  activityFeedDefinition,
  notificationFeedDefinition,
  realtimeFeedDefinition,
  timelineVerticalDefinition,
  unreadBadgeDefinition,
];
const registry = buildRegistry(definitions);

const meta = { title: 'Widgets/Feeds' };
export default meta;

type Status = 'success' | 'loading' | 'error';

function host(widgetId: string, instanceId: string, config: Record<string, unknown>, data: unknown, status: Status = 'success', width = 'w-[26rem]') {
  return (
    <div className={width}>
      <WidgetHost
        widgetId={widgetId}
        instanceId={instanceId}
        config={config}
        registry={registry}
        data={
          status === 'success'
            ? { status, data }
            : status === 'error'
              ? { status, error: new Error('TABLE_FORBIDDEN'), refetch: () => {} }
              : { status }
        }
      />
    </div>
  );
}

function Frame({ dark, dir, children }: { dark?: boolean; dir?: 'ltr' | 'rtl'; children: ReactNode }) {
  const content = (
    <div dir={dir} className="flex flex-wrap items-start gap-4 bg-bg p-4">
      {children}
    </div>
  );
  return dark ? <div data-theme="dark">{content}</div> : content;
}

const activityConfig = { title: 'Recent activity', viewAllHref: '/p/audit', limit: 6 };
const notifConfig = { title: 'Notifications' };
const realtimeConfig = { title: 'Live activity' };
const timelineConfig = { title: 'Changelog', variant: 'changelog' };

export const ActivityFeedStory = {
  name: 'activity-feed',
  render: () => host('activity-feed', 's-activity', activityConfig, activityFeedDemoData(7)),
};

export const NotificationFeedStory = {
  name: 'notification-feed',
  render: () => host('notification-feed', 's-notif', notifConfig, notificationFeedDemoData(9), 'success', 'w-[34rem]'),
};

export const RealtimeFeedStory = {
  name: 'realtime-feed',
  render: () => host('realtime-feed', 's-realtime', realtimeConfig, realtimeFeedDemoData(4)),
};

export const TimelineVariants = {
  name: 'timeline-vertical (variants)',
  render: () => (
    <Frame>
      {host('timeline-vertical', 's-tl-activity', { title: 'Activity', variant: 'activity' }, timelineVerticalDemoData(1, 'activity'))}
      {host('timeline-vertical', 's-tl-changelog', { title: 'Changelog', variant: 'changelog' }, timelineVerticalDemoData(1, 'changelog'))}
      {host('timeline-vertical', 's-tl-incidents', { title: 'Incidents', variant: 'incidents' }, timelineVerticalDemoData(1, 'incidents'))}
      {host('timeline-vertical', 's-tl-trace', { title: 'Run trace', variant: 'trace' }, timelineVerticalDemoData(1, 'trace'))}
    </Frame>
  ),
};

export const UnreadBadgeStory = {
  name: 'unread-badge',
  render: () => (
    <Frame>
      <span className="inline-flex items-center gap-2 text-body text-fg">
        Inbox {host('unread-badge', 's-badge', { active: true }, unreadBadgeDemoData(5), 'success', 'inline')}
      </span>
      <span className="inline-flex items-center gap-2 text-body text-fg">
        Overflow {host('unread-badge', 's-badge-of', { active: true, max: 99 }, { value: 250 }, 'success', 'inline')}
      </span>
    </Frame>
  ),
};

/** All four WidgetFrame states side by side (loaded · skeleton · empty · error). */
export const States = {
  render: () => (
    <Frame>
      {host('activity-feed', 'st-loaded', activityConfig, activityFeedDemoData(7))}
      {host('activity-feed', 'st-skeleton', activityConfig, undefined, 'loading')}
      {host('activity-feed', 'st-empty', { ...activityConfig, emptyState: { titleKey: 'No recent activity' } }, { data: [], total: 0 })}
      {host('activity-feed', 'st-error', activityConfig, undefined, 'error')}
    </Frame>
  ),
};

/** Realtime stream empty state (the "waiting for events" copy). */
export const RealtimeEmpty = {
  render: () => host('realtime-feed', 'st-rt-empty', { ...realtimeConfig, emptyState: { titleKey: 'Waiting for events' } }, { snapshot: [] }),
};

/** light/dark × LTR/RTL matrix for the notification feed. */
export const ThemeMatrix = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Frame dir="ltr">{host('notification-feed', 'm-l-ltr', notifConfig, notificationFeedDemoData(9), 'success', 'w-[30rem]')}</Frame>
      <Frame dir="rtl">{host('notification-feed', 'm-l-rtl', notifConfig, notificationFeedDemoData(9), 'success', 'w-[30rem]')}</Frame>
      <Frame dark dir="ltr">{host('notification-feed', 'm-d-ltr', notifConfig, notificationFeedDemoData(9), 'success', 'w-[30rem]')}</Frame>
      <Frame dark dir="rtl">{host('notification-feed', 'm-d-rtl', notifConfig, notificationFeedDemoData(9), 'success', 'w-[30rem]')}</Frame>
    </div>
  ),
};

/** Timeline light/dark × LTR/RTL. */
export const TimelineThemeMatrix = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Frame dir="ltr">{host('timeline-vertical', 'tm-l-ltr', timelineConfig, timelineVerticalDemoData(1, 'changelog'))}</Frame>
      <Frame dir="rtl">{host('timeline-vertical', 'tm-l-rtl', timelineConfig, timelineVerticalDemoData(1, 'changelog'))}</Frame>
      <Frame dark dir="ltr">{host('timeline-vertical', 'tm-d-ltr', timelineConfig, timelineVerticalDemoData(1, 'changelog'))}</Frame>
      <Frame dark dir="rtl">{host('timeline-vertical', 'tm-d-rtl', timelineConfig, timelineVerticalDemoData(1, 'changelog'))}</Frame>
    </div>
  ),
};
