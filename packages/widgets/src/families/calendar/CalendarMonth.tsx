// SPDX-License-Identifier: AGPL-3.0-only
import { useMaybeT } from '@adminium/i18n/react';
import { EmptyState, MonoText } from '@adminium/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  ANCHOR_MONTH,
  ANCHOR_YEAR,
  TONE_SOFT_BORDER,
  categoryTone,
  fmtDayNumber,
  fmtEventTime,
  fmtMonthTitle,
  firstJsWeekday,
  isoDayKey,
  monthGrid,
  parseIsoDay,
  resolveLocale,
  toneOf,
  weekdayHeaders,
} from './calendar-lib.js';
import type { CalendarMonthConfig } from './calendar-config.js';
import type { CalendarEvent } from './calendar-types.js';
import type { WidgetProps } from '../../registry/types.js';

// Config schema + deterministic demo payload live in the pure `calendar-config`
// module so the registry metadata graph never reaches this component file
// (04 §2.3). Re-exported here to keep existing import points stable.
export { calendarMonthConfigSchema, calendarMonthDemoData } from './calendar-config.js';
export type { CalendarMonthConfig } from './calendar-config.js';

/**
 * `calendar-month` (annex §5) — a 42-cell month grid: day numbers, up to N
 * color-coded event chips per day + a "+N more" overflow, a today ring, a
 * selected-day tint, and month navigation. The 7-column CSS grid mirrors under
 * `dir="rtl"` (columns run right→left) and the week starts on the locale's
 * first weekday via the @adminium/i18n `weekInfo` layer. Binds to the
 * `calendar-events` shape.
 */

export interface CalendarMonthProps {
  events: readonly CalendarEvent[];
  year?: number | undefined;
  month?: number | undefined;
  firstDayOfWeek?: number | undefined;
  maxChipsPerDay?: number | undefined;
  categoryColorMap?: Record<string, string> | undefined;
  /** ISO day highlighted with the today ring (injectable for deterministic VRT). */
  today?: string | undefined;
  /** Initially-selected ISO day (tinted). */
  selectedDate?: string | undefined;
  locale?: string | undefined;
  onDaySelect?: ((iso: string) => void) | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  testId?: string | undefined;
}

/** Group events by their ISO day key. */
function groupByDay(events: readonly CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = isoDayKey(parseIsoDay(event.date));
    const list = map.get(key);
    if (list === undefined) map.set(key, [event]);
    else list.push(event);
  }
  return map;
}

/** Pick the displayed month: explicit config, else the modal event month, else anchor. */
function inferMonth(events: readonly CalendarEvent[], year?: number, month?: number): { year: number; month: number } {
  if (year !== undefined && month !== undefined) return { year, month };
  if (events.length > 0) {
    const counts = new Map<string, number>();
    for (const event of events) {
      const date = parseIsoDay(event.date);
      const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let bestKey = '';
    let bestCount = -1;
    for (const [key, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        bestKey = key;
      }
    }
    const [y, m] = bestKey.split('-').map(Number);
    return { year: year ?? (y as number), month: month ?? (m as number) };
  }
  return { year: year ?? ANCHOR_YEAR, month: month ?? ANCHOR_MONTH };
}

export function CalendarMonth({
  events,
  year,
  month,
  firstDayOfWeek,
  maxChipsPerDay = 2,
  categoryColorMap,
  today,
  selectedDate,
  locale,
  onDaySelect,
  emptyTitle,
  emptyBody,
  testId,
}: CalendarMonthProps) {
  const t = useMaybeT();
  const tag = resolveLocale(locale);
  const base = useMemo(() => inferMonth(events, year, month), [events, year, month]);
  const [view, setView] = useState(base);
  const [selected, setSelected] = useState<string | undefined>(selectedDate);

  const firstJs = firstJsWeekday(tag, firstDayOfWeek);
  const headers = useMemo(() => weekdayHeaders(tag, firstJs), [tag, firstJs]);
  const cells = useMemo(() => monthGrid(view.year, view.month, firstJs), [view, firstJs]);
  const byDay = useMemo(() => groupByDay(events), [events]);

  const step = (delta: number) => {
    setView((prev) => {
      const next = new Date(Date.UTC(prev.year, prev.month + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    });
  };

  const title = fmtMonthTitle(tag, new Date(Date.UTC(view.year, view.month, 1)));

  // NB the empty state only renders when the host CONFIGURES an `emptyTitle`
  // (an unconfigured empty month still shows the grid), so the title has no
  // wired bundle default — its emptyTitle key is a config-layer suggestion.
  if (events.length === 0 && emptyTitle !== undefined) {
    return (
      <EmptyState
        compact
        preset="nothing-scheduled"
        title={emptyTitle}
        body={emptyBody ?? t('ui:widgets.calendar.calendarMonth.emptyBody', 'Scheduled events will appear on this calendar.')}
      />
    );
  }

  return (
    <div data-widget="calendar-month" data-testid={testId} className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-body font-bold text-fg">{title}</h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t('ui:widgets.calendar.calendarMonth.previousLabel', 'Previous month')}
            data-part="calendar-prev"
            onClick={() => step(-1)}
            className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          >
            <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t('ui:widgets.calendar.calendarMonth.nextLabel', 'Next month')}
            data-part="calendar-next"
            onClick={() => step(1)}
            className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          >
            <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div role="grid" aria-label={title} className="grid flex-1 grid-rows-[auto_repeat(6,1fr)] gap-1">
        <div role="row" className="grid grid-cols-7 gap-1">
          {headers.map((label, i) => (
            <div
              key={`${label}-${i}`}
              role="columnheader"
              className="pb-1 text-center text-caption font-bold uppercase tracking-wide text-fg-subtle"
            >
              {label}
            </div>
          ))}
        </div>

        {[0, 1, 2, 3, 4, 5].map((week) => (
          <div role="row" key={week} className="grid grid-cols-7 gap-1">
            {cells.slice(week * 7, week * 7 + 7).map((cell) => {
              const dayEvents = byDay.get(cell.key) ?? [];
              const isToday = today === cell.key;
              const isSelected = selected === cell.key;
              const shown = dayEvents.slice(0, maxChipsPerDay);
              const overflow = dayEvents.length - shown.length;
              return (
                <button
                  type="button"
                  role="gridcell"
                  key={cell.key}
                  aria-label={cell.key}
                  aria-current={isToday ? 'date' : undefined}
                  aria-selected={isSelected}
                  data-part="calendar-day"
                  data-in-month={cell.inMonth}
                  onClick={() => {
                    setSelected(cell.key);
                    onDaySelect?.(cell.key);
                  }}
                  className={[
                    'flex min-h-14 flex-col gap-0.5 rounded-md border p-1 text-start transition-colors',
                    'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                    cell.inMonth ? 'border-border/60 bg-surface' : 'border-transparent bg-transparent',
                    isSelected ? 'bg-accent-soft' : 'hover:bg-surface-2',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'grid size-5 shrink-0 place-items-center self-start rounded-full text-caption tabular-nums',
                      // One text colour, chosen once: these classes are joined
                      // raw (no tailwind-merge), so emitting `text-fg` AND
                      // `text-accent-fg` would leave both in the class list and
                      // let stylesheet order — not this ternary — pick the
                      // winner. On the accent fill that silently rendered
                      // near-black-on-accent instead of the paired foreground.
                      isToday
                        ? 'bg-accent font-bold text-accent-fg'
                        : cell.inMonth
                          ? 'text-fg'
                          : 'text-fg-subtle',
                    ].join(' ')}
                  >
                    {fmtDayNumber(tag, cell.day)}
                  </span>
                  <div className="flex min-h-0 flex-col gap-0.5">
                    {shown.map((event, i) => {
                      const tone = event.tone !== undefined
                        ? toneOf(event.tone)
                        : categoryTone(event.category, categoryColorMap);
                      const time = fmtEventTime(tag, event);
                      return (
                        <span
                          key={`${cell.key}-${i}`}
                          title={event.title}
                          className={`flex items-center gap-1 truncate rounded-e-sm border-s-2 px-1 py-px text-[10px] font-semibold leading-tight ${TONE_SOFT_BORDER[tone]}`}
                        >
                          {time !== '' && <MonoText className="shrink-0 text-[9px] tabular-nums opacity-80">{time}</MonoText>}
                          <span className="truncate">{event.title}</span>
                        </span>
                      );
                    })}
                    {overflow > 0 && (
                      <span className="ps-1 text-[10px] font-semibold text-fg-subtle">
                        {t('ui:widgets.calendar.calendarMonth.overflowLabel', '+{count} more', {
                          count: fmtDayNumber(tag, overflow),
                        })}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Tolerant read of the `calendar-events` envelope (or a bare array). */
export function eventsOf(data: unknown): CalendarEvent[] {
  const raw = Array.isArray(data)
    ? data
    : typeof data === 'object' && data !== null
      ? ((data as { events?: unknown; data?: unknown }).events ??
        (data as { data?: unknown }).data)
      : undefined;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row) => ({
      id: (row['id'] as string | number | undefined),
      date: typeof row['date'] === 'string' ? (row['date'] as string) : '',
      title: typeof row['title'] === 'string' ? (row['title'] as string) : '',
      category: typeof row['category'] === 'string' ? (row['category'] as string) : undefined,
      time: typeof row['time'] === 'string' ? (row['time'] as string) : undefined,
      tone: typeof row['tone'] === 'string' ? (row['tone'] as string) : undefined,
    }))
    .filter((event) => event.date !== '');
}

/** Wall-clock today as a `YYYY-MM-DD` key matching the grid's UTC cell keys. */
function todayKey(): string {
  const now = new Date();
  return isoDayKey(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

export function CalendarMonthWidget({ config, data }: WidgetProps<CalendarMonthConfig>) {
  return (
    <CalendarMonth
      events={eventsOf(data)}
      today={todayKey()}
      {...(config.year === undefined ? {} : { year: config.year })}
      {...(config.month === undefined ? {} : { month: config.month })}
      {...(config.firstDayOfWeek === undefined ? {} : { firstDayOfWeek: config.firstDayOfWeek })}
      maxChipsPerDay={config.maxChipsPerDay}
      {...(config.categoryColorMap === undefined ? {} : { categoryColorMap: config.categoryColorMap })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
    />
  );
}

