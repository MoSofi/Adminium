/**
 * `feeds` family public surface (annex §4) — standalone feed/list components
 * plus the Track-F registry metadata. Component code is also reachable through
 * each definition's `lazy()` ref, so the registry still emits one chunk per
 * family (04 §2.3); this barrel is for direct template/story composition and
 * tests. Registry metadata lives in `feeds-track-f.definitions.ts`.
 */
export {
  ActivityFeed,
  ActivityFeedWidget,
  activityFeedConfigSchema,
  activityFeedDemoData,
  type ActivityFeedConfig,
  type ActivityFeedProps,
  type ActivityItem,
} from './ActivityFeed.js';
export {
  NotificationFeed,
  NotificationFeedWidget,
  bucketOf,
  notificationFeedConfigSchema,
  notificationFeedDemoData,
  type NotificationAction,
  type NotificationFeedConfig,
  type NotificationFeedProps,
  type NotificationItem,
} from './NotificationFeed.js';
export {
  RealtimeFeed,
  RealtimeFeedWidget,
  pulseBuckets,
  realtimeFeedConfigSchema,
  realtimeFeedDemoData,
  type RealtimeFeedConfig,
  type RealtimeFeedProps,
  type StreamEvent,
} from './RealtimeFeed.js';
export {
  TimelineVertical,
  TimelineVerticalWidget,
  timelineVerticalConfigSchema,
  timelineVerticalDemoData,
  type TimelineEntry,
  type TimelineVerticalConfig,
  type TimelineVerticalProps,
} from './TimelineVertical.js';
export {
  UnreadBadge,
  UnreadBadgeWidget,
  formatCount,
  unreadBadgeConfigSchema,
  unreadBadgeDemoData,
  type UnreadBadgeConfig,
  type UnreadBadgeProps,
} from './UnreadBadge.js';
export {
  activityFeedDefinition,
  feedsTrackFDefinitions,
  notificationFeedDefinition,
  realtimeFeedDefinition,
  timelineVerticalDefinition,
  unreadBadgeDefinition,
} from './feeds-track-f.definitions.js';
