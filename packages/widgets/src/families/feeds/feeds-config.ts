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
  ToastEntry,
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

// ── load-older-paginator (annex §4) ────────────────────────────────────────
export const loadOlderPaginatorConfigSchema = widgetSharedConfigSchema.extend({
  /** Older records appended per click (annex §4 `batchSize`). */
  batchSize: z.number().int().min(1).max(200).default(20),
  /** Button copy ("Load older"). */
  label: z.string().optional(),
  /** In-flight copy ("Loading…"). */
  loadingLabel: z.string().optional(),
  /** Relabel on exhaustion — the annex's "relabels/disappears" (annex §4). */
  exhaustedLabel: z.string().optional(),
  /** Disappear instead of relabelling once the pool is drained. */
  hideWhenExhausted: z.boolean().default(false),
  /** Show the "N of M" mono progress caption above the button. */
  showRemaining: z.boolean().default(true),
  /** Caption connective ("of"). */
  ofLabel: z.string().optional(),
});
export type LoadOlderPaginatorConfig = z.infer<typeof loadOlderPaginatorConfigSchema>;

/**
 * Deterministic `record-list` cursor demo payload (04 §7.7). The annex's
 * contract is "cursor into older pool", which rides the canonical §3
 * `record-list` envelope: `rows` are what is already on screen, `total` is the
 * pool size, and a non-null `cursor` is what makes more fetchable.
 */
export function loadOlderPaginatorDemoData(seed: number): {
  rows: unknown[];
  total: number;
  cursor: string;
  loaded: number;
} {
  const random = mulberry32(seed || 1);
  const total = 40 + Math.floor(random() * 160);
  const loaded = 10 + Math.floor(random() * 20);
  return { rows: Array.from({ length: loaded }, (_, index) => ({ id: index + 1 })), total, cursor: `older-${loaded}`, loaded };
}

// ── toast-stack (annex §4; cross-listed as undo-toast in §12) ──────────────

/**
 * The overlay toast HOST. Registered as a thin wrapper over @adminium/ui's
 * `ToastStack` + `useToastQueue` (03 §7.2) rather than a reimplementation —
 * max-4 clamping, FIFO overflow, per-variant auto-dismiss, pause-on-hover and
 * the undo-action duration already live there and are already tested.
 */
export const toastStackConfigSchema = widgetSharedConfigSchema.extend({
  /** Simultaneously visible toasts (annex §4 `maxVisible`, max 4). */
  maxVisible: z.number().int().min(1).max(4).default(4),
  /** Auto-dismiss in ms (annex §4 `durations`: 2.6s plain). */
  duration: z.number().int().min(500).max(60_000).default(2600),
  /** Auto-dismiss for a toast carrying Undo (annex §4: 5.2s). */
  undoDuration: z.number().int().min(500).max(60_000).default(5200),
  /** Annex §4 `position`. */
  position: z.enum(['bottom-center', 'bottom-end', 'top-center', 'top-end']).default('bottom-center'),
  undoLabel: z.string().optional(),
  dismissLabel: z.string().optional(),
  /** Accessible name for the toast region. */
  regionLabel: z.string().optional(),
});
export type ToastStackConfig = z.infer<typeof toastStackConfigSchema>;

const TOAST_SAMPLES: readonly { message: string; variant: string; undoable: boolean; table?: string }[] = [
  { message: 'Invoice #4821 deleted', variant: 'success', undoable: true, table: 'invoices' },
  { message: 'Acme Holdings updated', variant: 'success', undoable: true, table: 'customers' },
  { message: '3 tickets moved to Done', variant: 'success', undoable: true, table: 'tickets' },
  { message: 'Export queued — we will email you the file', variant: 'info', undoable: false },
  { message: 'Webhook endpoint could not be reached', variant: 'error', undoable: false },
  { message: 'API key rotated', variant: 'warning', undoable: true, table: 'api_keys' },
];

/**
 * Deterministic ephemeral-toast demo payload (04 §7.7). SEEDED rather than
 * fixed: `toast-stack` is a `static`-contract widget, but its payload is a
 * SAMPLE from a catalogue (unlike `upload-dropzone`/`empty-state`, whose whole
 * payload IS their config), so the determinism gate's "seed actually threads
 * into the generator" check applies and the id stays off `SEED_INVARIANT_IDS`.
 */
export function toastStackDemoData(seed: number): { toasts: ToastEntry[] } {
  const random = mulberry32(seed || 1);
  const count = 2 + Math.floor(random() * 3);
  const offset = Math.floor(random() * TOAST_SAMPLES.length);
  const toasts = Array.from({ length: count }, (_, index) => {
    const sample = TOAST_SAMPLES[(offset + index) % TOAST_SAMPLES.length] as (typeof TOAST_SAMPLES)[number];
    return {
      id: `toast-${index + 1}`,
      message: sample.message,
      variant: sample.variant,
      ...(sample.undoable ? { undoToken: `undo-${index + 1}` } : {}),
      ...(sample.table === undefined ? {} : { table: sample.table, recordId: index + 1 }),
    } satisfies ToastEntry;
  });
  return { toasts };
}
