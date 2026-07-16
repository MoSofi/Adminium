/**
 * Data-contract shapes for the `feeds` family (annex §4). Types only — erased
 * at compile time, so both the pure `feeds-config` module (which the registry's
 * eager metadata graph reaches) and the widget components can name them without
 * either one importing the other. That keeps `feeds-config` free of component
 * code (04 §2.3, acceptance #3) AND keeps the module graph acyclic, which
 * `pnpm check-deps` enforces with `tsPreCompilationDeps`.
 *
 * The component files re-export these, so existing import points stay stable.
 */

/** One `activity-feed` row: an "actor action target" event with a timestamp. */
export interface ActivityItem {
  id: string | number;
  /** Category/verb key selecting the tinted glyph (feed-icons). */
  icon?: string | undefined;
  tone?: string | undefined;
  actor?: string | undefined;
  action?: string | undefined;
  target?: string | undefined;
  /** ISO 8601 timestamp. */
  ts: string;
}

/** An inline action button on a `notification-feed` row. */
export interface NotificationAction {
  key: string;
  label: string;
  tone?: string | undefined;
}

/** One `notification-feed` row. */
export interface NotificationItem {
  id: string | number;
  category?: string | undefined;
  categoryTone?: string | undefined;
  actor?: string | undefined;
  action?: string | undefined;
  target?: string | undefined;
  ts: string;
  read?: boolean | undefined;
  mention?: boolean | undefined;
  actions?: NotificationAction[] | undefined;
}

/** One `timeline-vertical` entry (shape covers all four variants). */
export interface TimelineEntry {
  id: string | number;
  title: string;
  ts: string;
  body?: string | undefined;
  tone?: string | undefined;
  icon?: string | undefined;
  tags?: string[] | undefined;
  log?: string | undefined;
  version?: string | undefined;
  /** incidents variant: severity drives the halo ring color. */
  severity?: string | undefined;
}

/** One `realtime-feed` stream event. */
export interface StreamEvent {
  id: string | number;
  ts: string;
  actor?: string | undefined;
  action?: string | undefined;
  target?: string | undefined;
  category?: string | undefined;
  tone?: string | undefined;
}
