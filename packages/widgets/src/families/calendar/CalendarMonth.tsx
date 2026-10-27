// SPDX-License-Identifier: AGPL-3.0-only
import { useMaybeT } from '../../lib/i18n.js';
import { EmptyState } from '@adminium/ui';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { Tone } from '@adminium/ui';
import { useEffect, useMemo, useState } from 'react';

import {
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
// . Re-exported here to keep existing import points stable.
export { calendarMonthConfigSchema, calendarMonthDemoData } from './calendar-config.js';
export type { CalendarMonthConfig } from './calendar-config.js';

/**
 * `calendar-month` (annex) — a 42-cell month grid: day numbers, up to N
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
  /**
   * The calendars an event belongs to, as chips at the header's end (the
   * Release Calendar comp): each toggles its events off and on.
   */
  categories?: readonly { id: string; label: string; tone: Tone; hidden: boolean }[] | undefined;
  onToggleCategory?: ((id: string) => void) | undefined;
  /** "New event" at the header's end (the Calendar Scheduler comp), with its words. */
  onNew?: (() => void) | undefined;
  newLabel?: string | undefined;
  /**
   * The days the grid shows, first and last (`YYYY-MM-DD`), when it is drawn
   * and whenever the month changes: a host reads only those days' rows, so a
   * table with years of history still fills the month on screen.
   */
  onViewChange?: ((first: string, last: string) => void) | undefined;
  testId?: string | undefined;
}

/** An event's pill: a tint of its colour, its words in it, a dot before them (both comps). */
const PILL_TONE: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-fg-muted',
  // The opaque tints: a translucent one over a grey cell (out of the month, hovered) drops a pill's words under 4.5:1.
  accent: 'bg-accent-soft-solid text-accent',
  pos: 'bg-pos-soft-solid text-pos',
  warn: 'bg-warn-soft-solid text-warn',
  danger: 'bg-danger-soft-solid text-danger',
  info: 'bg-info-soft-solid text-info',
};
const DOT_TONE: Record<Tone, string> = {
  neutral: 'bg-fg-subtle',
  accent: 'bg-accent',
  pos: 'bg-pos',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
};

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

/**
 * Pick the displayed month: explicit config, else the modal event month, else
 * the month `today` falls in (the wall clock's when absent). The demo anchor
 * month is a story's to pass explicitly, never a live calendar's default.
 */
function inferMonth(
  events: readonly CalendarEvent[],
  year?: number,
  month?: number,
  today?: string,
): { year: number; month: number } {
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
  const now = parseIsoDay(today ?? todayKey());
  return { year: year ?? now.getUTCFullYear(), month: month ?? now.getUTCMonth() };
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
  categories,
  onToggleCategory,
  onNew,
  newLabel,
  onViewChange,
  testId,
}: CalendarMonthProps) {
  const t = useMaybeT();
  const tag = resolveLocale(locale);
  const base = useMemo(() => inferMonth(events, year, month, today), [events, year, month, today]);
  const [view, setView] = useState(base);
  const [selected, setSelected] = useState<string | undefined>(selectedDate);

  const firstJs = firstJsWeekday(tag, firstDayOfWeek);
  const headers = useMemo(() => weekdayHeaders(tag, firstJs), [tag, firstJs]);
  const cells = useMemo(() => monthGrid(view.year, view.month, firstJs), [view, firstJs]);
  const byDay = useMemo(() => groupByDay(events), [events]);
  const firstCell = cells[0]?.key;
  const lastCell = cells[cells.length - 1]?.key;
  useEffect(() => {
    if (firstCell !== undefined && lastCell !== undefined) onViewChange?.(firstCell, lastCell);
    // The days on screen are the whole key: a new callback for the same month asks nothing again.
  }, [firstCell, lastCell]);

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

  const goToday = () => {
    const now = parseIsoDay(today ?? todayKey());
    setView({ year: now.getUTCFullYear(), month: now.getUTCMonth() });
    const key = isoDayKey(now);
    setSelected(key);
    onDaySelect?.(key);
  };
  const navButton =
    'grid size-8 place-items-center rounded-[8px] border border-border bg-surface text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

  // The Calendar Scheduler / Release Calendar comps: one card — the month and its controls, the weekdays, a ruled grid.
  return (
    <div data-widget="calendar-month" data-testid={testId} className="flex h-full flex-col overflow-hidden rounded-[16px] border border-border bg-surface leading-[normal] shadow-card">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-[18px] py-3.5">
        <button type="button" aria-label={t('ui:widgets.calendar.calendarMonth.previousLabel', 'Previous month')} data-part="calendar-prev" onClick={() => step(-1)} className={navButton}>
          <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />
        </button>
        <button type="button" aria-label={t('ui:widgets.calendar.calendarMonth.nextLabel', 'Next month')} data-part="calendar-next" onClick={() => step(1)} className={navButton}>
          <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
        </button>
        <h3 className="m-0 ms-1 text-[18px] font-extrabold tracking-[-0.02em] text-fg">{title}</h3>
        <button
          type="button"
          data-part="calendar-today"
          onClick={goToday}
          className="rounded-[8px] border border-border bg-surface px-3 py-1.5 text-[12.5px] font-bold text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {t('ui:widgets.calendar.calendarMonth.today', 'Today')}
        </button>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {categories?.map((category) => (
            <button
              key={category.id}
              type="button"
              data-part="calendar-category"
              aria-pressed={!category.hidden}
              onClick={() => onToggleCategory?.(category.id)}
              className={`flex items-center gap-1.5 rounded-[8px] border border-border px-2.5 py-1.5 text-[12px] font-bold transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${category.hidden ? 'bg-surface-2 text-fg-subtle opacity-60' : 'bg-surface text-fg'}`}
            >
              <span aria-hidden="true" className={`size-2 shrink-0 rounded-[3px] ${DOT_TONE[category.tone]}`} />
              {category.label}
            </button>
          ))}
          {onNew === undefined ? null : (
            <button
              type="button"
              data-part="calendar-new"
              onClick={onNew}
              className="flex items-center gap-[7px] rounded-[10px] bg-accent py-2 pe-[13px] ps-2.5 text-[13px] font-bold text-accent-fg shadow-[0_2px_8px_color-mix(in_srgb,var(--accent)_35%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Plus className="size-4" aria-hidden="true" />
              {newLabel ?? t('ui:widgets.calendar.calendarMonth.newEvent', 'New event')}
            </button>
          )}
        </div>
      </div>

      {/* A week grows to hold its events (the comp's roomy cells); a month taller than the page scrolls inside its card. */}
      <div role="grid" aria-label={title} className="grid min-h-0 flex-1 auto-rows-[minmax(104px,auto)] grid-rows-[auto] overflow-y-auto">
        <div role="row" className="sticky top-0 z-[1] grid grid-cols-7 border-b border-border bg-surface">
          {headers.map((label, i) => (
            <div key={`${label}-${i}`} role="columnheader" className="py-3 text-center text-[11px] font-bold uppercase tracking-[.05em] text-fg-subtle">
              {label}
            </div>
          ))}
        </div>

        {[0, 1, 2, 3, 4, 5].map((week) => (
          <div role="row" key={week} className={`grid grid-cols-7${week < 5 ? ' border-b border-border' : ''}`}>
            {cells.slice(week * 7, week * 7 + 7).map((cell, column) => {
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
                    'flex min-h-[104px] min-w-0 flex-col gap-1.5 p-2.5 text-start transition-colors',
                    column < 6 ? 'border-e border-border' : '',
                    'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                    isSelected ? 'bg-accent-soft' : cell.inMonth ? 'bg-surface hover:bg-surface-2' : 'bg-surface-2 hover:bg-surface-3/60',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'grid size-[22px] shrink-0 place-items-center self-start rounded-full text-[12.5px] font-bold tabular-nums',
                      // One text colour, chosen once: these classes are joined raw (no tailwind-merge).
                      isToday ? 'bg-accent text-accent-fg' : cell.inMonth ? 'text-fg' : 'text-fg-subtle',
                    ].join(' ')}
                  >
                    {fmtDayNumber(tag, cell.day)}
                  </span>
                  <div className="flex min-h-0 min-w-0 flex-col gap-1">
                    {shown.map((event, i) => {
                      const tone = event.tone !== undefined ? toneOf(event.tone) : categoryTone(event.category, categoryColorMap);
                      const time = fmtEventTime(tag, event);
                      return (
                        <span
                          key={`${cell.key}-${i}`}
                          title={time === '' ? event.title : `${time} · ${event.title}`}
                          data-part="calendar-event"
                          className={`flex min-w-0 items-center gap-[5px] rounded-[6px] px-2 py-[3px] text-[11px] font-bold ${PILL_TONE[tone]}`}
                        >
                          <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${DOT_TONE[tone]}`} />
                          <span className="truncate">{event.title}</span>
                        </span>
                      );
                    })}
                    {overflow > 0 && (
                      <span className="ps-1 text-[10.5px] font-semibold text-fg-subtle">
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

