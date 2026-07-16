import { getFormatters } from '@adminium/i18n';
import { Badge, EmptyState, MonoText } from '@adminium/ui';
import { useMemo } from 'react';

import {
  ANCHOR_TODAY,
  TONE_BORDER,
  categoryTone,
  fmtDayLabel,
  fmtEventTime,
  firstJsWeekday,
  isoDayKey,
  parseIsoDay,
  resolveLocale,
  toneOf,
  weekDays,
} from './calendar-lib.js';
import { eventsOf } from './CalendarMonth.js';
import type { DayAgendaConfig } from './calendar-config.js';
import type { CalendarEvent } from './calendar-types.js';
import type { WidgetProps } from '../../registry/types.js';

// Config schema + deterministic demo payload live in the pure `calendar-config`
// module so the registry metadata graph never reaches this component file
// (04 §2.3). Re-exported here to keep existing import points stable.
export { dayAgendaConfigSchema, dayAgendaDemoData } from './calendar-config.js';
export type { DayAgendaConfig } from './calendar-config.js';

/**
 * `day-agenda` (annex §5) — the selected-day (or week) event list: a colored
 * inline-start bar, title, mono time (range), a category pill, and a pluralized
 * count header. Time flows top→bottom, so the lane list reads identically under
 * RTL while the side bar and metadata mirror via logical properties. Binds to
 * `calendar-events` filtered to the selected day/week.
 */

export interface DayAgendaProps {
  events: readonly CalendarEvent[];
  date?: string | undefined;
  range?: 'day' | 'week' | undefined;
  firstDayOfWeek?: number | undefined;
  showCount?: boolean | undefined;
  locale?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  testId?: string | undefined;
}

/** Minutes-since-midnight for stable time sorting (`HH:MM`, all-day → -1). */
function minutesOf(event: CalendarEvent): number {
  if (event.time === undefined || !/^\d{1,2}:\d{2}$/.test(event.time)) return -1;
  const [h, m] = event.time.split(':').map(Number);
  return (h as number) * 60 + (m as number);
}

function EventRow({
  event,
  locale,
  categoryColorMap,
}: {
  event: CalendarEvent;
  locale: string;
  categoryColorMap?: Record<string, string> | undefined;
}) {
  const tone = event.tone !== undefined ? toneOf(event.tone) : categoryTone(event.category, categoryColorMap);
  const start = fmtEventTime(locale, event);
  const end = event.end !== undefined ? fmtEventTime(locale, { date: event.date, time: event.end }) : '';
  const timeLabel = end !== '' ? `${start} – ${end}` : start;
  return (
    <li className={`flex items-start gap-3 rounded-md border-s-4 bg-surface px-3 py-2 ${TONE_BORDER[tone]}`}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-sm font-semibold text-fg">{event.title}</p>
        {event.category !== undefined && (
          <Badge tone={tone} dot className="mt-1">
            {event.category}
          </Badge>
        )}
      </div>
      {timeLabel !== '' && (
        <MonoText className="shrink-0 whitespace-nowrap text-caption tabular-nums text-fg-muted">{timeLabel}</MonoText>
      )}
    </li>
  );
}

export function DayAgenda({
  events,
  date,
  range = 'day',
  firstDayOfWeek,
  showCount = true,
  locale,
  emptyTitle,
  emptyBody,
  testId,
}: DayAgendaProps) {
  const tag = resolveLocale(locale);
  const anchor = date ?? (events.length > 0 ? events[0]?.date : undefined) ?? ANCHOR_TODAY;
  const firstJs = firstJsWeekday(tag, firstDayOfWeek);

  const days = useMemo(() => {
    if (range === 'week') return weekDays(anchor, firstJs).map((d) => d.key);
    return [isoDayKey(parseIsoDay(anchor))];
  }, [range, anchor, firstJs]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const key of days) map.set(key, []);
    for (const event of events) {
      const key = isoDayKey(parseIsoDay(event.date));
      const bucket = map.get(key);
      if (bucket !== undefined) bucket.push(event);
    }
    for (const bucket of map.values()) bucket.sort((a, b) => minutesOf(a) - minutesOf(b));
    return map;
  }, [events, days]);

  const total = days.reduce((sum, key) => sum + (byDay.get(key)?.length ?? 0), 0);

  if (total === 0) {
    return (
      <EmptyState
        compact
        preset="nothing-scheduled"
        title={emptyTitle ?? 'Nothing scheduled'}
        body={emptyBody ?? 'Events for the selected day will appear here.'}
      />
    );
  }

  const countLabel = `${getFormatters(tag).number(total)} ${total === 1 ? 'event' : 'events'}`;

  return (
    <div data-widget="day-agenda" data-testid={testId} className="flex h-full flex-col">
      <div className="flex items-baseline justify-between border-b border-border/60 px-3 py-2">
        <h3 className="text-body-sm font-bold text-fg">{fmtDayLabel(tag, parseIsoDay(days[0] as string))}</h3>
        {showCount && <span className="text-caption font-semibold text-fg-subtle">{countLabel}</span>}
      </div>
      <div className="flex-1 space-y-2 overflow-auto p-3">
        {range === 'week'
          ? days.map((key) => {
              const dayEvents = byDay.get(key) ?? [];
              if (dayEvents.length === 0) return null;
              return (
                <section key={key}>
                  <h4 className="mb-1 text-caption font-bold uppercase tracking-wide text-fg-subtle">
                    {fmtDayLabel(tag, parseIsoDay(key))}
                  </h4>
                  <ul className="space-y-1.5">
                    {dayEvents.map((event, i) => (
                      <EventRow key={`${key}-${i}`} event={event} locale={tag} />
                    ))}
                  </ul>
                </section>
              );
            })
          : (
              <ul className="space-y-1.5">
                {(byDay.get(days[0] as string) ?? []).map((event, i) => (
                  <EventRow key={i} event={event} locale={tag} />
                ))}
              </ul>
            )}
      </div>
    </div>
  );
}

export function DayAgendaWidget({ config, data }: WidgetProps<DayAgendaConfig>) {
  return (
    <DayAgenda
      events={eventsOf(data)}
      {...(config.date === undefined ? {} : { date: config.date })}
      range={config.range}
      {...(config.firstDayOfWeek === undefined ? {} : { firstDayOfWeek: config.firstDayOfWeek })}
      showCount={config.showCount}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
    />
  );
}

