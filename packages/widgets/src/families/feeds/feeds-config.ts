/**
 * `feeds` family config schemas + deterministic demo generators — PURE module
 * (zod, the shared config, the framework-free `feed-demo-lib` primitives and
 * `feeds-types` types only; no React, no component code).
 *
 * WHY THIS EXISTS: `registry/index.ts` statically imports
 * `feeds-track-f.definitions.ts`, so everything that module imports lands in the
 * registry's EAGER graph. While the schemas + demo payloads lived in
 * `ActivityFeed.tsx` / `NotificationFeed.tsx` / `RealtimeFeed.tsx` /
 * `TimelineVertical.tsx` / `UnreadBadge.tsx`, the definitions had to reach into
 * those component modules to name them — which pulled all five widgets and their
 * @adminium/ui deps into the eager chunk and left the sibling
 * `lazy(() => import('./feeds-track-f-components.js'))` refs buying nothing.
 * Holding them here (the boards/domain/media `*-config` convention) lets the
 * definitions import metadata only, so the components stay reachable exclusively
 * through the lazy barrel (04 §2.3, acceptance #3; enforced by
 * `qa/chunk-budget.test.ts`).
 *
 * The component files re-export these symbols, so the family barrel, stories and
 * tests keep their existing import points.
 */
import { z } from 'zod';

import { DEMO_EPOCH, MS_DAY, mulberry32, pickFrom } from './feed-demo-lib.js';
import type {
  ActivityItem,
  NotificationAction,
  NotificationItem,
  StreamEvent,
  TimelineEntry,
} from './feeds-types.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

// ── activity-feed (annex §4) ───────────────────────────────────────────────
export const activityFeedConfigSchema = widgetSharedConfigSchema.extend({
  limit: z.number().int().min(1).max(50).default(6),
  viewAllHref: z.string().optional(),
  viewAllLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type ActivityFeedConfig = z.infer<typeof activityFeedConfigSchema>;

const ACTORS = ['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Edsger Dijkstra', 'Katherine Johnson'] as const;
const EVENTS = [
  { icon: 'created', tone: 'pos', action: 'created', target: 'invoice #4821' },
  { icon: 'updated', tone: 'accent', action: 'updated', target: 'Acme Holdings' },
  { icon: 'approved', tone: 'pos', action: 'approved', target: 'expense report #77' },
  { icon: 'commented', tone: 'info', action: 'commented on', target: 'Ticket-1042' },
  { icon: 'deleted', tone: 'danger', action: 'deleted', target: 'api_key/legacy' },
  { icon: 'invited', tone: 'accent', action: 'invited', target: 'jordan@globex.com' },
  { icon: 'deployed', tone: 'info', action: 'deployed', target: 'web@v2.4.0' },
] as const;

/** Deterministic `record-list` of activity rows (04 §7.7). */
export function activityFeedDemoData(seed: number): { data: ActivityItem[] } {
  const random = mulberry32(seed || 1);
  const data = Array.from({ length: 8 }, (_, index) => {
    const event = pickFrom(random, EVENTS);
    return {
      id: index + 1,
      icon: event.icon,
      tone: event.tone,
      actor: pickFrom(random, ACTORS),
      action: event.action,
      target: event.target,
      ts: new Date(DEMO_EPOCH - Math.floor(random() * 72) * 3_600_000 - index * 137_000).toISOString(),
    };
  });
  return { data };
}

// ── notification-feed (annex §4) ───────────────────────────────────────────
export const notificationFeedConfigSchema = widgetSharedConfigSchema.extend({
  tabs: z.boolean().default(true),
  inlineActions: z.boolean().default(true),
  markAllRead: z.boolean().default(true),
  /** Localized copy (host resolves via i18n; English defaults keep stories pure). */
  labels: z
    .object({
      all: z.string().optional(),
      unread: z.string().optional(),
      mentions: z.string().optional(),
      markAllRead: z.string().optional(),
      today: z.string().optional(),
      yesterday: z.string().optional(),
      earlier: z.string().optional(),
      dismiss: z.string().optional(),
      emptyAllTitle: z.string().optional(),
      emptyAllBody: z.string().optional(),
      emptyUnreadTitle: z.string().optional(),
      emptyMentionsTitle: z.string().optional(),
    })
    .optional(),
});
export type NotificationFeedConfig = z.infer<typeof notificationFeedConfigSchema>;

const N_CATEGORIES = [
  { category: 'approval', actor: 'Grace Hopper', action: 'requested approval on', target: 'expense #204', actions: [{ key: 'accept', label: 'Approve' }, { key: 'reject', label: 'Decline', tone: 'danger' }] },
  { category: 'mention', actor: 'Alan Turing', action: 'mentioned you in', target: 'Ticket-1042', mention: true },
  { category: 'billing', actor: 'System', action: 'payment failed for', target: 'Acme Holdings' },
  { category: 'security', actor: 'System', action: 'new sign-in from', target: '203.0.113.9' },
  { category: 'release', actor: 'Ada Lovelace', action: 'published', target: 'web@v2.4.0' },
  { category: 'system', actor: 'System', action: 'finished export', target: 'customers.csv' },
] as const;

/** Deterministic `record-list` of notifications spanning today/yesterday/earlier. */
export function notificationFeedDemoData(seed: number): { data: NotificationItem[] } {
  const random = mulberry32(seed || 1);
  const data = Array.from({ length: 9 }, (_, index) => {
    const base = N_CATEGORIES[index % N_CATEGORIES.length]!;
    const dayOffset = index < 3 ? 0 : index < 5 ? 1 : 2 + (index - 5);
    return {
      id: index + 1,
      category: base.category,
      actor: base.actor,
      action: base.action,
      target: base.target,
      ts: new Date(DEMO_EPOCH - dayOffset * MS_DAY - Math.floor(random() * 6) * 3_600_000).toISOString(),
      read: random() > 0.6,
      mention: (base as { mention?: boolean }).mention === true,
      ...(('actions' in base && base.actions !== undefined) ? { actions: [...base.actions] as NotificationAction[] } : {}),
    };
  });
  return { data };
}

// ── realtime-feed (annex §4) ───────────────────────────────────────────────
export const realtimeFeedConfigSchema = widgetSharedConfigSchema.extend({
  maxRows: z.number().int().min(3).max(200).default(40),
  pausable: z.boolean().default(true),
  pulseCompanion: z.boolean().default(true),
  labels: z
    .object({
      pause: z.string().optional(),
      resume: z.string().optional(),
      live: z.string().optional(),
      paused: z.string().optional(),
      buffered: z.string().optional(),
      emptyTitle: z.string().optional(),
      emptyBody: z.string().optional(),
    })
    .optional(),
});
export type RealtimeFeedConfig = z.infer<typeof realtimeFeedConfigSchema>;

const STREAM_EVENTS = [
  { category: 'api', tone: 'info', action: 'GET', target: '/v1/orders' },
  { category: 'webhook', tone: 'accent', action: 'delivered', target: 'order.paid' },
  { category: 'auth', tone: 'pos', action: 'signed in', target: 'session/9f2' },
  { category: 'error', tone: 'danger', action: 'failed job', target: 'export#331' },
  { category: 'sync', tone: 'info', action: 'synced', target: 'customers' },
  { category: 'payment', tone: 'pos', action: 'charged', target: '$149.00' },
] as const;
const STREAM_ACTORS = ['edge-1', 'worker-3', 'api-gw', 'cron', 'jordan@globex.com'] as const;

/** Deterministic `stream` snapshot (04 §7.7). */
export function realtimeFeedDemoData(seed: number): { snapshot: StreamEvent[]; cursor: string } {
  const random = mulberry32(seed || 1);
  const snapshot = Array.from({ length: 24 }, (_, index) => {
    const event = pickFrom(random, STREAM_EVENTS);
    return {
      id: `evt_${String(seed)}_${String(index)}`,
      ts: new Date(DEMO_EPOCH - index * 2_500 - Math.floor(random() * 900)).toISOString(),
      actor: pickFrom(random, STREAM_ACTORS),
      action: event.action,
      target: event.target,
      category: event.category,
      tone: event.tone,
    };
  });
  return { snapshot, cursor: `c_${String(seed)}` };
}

// ── timeline-vertical (annex §4) ───────────────────────────────────────────
const timelineVariant = z.enum(['activity', 'changelog', 'incidents', 'trace']);

export const timelineVerticalConfigSchema = widgetSharedConfigSchema.extend({
  variant: timelineVariant.default('activity'),
  connectorStyle: z.enum(['solid', 'dashed']).default('solid'),
  tagToneMap: z.record(z.string(), z.enum(['neutral', 'accent', 'pos', 'warn', 'danger', 'info'])).optional(),
});
export type TimelineVerticalConfig = z.infer<typeof timelineVerticalConfigSchema>;

const DEMO_BY_VARIANT: Record<TimelineVerticalConfig['variant'], (i: number) => Partial<TimelineEntry>> = {
  activity: (i) => ({ icon: pickFrom(mulberry32(i + 1), ['created', 'updated', 'commented', 'approved'] as const), title: ['Record created', 'Field updated', 'Comment added', 'Status approved'][i % 4] ?? 'Event', tone: ['pos', 'accent', 'info', 'pos'][i % 4] }),
  changelog: (i) => ({ version: `v2.${String(4 - i)}.0`, title: ['Realtime feeds', 'Schema tree explorer', 'Toggle matrix', 'Card gallery'][i % 4] ?? 'Release', tone: 'info', tags: [['feature'], ['feature', 'a11y'], ['fix'], ['feature']][i % 4], body: 'Shipped to all workspaces.' }),
  incidents: (i) => ({ severity: (['sev1', 'sev2', 'sev3'] as const)[i % 3], title: ['API latency spike', 'Elevated error rate', 'Degraded webhooks'][i % 3] ?? 'Incident', body: 'Postmortem: root cause identified and mitigated.' }),
  trace: (i) => ({ tone: (['pos', 'pos', 'warn', 'danger'] as const)[i % 4], title: ['validate', 'transform', 'load', 'notify'][i % 4] ?? 'step', log: `step ${String(i)} · 128ms · ok` }),
};

/** Deterministic ordered `record-list` for the given variant. */
export function timelineVerticalDemoData(seed: number, variant: TimelineVerticalConfig['variant'] = 'activity'): { data: TimelineEntry[] } {
  const random = mulberry32(seed || 1);
  const data = Array.from({ length: 5 }, (_, index) => {
    const partial = DEMO_BY_VARIANT[variant](index);
    return {
      id: index + 1,
      title: partial.title ?? 'Event',
      ts: new Date(DEMO_EPOCH - index * 5 * 3_600_000 - Math.floor(random() * 3600) * 1000).toISOString(),
      ...partial,
    } as TimelineEntry;
  });
  return { data };
}

// ── unread-badge (annex §4) ────────────────────────────────────────────────
export const unreadBadgeConfigSchema = widgetSharedConfigSchema.extend({
  /** Overflow cap — counts above render as "{max}+". */
  max: z.number().int().min(1).max(9999).default(99),
  /** Hide the pill entirely when the count is zero (nav-item behavior). */
  hideZero: z.boolean().default(true),
  /** Solid accent treatment (unread) vs neutral surface pill. */
  active: z.boolean().default(true),
  /** Accessible label suffix, e.g. "unread". */
  unitLabel: z.string().optional(),
});
export type UnreadBadgeConfig = z.infer<typeof unreadBadgeConfigSchema>;

/** Deterministic non-zero count (04 §7.7). */
export function unreadBadgeDemoData(seed: number): { value: number } {
  const random = mulberry32(seed || 1);
  return { value: Math.floor(random() * 40) + 1 };
}
