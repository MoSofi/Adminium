import { EmptyState, IconTile } from '@adminium/ui';
import { ArrowRight } from 'lucide-react';
import { z } from 'zod';

import { feedIcon } from './feed-icons.js';
import {
  DEMO_EPOCH,
  FeedSentence,
  RelativeTime,
  feedRowsOf,
  mulberry32,
  pickFrom,
  toneOf,
} from './feed-lib.js';
import type { WidgetProps } from '../../registry/types.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

/**
 * `activity-feed` (annex §4) — rows of a tone-tinted icon tile + an "actor
 * action target" sentence (bold actor/target, mono target names) + a relative
 * mono timestamp, with an optional "View all" drill-through link. Binds to a
 * `record-list` of audit/event rows.
 */

export const activityFeedConfigSchema = widgetSharedConfigSchema.extend({
  limit: z.number().int().min(1).max(50).default(6),
  viewAllHref: z.string().optional(),
  viewAllLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type ActivityFeedConfig = z.infer<typeof activityFeedConfigSchema>;

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

export interface ActivityFeedProps {
  items: readonly ActivityItem[];
  limit?: number | undefined;
  viewAllHref?: string | undefined;
  viewAllLabel?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  /** Injectable clock for deterministic relative timestamps in tests. */
  now?: number | undefined;
  locale?: string | undefined;
  onViewAll?: (() => void) | undefined;
  testId?: string | undefined;
}

export function ActivityFeed({
  items,
  limit = 6,
  viewAllHref,
  viewAllLabel,
  emptyTitle,
  emptyBody,
  now,
  locale,
  onViewAll,
  testId,
}: ActivityFeedProps) {
  const slice = items.slice(0, limit);
  if (slice.length === 0) {
    return (
      <EmptyState
        compact
        preset="all-caught-up"
        title={emptyTitle ?? 'No recent activity'}
        body={emptyBody ?? 'Actions across your workspace will show up here.'}
      />
    );
  }
  return (
    <div data-widget="activity-feed" data-testid={testId} className="flex h-full flex-col">
      <ul className="flex-1 space-y-0.5 px-2 py-1">
        {slice.map((item) => (
          <li key={item.id} className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-surface-2/60">
            <IconTile size="sm" tone={toneOf(item.tone, 'accent')} icon={feedIcon(item.icon)} />
            <div className="min-w-0 flex-1 pt-0.5">
              <FeedSentence
                {...(item.actor === undefined ? {} : { actor: item.actor })}
                {...(item.action === undefined ? {} : { action: item.action })}
                {...(item.target === undefined ? {} : { target: item.target })}
              />
            </div>
            <RelativeTime iso={item.ts} {...(now === undefined ? {} : { now })} {...(locale === undefined ? {} : { locale })} className="mt-1 shrink-0" />
          </li>
        ))}
      </ul>
      {viewAllHref !== undefined && (
        <button
          type="button"
          data-part="activity-feed-view-all"
          onClick={onViewAll}
          className="flex items-center gap-1 border-t border-border/60 px-4 py-2.5 text-caption font-bold text-accent hover:underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        >
          {viewAllLabel ?? 'View all'}
          <ArrowRight className="size-3 rtl:-scale-x-100" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function activityItemsOf(data: unknown): ActivityItem[] {
  return feedRowsOf(data).map((row, index) => ({
    id: (row['id'] as string | number | undefined) ?? index,
    icon: typeof row['icon'] === 'string' ? row['icon'] : undefined,
    tone: typeof row['tone'] === 'string' ? row['tone'] : undefined,
    actor: typeof row['actor'] === 'string' ? row['actor'] : undefined,
    action: typeof row['action'] === 'string' ? row['action'] : undefined,
    target: typeof row['target'] === 'string' ? row['target'] : undefined,
    ts: typeof row['ts'] === 'string' ? row['ts'] : new Date(DEMO_EPOCH).toISOString(),
  }));
}

export function ActivityFeedWidget({ config, data, onEvent }: WidgetProps<ActivityFeedConfig>) {
  return (
    <ActivityFeed
      items={activityItemsOf(data)}
      limit={config.limit}
      {...(config.viewAllHref === undefined ? {} : { viewAllHref: config.viewAllHref })}
      {...(config.viewAllLabel === undefined ? {} : { viewAllLabel: config.viewAllLabel })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.format?.referenceTime === undefined ? {} : { now: config.format.referenceTime })}
      onViewAll={() => {
        if (config.viewAllHref !== undefined) onEvent({ type: 'drill-through', href: config.viewAllHref });
      }}
    />
  );
}

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
