// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `feeds` family stories (annex §4) — the complete 7-id slice: each widget's
 * loaded variant, the four WidgetFrame states through WidgetHost (acceptance
 * #4), and light/dark × LTR/RTL matrices (acceptance #9). Widgets resolve
 * through a LOCAL registry override so stories work before the green loop
 * merges the definitions into the global map. Payloads are the same seeded
 * generators `demoData` uses.
 */
import type { ReactNode } from 'react';

import { activityFeedDemoData } from './ActivityFeed.js';
import { loadOlderPaginatorDemoData } from './LoadOlderPaginator.js';
import { toastStackDemoData } from './ToastStack.js';
import {
  activityFeedDefinition,
  loadOlderPaginatorDefinition,
  notificationFeedDefinition,
  realtimeFeedDefinition,
  timelineVerticalDefinition,
  toastStackDefinition,
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
  loadOlderPaginatorDefinition,
  toastStackDefinition,
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

// ── M7 Wave 4: the §4 tail ─────────────────────────────────────────────────

const paginatorConfig = { batchSize: 20 };

/** load-older-paginator: mid-pool, exhausted (relabelled), and hidden-on-exhaustion. */
export const LoadOlderPaginatorStory = {
  name: 'load-older-paginator',
  render: () => (
    <Frame>
      {host('load-older-paginator', 's-lop', paginatorConfig, loadOlderPaginatorDemoData(7))}
      {host('load-older-paginator', 's-lop-done', paginatorConfig, { rows: [], total: 24, loaded: 24, cursor: null })}
      {host(
        'load-older-paginator',
        's-lop-hidden',
        { ...paginatorConfig, hideWhenExhausted: true },
        { rows: [], total: 24, loaded: 24, cursor: null },
      )}
    </Frame>
  ),
};

/** The paginator attached under a feed — the composition the annex describes. */
export const PaginatedFeed = {
  name: 'activity-feed + load-older-paginator',
  render: () => (
    <Frame>
      <div className="w-[26rem] overflow-hidden rounded-lg border border-border bg-surface">
        {host('activity-feed', 's-pf-feed', activityConfig, activityFeedDemoData(7), 'success', 'w-full')}
        {host('load-older-paginator', 's-pf-page', paginatorConfig, loadOlderPaginatorDemoData(3), 'success', 'w-full')}
      </div>
    </Frame>
  ),
};

/**
 * The paginator's REAL mirroring (acceptance #9): the count caption's Latin
 * digits stay `tabular-nums`-aligned in ar_EG (data-context numerals), while the
 * button's chevron/label row and the whole footer reverse under `dir="rtl"`.
 */
export const PaginatorThemeAndDirectionMatrix = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Frame dir="ltr">{host('load-older-paginator', 'pm-l-ltr', paginatorConfig, loadOlderPaginatorDemoData(7))}</Frame>
      <Frame dir="rtl">{host('load-older-paginator', 'pm-l-rtl', paginatorConfig, loadOlderPaginatorDemoData(7))}</Frame>
      <Frame dark dir="ltr">{host('load-older-paginator', 'pm-d-ltr', paginatorConfig, loadOlderPaginatorDemoData(7))}</Frame>
      <Frame dark dir="rtl">{host('load-older-paginator', 'pm-d-rtl', paginatorConfig, loadOlderPaginatorDemoData(7))}</Frame>
    </div>
  ),
};

/**
 * toast-stack is `placement: 'overlay'` — it fixes itself to the viewport, so
 * each frame is a `relative` stage the fixed container anchors inside rather
 * than a card. Every position variant is shown at once.
 */
function ToastStage({ children }: { children: ReactNode }) {
  return <div className="relative h-64 w-full overflow-hidden rounded-lg border border-border bg-bg">{children}</div>;
}

export const ToastStackStory = {
  name: 'toast-stack',
  render: () => (
    <ToastStage>{host('toast-stack', 's-toast', { position: 'bottom-center' }, toastStackDemoData(2), 'success', 'contents')}</ToastStage>
  ),
};

/** Every annex §4 `position` value. */
export const ToastPositions = {
  name: 'toast-stack (positions)',
  render: () => (
    <div className="flex flex-col gap-4">
      {(['bottom-center', 'bottom-end', 'top-center', 'top-end'] as const).map((position) => (
        <ToastStage key={position}>
          {host('toast-stack', `s-toast-${position}`, { position }, toastStackDemoData(5), 'success', 'contents')}
        </ToastStage>
      ))}
    </div>
  ),
};

/**
 * toast-stack's REAL mirroring (acceptance #9): `end-4` and the centering
 * `-translate-x-1/2`/`rtl:translate-x-1/2` pair are logical, so the RTL frames
 * genuinely park the stack at the LEFT edge (the RTL trailing edge) and the
 * toast's icon-then-text row, action button and close ✕ all reverse — a
 * physical `right-4` would strand it under the RTL sidebar.
 */
export const ToastThemeAndDirectionMatrix = {
  render: () => {
    const stage = (key: string) => (
      <ToastStage>{host('toast-stack', key, { position: 'bottom-end' }, toastStackDemoData(2), 'success', 'contents')}</ToastStage>
    );
    return (
      <div className="flex flex-col gap-4">
        <Frame dir="ltr">{stage('tt-l-ltr')}</Frame>
        <Frame dir="rtl">{stage('tt-l-rtl')}</Frame>
        <Frame dark dir="ltr">{stage('tt-d-ltr')}</Frame>
        <Frame dark dir="rtl">{stage('tt-d-rtl')}</Frame>
      </div>
    );
  },
};
