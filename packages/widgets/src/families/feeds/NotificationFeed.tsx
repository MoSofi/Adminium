import { Badge, Button, EmptyState, IconButton } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import { CheckCheck, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';

import { feedIcon } from './feed-icons.js';
import {
  DEMO_EPOCH,
  FeedSentence,
  RelativeTime,
  feedRowsOf,
  mulberry32,
  toneOf,
} from './feed-lib.js';
import type { WidgetProps } from '../../registry/types.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

/**
 * `notification-feed` (annex §4) — a time-bucketed grouped feed
 * (Today/Yesterday/Earlier) with unread tint + dot, category chips, optional
 * inline action buttons, hover dismiss, empty-group pruning, mark-all-read,
 * and a tabbed All/Unread/Mentions filter. Fixes the Ticket-Queue-class empty
 * gaps (research/ia-mapping.md §5): every filter renders a purpose-specific
 * empty state instead of a blank panel.
 */

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

export interface NotificationAction {
  key: string;
  label: string;
  tone?: string | undefined;
}

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

type Tab = 'all' | 'unread' | 'mentions';
type Bucket = 'today' | 'yesterday' | 'earlier';

const MS_DAY = 86_400_000;

/** Day-bucket an item relative to `now` (locale-agnostic UTC-day math is fine for demo). */
export function bucketOf(iso: string, now: number): Bucket {
  const startOfDay = (ms: number): number => {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };
  const diffDays = Math.round((startOfDay(now) - startOfDay(new Date(iso).getTime())) / MS_DAY);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  return 'earlier';
}

const BUCKET_ORDER: readonly Bucket[] = ['today', 'yesterday', 'earlier'];

export interface NotificationFeedProps {
  items: readonly NotificationItem[];
  tabs?: boolean | undefined;
  inlineActions?: boolean | undefined;
  markAllRead?: boolean | undefined;
  labels?: NotificationFeedConfig['labels'];
  now?: number | undefined;
  locale?: string | undefined;
  onMarkAllRead?: (() => void) | undefined;
  onDismiss?: ((id: string | number) => void) | undefined;
  onAction?: ((id: string | number, actionKey: string) => void) | undefined;
  testId?: string | undefined;
}

export function NotificationFeed({
  items,
  tabs = true,
  inlineActions = true,
  markAllRead = true,
  labels,
  now,
  locale,
  onMarkAllRead,
  onDismiss,
  onAction,
  testId,
}: NotificationFeedProps) {
  const clock = now ?? Date.now();
  const [tab, setTab] = useState<Tab>('all');
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(new Set());
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  const isRead = (item: NotificationItem): boolean =>
    item.read === true || readIds.has(String(item.id));

  const visible = useMemo(
    () => items.filter((item) => !dismissed.has(String(item.id))),
    [items, dismissed],
  );
  const unreadCount = visible.filter((item) => !isRead(item)).length;

  const filtered = visible.filter((item) => {
    if (tab === 'unread') return !isRead(item);
    if (tab === 'mentions') return item.mention === true || item.category === 'mention';
    return true;
  });

  const buckets = BUCKET_ORDER.map((bucket) => ({
    bucket,
    items: filtered.filter((item) => bucketOf(item.ts, clock) === bucket),
  })).filter((group) => group.items.length > 0);

  const bucketLabel: Record<Bucket, string> = {
    today: labels?.today ?? 'Today',
    yesterday: labels?.yesterday ?? 'Yesterday',
    earlier: labels?.earlier ?? 'Earlier',
  };

  const tabDefs: { id: Tab; label: string; count?: number }[] = [
    { id: 'all', label: labels?.all ?? 'All' },
    { id: 'unread', label: labels?.unread ?? 'Unread', count: unreadCount },
    { id: 'mentions', label: labels?.mentions ?? 'Mentions' },
  ];

  const markAll = () => {
    setReadIds(new Set(visible.map((item) => String(item.id))));
    onMarkAllRead?.();
  };
  const dismiss = (id: string | number) => {
    setDismissed((prev) => new Set(prev).add(String(id)));
    onDismiss?.(id);
  };

  return (
    <div data-widget="notification-feed" data-testid={testId} className="flex h-full flex-col">
      {(tabs || markAllRead) && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          {tabs && (
            <div role="tablist" aria-label="Notification filter" className="flex items-center gap-1">
              {tabDefs.map((def) => (
                <button
                  key={def.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === def.id}
                  data-active={tab === def.id}
                  onClick={() => setTab(def.id)}
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-caption font-semibold text-fg-muted data-[active=true]:bg-surface-3 data-[active=true]:text-fg hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                >
                  {def.label}
                  {def.count !== undefined && def.count > 0 && (
                    <span className="rounded-full bg-accent px-1.5 font-mono text-[10px] font-bold leading-tight text-accent-fg tabular-nums">
                      {def.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {markAllRead && (
            <Button
              size="sm"
              variant="ghost"
              className="ms-auto"
              iconLeft={<CheckCheck />}
              disabled={unreadCount === 0}
              onClick={markAll}
            >
              {labels?.markAllRead ?? 'Mark all read'}
            </Button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {buckets.length === 0 ? (
          <EmptyState
            compact
            preset={tab === 'all' ? 'no-data' : 'all-caught-up'}
            title={
              tab === 'unread'
                ? (labels?.emptyUnreadTitle ?? "You're all caught up")
                : tab === 'mentions'
                  ? (labels?.emptyMentionsTitle ?? 'No mentions')
                  : (labels?.emptyAllTitle ?? 'No notifications')
            }
            body={tab === 'all' ? (labels?.emptyAllBody ?? 'New notifications will appear here.') : undefined}
          />
        ) : (
          buckets.map((group) => (
            <section key={group.bucket} data-bucket={group.bucket}>
              <h4 className="sticky top-0 z-[1] bg-surface/95 px-4 py-1.5 text-caption font-bold uppercase tracking-wide text-fg-subtle backdrop-blur">
                {bucketLabel[group.bucket]}
              </h4>
              <ul>
                {group.items.map((item) => {
                  const read = isRead(item);
                  return (
                    <li
                      key={item.id}
                      data-read={read}
                      className="group/notif relative flex items-start gap-3 px-4 py-2.5 data-[read=false]:bg-accent/[0.04] hover:bg-surface-2/60"
                    >
                      {!read && (
                        <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-accent" />
                      )}
                      <span className={read ? 'shrink-0' : 'hidden'} aria-hidden="true">
                        <span className="mt-2 block size-2 shrink-0" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {item.category !== undefined && (
                            <Badge tone={toneOf(item.categoryTone, categoryTone(item.category))}>
                              {item.category}
                            </Badge>
                          )}
                          <RelativeTime iso={item.ts} now={clock} {...(locale === undefined ? {} : { locale })} />
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-fg-subtle">{feedIcon(item.category)}</span>
                          <FeedSentence
                            {...(item.actor === undefined ? {} : { actor: item.actor })}
                            {...(item.action === undefined ? {} : { action: item.action })}
                            {...(item.target === undefined ? {} : { target: item.target })}
                          />
                        </div>
                        {inlineActions && item.actions !== undefined && item.actions.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {item.actions.map((action) => (
                              <Button
                                key={action.key}
                                size="sm"
                                variant={action.tone === 'danger' ? 'destructiveSoft' : 'primary'}
                                onClick={() => {
                                  setReadIds((prev) => new Set(prev).add(String(item.id)));
                                  onAction?.(item.id, action.key);
                                }}
                              >
                                {action.label}
                              </Button>
                            ))}
                          </div>
                        )}
                      </div>
                      <IconButton
                        size="sm"
                        label={labels?.dismiss ?? 'Dismiss'}
                        className="opacity-0 transition-opacity group-hover/notif:opacity-100 focus-visible:opacity-100"
                        onClick={() => dismiss(item.id)}
                      >
                        <X size={14} />
                      </IconButton>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

const CATEGORY_TONES: Record<string, Tone> = {
  billing: 'warn',
  security: 'danger',
  incident: 'danger',
  mention: 'info',
  system: 'neutral',
  approval: 'accent',
  release: 'info',
};
function categoryTone(category: string): Tone {
  return CATEGORY_TONES[category] ?? 'neutral';
}

function notificationItemsOf(data: unknown): NotificationItem[] {
  return feedRowsOf(data).map((row, index) => ({
    id: (row['id'] as string | number | undefined) ?? index,
    category: typeof row['category'] === 'string' ? row['category'] : typeof row['cat'] === 'string' ? (row['cat'] as string) : undefined,
    categoryTone: typeof row['categoryTone'] === 'string' ? row['categoryTone'] : undefined,
    actor: typeof row['actor'] === 'string' ? row['actor'] : undefined,
    action: typeof row['action'] === 'string' ? row['action'] : undefined,
    target: typeof row['target'] === 'string' ? row['target'] : undefined,
    ts: typeof row['ts'] === 'string' ? row['ts'] : new Date(DEMO_EPOCH).toISOString(),
    read: row['read'] === true,
    mention: row['mention'] === true || row['category'] === 'mention' || row['cat'] === 'mention',
    actions: Array.isArray(row['actions']) ? (row['actions'] as NotificationAction[]) : undefined,
  }));
}

export function NotificationFeedWidget({ config, data, onEvent }: WidgetProps<NotificationFeedConfig>) {
  const source = config.binding;
  const table = source === undefined ? undefined : source.source.schema === undefined ? source.source.name : `${source.source.schema}.${source.source.name}`;
  return (
    <NotificationFeed
      items={notificationItemsOf(data)}
      tabs={config.tabs}
      inlineActions={config.inlineActions}
      markAllRead={config.markAllRead}
      {...(config.labels === undefined ? {} : { labels: config.labels })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.format?.referenceTime === undefined ? {} : { now: config.format.referenceTime })}
      onDismiss={(id) => {
        if (table !== undefined && source !== undefined) {
          onEvent({ type: 'mutate', intent: 'update', connectionId: source.connectionId, table, recordId: id, values: { dismissed: true } });
        }
      }}
      onMarkAllRead={() => {
        if (table !== undefined && source !== undefined) {
          onEvent({ type: 'mutate', intent: 'update', connectionId: source.connectionId, table, values: { read: true } });
        }
      }}
    />
  );
}

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
