/**
 * `feeds` family Track-F component barrel — the single lazy-import target for
 * this track's definitions, so the registry's metadata graph reaches the
 * @adminium/ui-heavy widget components only through a dynamic `import()`
 * boundary (one lazy chunk for the family, 04 §2.3). Mirrors the kpi/charts
 * `components.ts` convention.
 */
export { ActivityFeedWidget } from './ActivityFeed.js';
export { NotificationFeedWidget } from './NotificationFeed.js';
export { RealtimeFeedWidget } from './RealtimeFeed.js';
export { TimelineVerticalWidget } from './TimelineVertical.js';
export { UnreadBadgeWidget } from './UnreadBadge.js';
