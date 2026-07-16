import { lazy } from 'react';

import {
  activityFeedConfigSchema,
  activityFeedDemoData,
  notificationFeedConfigSchema,
  notificationFeedDemoData,
  realtimeFeedConfigSchema,
  realtimeFeedDemoData,
  timelineVerticalConfigSchema,
  timelineVerticalDemoData,
  unreadBadgeConfigSchema,
  unreadBadgeDemoData,
} from './feeds-config.js';
import { defineWidget } from '../../registry/types.js';
import type { WidgetDefinition } from '../../registry/types.js';

/**
 * Track F contribution to the `feeds` family (annex §4). Metadata only — the
 * config schemas and demo generators come from the pure `feeds-config` module,
 * and the @adminium/ui-heavy widget components load through the
 * `feeds-track-f-components` barrel via `lazy(() => import(...))`, so the family
 * stays in one lazy chunk and the registry metadata never eagerly pulls the
 * component code (04 §2.3; the boards/domain/media convention). The GREEN LOOP
 * spreads `feedsTrackFDefinitions` into `families/feeds/definitions.ts` (and
 * wires that into the registry map). Widget ids match the annex catalog exactly
 * (acceptance #1).
 */

export const activityFeedDefinition: WidgetDefinition = defineWidget({
  id: 'activity-feed',
  family: 'feeds',
  component: lazy(() => import('./feeds-track-f-components.js').then((m) => ({ default: m.ActivityFeedWidget }))),
  configSchema: activityFeedConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 3, minH: 6, defaultW: 4, defaultH: 8 }, // annex 3×3 → 4×4
  placement: 'grid',
  skeleton: 'list',
  demoData: activityFeedDemoData,
  descriptionKey: 'widgets.feeds.activityFeed.description',
});

export const notificationFeedDefinition: WidgetDefinition = defineWidget({
  id: 'notification-feed',
  family: 'feeds',
  component: lazy(() => import('./feeds-track-f-components.js').then((m) => ({ default: m.NotificationFeedWidget }))),
  configSchema: notificationFeedConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 6, minH: 8, defaultW: 8, defaultH: 12 }, // annex 6×4 → 8×6
  placement: 'grid',
  skeleton: 'list',
  capabilities: { editsData: true },
  demoData: notificationFeedDemoData,
  descriptionKey: 'widgets.feeds.notificationFeed.description',
});

export const realtimeFeedDefinition: WidgetDefinition = defineWidget({
  id: 'realtime-feed',
  family: 'feeds',
  component: lazy(() => import('./feeds-track-f-components.js').then((m) => ({ default: m.RealtimeFeedWidget }))),
  configSchema: realtimeFeedConfigSchema,
  dataContract: 'stream',
  sizing: { minW: 4, minH: 8, defaultW: 4, defaultH: 12 }, // annex 4×4 → 4×6
  placement: 'grid',
  skeleton: 'list',
  capabilities: { realtime: true },
  demoData: realtimeFeedDemoData,
  descriptionKey: 'widgets.feeds.realtimeFeed.description',
});

export const timelineVerticalDefinition: WidgetDefinition = defineWidget({
  id: 'timeline-vertical',
  family: 'feeds',
  component: lazy(() => import('./feeds-track-f-components.js').then((m) => ({ default: m.TimelineVerticalWidget }))),
  configSchema: timelineVerticalConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 4, minH: 8, defaultW: 6, defaultH: 12 }, // annex 4×4 → 6×6
  placement: 'grid',
  skeleton: 'list',
  demoData: (seed) => timelineVerticalDemoData(seed),
  descriptionKey: 'widgets.feeds.timelineVertical.description',
});

export const unreadBadgeDefinition: WidgetDefinition = defineWidget({
  id: 'unread-badge',
  family: 'feeds',
  component: lazy(() => import('./feeds-track-f-components.js').then((m) => ({ default: m.UnreadBadgeWidget }))),
  configSchema: unreadBadgeConfigSchema,
  dataContract: 'single-metric',
  sizing: { minW: 1, minH: 1, defaultW: 1, defaultH: 1 },
  placement: 'inline',
  skeleton: 'block',
  demoData: unreadBadgeDemoData,
  descriptionKey: 'widgets.feeds.unreadBadge.description',
});

export const feedsTrackFDefinitions: readonly WidgetDefinition[] = [
  activityFeedDefinition,
  notificationFeedDefinition,
  realtimeFeedDefinition,
  timelineVerticalDefinition,
  unreadBadgeDefinition,
];
