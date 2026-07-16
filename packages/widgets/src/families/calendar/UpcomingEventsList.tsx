import { Avatar, EmptyState, MonoText, StatusPill, Tag } from '@adminium/ui';

import { upcomingEventsListConfigSchema, upcomingEventsListDemoData } from './calendar-config.js';
import {
  ANCHOR_TODAY,
  TONE_BORDER,
  categoryTone,
  fmtDayNumber,
  fmtEventTime,
  fmtMonthShort,
  isoDayKey,
  parseIsoDay,
  resolveLocale,
  toneOf,
  upcomingFrom,
} from './calendar-lib.js';
import type { UpcomingEventsListConfig } from './calendar-config.js';
import type { UpcomingEvent } from './calendar-types.js';
import type { WidgetProps } from '../../registry/types.js';

export { upcomingEventsListConfigSchema, upcomingEventsListDemoData };
export type { UpcomingEventsListConfig, UpcomingEvent };

/**
 * `upcoming-events-list` (annex §5) — the next-N feed, date-ascending: a date
 * block, a mono version/ref, a category pill, an owner avatar, a status pill,
 * and a colour-coded leading border (Release Calendar).
 *
 * The annex calls that border "colored left border"; it is implemented as
 * `border-s-4` — the LOGICAL inline-start side — so it sits on the right under
 * RTL, where the row actually starts. A physical `border-l` would strand the
 * accent on the wrong edge in `ar-EG` (10-i18n-theming.md §5.2).
 *
 * The "date ≥ today" cutoff resolves against an explicit reference day when one
 * is given (`fromDate`, else the shared `format.referenceTime`), so a story or
 * VRT capture is byte-stable without a wall-clock read; unpinned, it falls back
 * to the real clock, which is what a live page wants.
 */

export interface UpcomingEventsListProps {
  events: readonly UpcomingEvent[];
  n?: number | undefined;
  /** Cutoff day (`YYYY-MM-DD`); events before it are dropped. */
  fromDate?: string | undefined;
  categoryColorMap?: Record<string, string> | undefined;
  showOwner?: boolean | undefined;
  showStatus?: boolean | undefined;
  locale?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  onSelect?: ((event: UpcomingEvent) => void) | undefined;
  testId?: string | undefined;
}

export function UpcomingEventsList({
  events,
  n = 6,
  fromDate,
  categoryColorMap,
  showOwner = true,
  showStatus = true,
  locale,
  emptyTitle,
  emptyBody,
  onSelect,
  testId,
}: UpcomingEventsListProps) {
  const tag = resolveLocale(locale);
  const cutoff = fromDate ?? isoDayKey(new Date());
  const upcoming = upcomingFrom(events, cutoff, n);

  if (upcoming.length === 0) {
    return (
      <EmptyState
        compact
        preset="nothing-scheduled"
        title={emptyTitle ?? 'Nothing upcoming'}
        body={emptyBody ?? 'Scheduled events will appear here as they are planned.'}
      />
    );
  }

  return (
    <ul data-widget="upcoming-events-list" data-testid={testId} className="h-full space-y-1.5 overflow-auto p-2">
      {upcoming.map((event, index) => {
        const tone = event.tone === undefined ? categoryTone(event.category, categoryColorMap) : toneOf(event.tone);
        const day = parseIsoDay(event.date);
        const time = fmtEventTime(tag, event);
        const content = (
          <>
            {/* Date block: month name localizes, the day number stays latn +
                tabular so the blocks align in every locale (§4.2). */}
            <div data-part="date-block" className="flex w-11 shrink-0 flex-col items-center rounded-md bg-surface-2 px-1 py-1.5">
              <span className="text-[10px] font-bold uppercase leading-none text-fg-muted">
                {fmtMonthShort(tag, day)}
              </span>
              <MonoText className="text-body font-bold leading-tight text-fg">
                {fmtDayNumber(tag, day.getUTCDate())}
              </MonoText>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="min-w-0 truncate text-body-sm font-semibold text-fg">{event.title}</span>
                {event.ref !== undefined && (
                  <MonoText className="shrink-0 text-caption text-fg-subtle">{event.ref}</MonoText>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {event.category !== undefined && <Tag tone={tone}>{event.category}</Tag>}
                {time !== '' && <MonoText className="text-caption text-fg-muted">{time}</MonoText>}
              </div>
            </div>
            {showOwner && event.owner !== undefined && (
              <Avatar size="xs" name={event.owner} locale={tag} className="shrink-0" />
            )}
            {showStatus && event.status !== undefined && (
              /*
                `status` is the registry KEY (resolved to a tone by the shared
                status→tone map); the child is the already-localized label the
                host passed through the payload. An explicit `statusTone` still
                overrides the registry, which is how a domain-specific status the
                map has never seen still renders in its intended tone.
              */
              <StatusPill
                status={event.status}
                className="shrink-0"
                {...(event.statusTone === undefined ? {} : { tone: toneOf(event.statusTone, 'neutral') })}
              >
                {event.status}
              </StatusPill>
            )}
          </>
        );
        const shell = `flex items-center gap-3 rounded-md border-s-4 bg-surface-1 px-2.5 py-2 ${TONE_BORDER[tone]}`;
        return (
          <li key={event.id ?? index} data-part="upcoming-row" data-category={event.category}>
            {onSelect === undefined ? (
              <div className={shell}>{content}</div>
            ) : (
              <button
                type="button"
                onClick={() => onSelect(event)}
                className={`${shell} w-full text-start hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
              >
                {content}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Project an untrusted `calendar-events` payload onto `UpcomingEvent`s — the
 * `calendar-month` contract plus the Release Calendar's ref/owner/status slots
 * (annex §5 `rowMapping`).
 */
export function upcomingEventsOf(data: unknown): UpcomingEvent[] {
  const raw = Array.isArray(data)
    ? data
    : typeof data === 'object' && data !== null
      ? ((data as { events?: unknown; data?: unknown }).events ?? (data as { data?: unknown }).data)
      : undefined;
  if (!Array.isArray(raw)) return [];
  const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);
  return raw
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row): UpcomingEvent => ({
      id: row.id as string | number | undefined,
      date: str(row.date) ?? '',
      title: str(row.title) ?? '',
      category: str(row.category),
      time: str(row.time),
      tone: str(row.tone),
      ref: str(row.ref) ?? str(row.version),
      owner: str(row.owner) ?? str(row.assignee),
      status: str(row.status),
      statusTone: str(row.statusTone),
    }))
    .filter((event) => event.date !== '');
}

/**
 * The cutoff day: an explicit `fromDate` wins, then the shared
 * `format.referenceTime` clock (04 §2.1 — what makes demo/VRT captures stable),
 * else the caller's wall clock. `ANCHOR_TODAY` is NOT used as a fallback: a live
 * page with no pinned clock must follow the real date, not the demo epoch.
 */
export function cutoffDayOf(config: UpcomingEventsListConfig): string | undefined {
  if (config.fromDate !== undefined) return config.fromDate;
  const reference = config.format?.referenceTime;
  return reference === undefined ? undefined : isoDayKey(new Date(reference));
}

export function UpcomingEventsListWidget({ config, data, onEvent }: WidgetProps<UpcomingEventsListConfig>) {
  const cutoff = cutoffDayOf(config);
  return (
    <UpcomingEventsList
      events={upcomingEventsOf(data)}
      n={config.n}
      showOwner={config.showOwner}
      showStatus={config.showStatus}
      {...(cutoff === undefined ? {} : { fromDate: cutoff })}
      {...(config.categoryColorMap === undefined ? {} : { categoryColorMap: config.categoryColorMap })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
      {...(config.href === undefined
        ? {}
        : { onSelect: () => onEvent({ type: 'drill-through', href: config.href as string }) })}
    />
  );
}

/** Re-exported so stories/tests can pin the same anchor the generators use. */
export { ANCHOR_TODAY };
