// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-calendar` template renderer (09-generated-app.md §7.6, 04 §10 manifest
 * `page-calendar.json`, annex §14 "date + title → calendar").
 *
 * Composes the calendar family over the stored archetype config: the required
 * `calendar` slot renders `calendar-month`; the `agenda` slot renders the
 * selected day's events with an inline composer; optional `legend` and
 * `upcoming` slots render `calendar-legend-filter` / `upcoming-events-list`;
 * KPI-row items and anything else go through WidgetHost.
 *
 * Data plumbing: the engine persists `calendar-events`-shaped bindings whose
 * PAYLOAD arrives as a record-list (the host binding compiles them as row
 * queries — see the dashboard's planningData module), so events are mapped
 * here from rows via the stored `startColumn`/`endColumn`/`titleColumn`
 * candidate vocabulary; a true `{ events: [...] }` envelope (demo data,
 * future server shaper) passes through unchanged.
 *
 * Behaviors (09 §7.6):
 * - day select on the month grid drives the agenda pane;
 * - agenda rows are clickable → `record-open` (the host opens the record
 *   drawer); the shipped `day-agenda` widget exposes no row callback, so the
 *   agenda pane is rendered here from the same calendar-lib anatomy;
 * - the agenda composer emits an insert intent for the selected day;
 * - legend chips double as filters (hidden categories filter every pane);
 * - the toolbar `date-range-picker` publishes `dateRange.*` params upward so
 *   the host binding re-windows the widget-data query, and filters the
 *   rendered panes client-side.
 */
import { useMaybeT } from '@adminium/i18n/react';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@adminium/ui';
import { CalendarRange } from 'lucide-react';
import { useMemo, useState } from 'react';

import { InlineComposeCard } from '../../families/boards/InlineComposeCard.js';
import { boardRowsOf } from '../../families/boards/board-lib.js';
import { CalendarLegendFilter } from '../../families/calendar/CalendarLegendFilter.js';
import { CalendarMonth, eventsOf } from '../../families/calendar/CalendarMonth.js';
import { DateRangePicker } from '../../families/calendar/DateRangePicker.js';
import { UpcomingEventsList } from '../../families/calendar/UpcomingEventsList.js';
import {
  TONE_BORDER,
  aggregateCategories,
  categoryTone,
  fmtDayLabel,
  fmtEventTime,
  isInRange,
  parseIsoDay,
  resolveLocale,
  toneOf,
} from '../../families/calendar/calendar-lib.js';
import type { CalendarEvent, DateRangeValue, UpcomingEvent } from '../../families/calendar/calendar-types.js';
import { WidgetFrame } from '../../frame/WidgetFrame.js';
import { WidgetHost, type WidgetDataState } from '../../frame/WidgetHost.js';
import { DashboardGrid } from '../../grid/DashboardGrid.js';
import type { WidgetEvent } from '../../registry/types.js';
import {
  configString,
  itemConfigOf,
  parseTemplateConfig,
  planningSourceOf,
  splitInstant,
  todayIso,
  useTemplateStates,
  type TemplateDataStates,
} from '../planning/planning-lib.js';

export const PAGE_CALENDAR_TEMPLATE_ID = 'page-calendar';

const CALENDAR_WIDGET_ID = 'calendar-month';
const AGENDA_WIDGET_ID = 'day-agenda';
const LEGEND_WIDGET_ID = 'calendar-legend-filter';
const UPCOMING_WIDGET_ID = 'upcoming-events-list';

export interface PageCalendarLabels {
  dateRange?: string | undefined;
  composePlaceholder?: string | undefined;
  composeAdd?: string | undefined;
  composeCancel?: string | undefined;
  composeOpen?: string | undefined;
  agendaEmptyTitle?: string | undefined;
  agendaEmptyBody?: string | undefined;
}

export interface PageCalendarProps {
  /** The stored page config body: `{ templateVersion, toolbar, overlays, layout }`. */
  config: unknown;
  /** Per-instance data states from the host binding; absent → demo data (04 §5.3). */
  states?: TemplateDataStates | undefined;
  onEvent?: ((instanceId: string, event: WidgetEvent) => void | Promise<unknown>) | undefined;
  /** Published page-control params (`dateRange.start`/`dateRange.end`) — the
   *  host binding forwards them into the widget-data batch (04 §5.1). */
  onParamsChange?: ((params: Record<string, unknown>) => void) | undefined;
  /** Deterministic "today" (`YYYY-MM-DD`) for stories/tests; defaults to the wall clock. */
  referenceDate?: string | undefined;
  locale?: string | undefined;
  labels?: PageCalendarLabels | undefined;
  className?: string | undefined;
  testId?: string | undefined;
}

interface CalendarItemConfig {
  startColumn: string;
  endColumn: string | undefined;
  titleColumn: string;
  categoryColumn: string | undefined;
  categoryColorMap: Record<string, string> | undefined;
}

export function calendarItemConfigOf(config: Record<string, unknown>): CalendarItemConfig {
  const colorMap = config['categoryColorMap'];
  return {
    startColumn: configString(config, 'startColumn', 'dateColumn') ?? 'date',
    endColumn: configString(config, 'endColumn'),
    titleColumn: configString(config, 'titleColumn', 'titleField') ?? 'title',
    categoryColumn: configString(config, 'categoryColumn'),
    categoryColorMap:
      typeof colorMap === 'object' && colorMap !== null ? (colorMap as Record<string, string>) : undefined,
  };
}

/**
 * Events from a bound payload: a `calendar-events` envelope passes through;
 * a record-list is mapped via the stored column vocabulary. The record id
 * rides on `event.id`, so a clicked row can open the record drawer.
 */
export function calendarEventsOf(data: unknown, cfg: CalendarItemConfig): UpcomingEvent[] {
  const direct = eventsOf(data);
  if (direct.length > 0) return direct as UpcomingEvent[];
  const rows = boardRowsOf(data);
  const events: UpcomingEvent[] = [];
  for (const row of rows) {
    const start = splitInstant(row[cfg.startColumn]);
    if (start === null) continue;
    const title = row[cfg.titleColumn] ?? row['title'];
    const category = cfg.categoryColumn !== undefined ? row[cfg.categoryColumn] : row['category'];
    const end = cfg.endColumn !== undefined ? splitInstant(row[cfg.endColumn]) : null;
    const id = row['id'] ?? row['_id'];
    events.push({
      ...(typeof id === 'string' || typeof id === 'number' ? { id } : {}),
      date: start.day,
      title: typeof title === 'string' && title !== '' ? title : String(id ?? ''),
      ...(start.time === undefined ? {} : { time: start.time }),
      ...(end?.time === undefined ? {} : { end: end.time }),
      ...(typeof category === 'string' && category !== '' ? { category } : {}),
      ...(typeof row['ref'] === 'string' ? { ref: row['ref'] as string } : {}),
      ...(typeof row['owner'] === 'string' ? { owner: row['owner'] as string } : {}),
      ...(typeof row['status'] === 'string' ? { status: row['status'] as string } : {}),
    });
  }
  return events;
}

/** Minutes-since-midnight for stable agenda ordering (all-day first). */
function minutesOf(event: CalendarEvent): number {
  if (event.time === undefined || !/^\d{1,2}:\d{2}$/.test(event.time)) return -1;
  const [h, m] = event.time.split(':').map(Number);
  return (h as number) * 60 + (m as number);
}

/**
 * The selected day's agenda: clickable event rows (same anatomy as the
 * family's `day-agenda`) + the inline composer (09 §7.6 "day select →
 * day-agenda with inline composer"). Rendered here because the shipped
 * DayAgenda exposes neither a row-click callback nor a composer.
 */
function AgendaPane({
  day,
  events,
  colorMap,
  locale,
  canCompose,
  onOpen,
  onCompose,
  labels,
}: {
  day: string;
  events: readonly UpcomingEvent[];
  colorMap: Record<string, string> | undefined;
  locale: string | undefined;
  canCompose: boolean;
  onOpen: ((event: UpcomingEvent) => void) | undefined;
  onCompose: ((title: string) => void) | undefined;
  labels: PageCalendarLabels | undefined;
}) {
  const t = useMaybeT();
  const tag = resolveLocale(locale);
  const dayEvents = events.filter((event) => event.date === day).sort((a, b) => minutesOf(a) - minutesOf(b));
  return (
    <div data-part="calendar-agenda" className="flex h-full flex-col">
      <div className="flex items-baseline justify-between border-b border-border/60 px-3 py-2">
        <h3 className="text-body-sm font-bold text-fg">{fmtDayLabel(tag, parseIsoDay(day))}</h3>
        <span className="text-caption font-semibold text-fg-subtle">
          {/* `count` drives the ICU plural; `n` is pre-stringified so the digits render exactly as before. */}
          {t('ui:templates.calendar.eventCount', '{count, plural, one {{n} event} other {{n} events}}', {
            count: dayEvents.length,
            n: String(dayEvents.length),
          })}
        </span>
      </div>
      <div className="flex-1 space-y-1.5 overflow-auto p-3">
        {dayEvents.length === 0 && (
          <p className="px-1 py-2 text-body-sm text-fg-muted" data-part="agenda-empty">
            {labels?.agendaEmptyTitle ?? t('ui:widgets.calendar.dayAgenda.emptyTitle', 'Nothing scheduled')}
          </p>
        )}
        {dayEvents.map((event, index) => {
          const tone = event.tone !== undefined ? toneOf(event.tone) : categoryTone(event.category, colorMap);
          const start = fmtEventTime(tag, event);
          const end = event.end !== undefined ? fmtEventTime(tag, { date: event.date, time: event.end }) : '';
          const timeLabel = end !== '' ? `${start} – ${end}` : start;
          const clickable = onOpen !== undefined && event.id !== undefined;
          return (
            <button
              key={`${event.id ?? index}`}
              type="button"
              data-part="agenda-event"
              disabled={!clickable}
              onClick={clickable ? () => onOpen(event) : undefined}
              className={`flex w-full items-start gap-3 rounded-md border-s-4 bg-surface px-3 py-2 text-start ${TONE_BORDER[tone]} ${
                clickable
                  ? 'hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'
                  : ''
              }`}
            >
              <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-fg">{event.title}</span>
              {timeLabel !== '' && (
                <span className="shrink-0 whitespace-nowrap font-mono text-caption tabular-nums text-fg-muted">
                  {timeLabel}
                </span>
              )}
            </button>
          );
        })}
        {canCompose && onCompose !== undefined && (
          <div className="pt-1.5">
            <InlineComposeCard
              keepOpen={false}
              placeholder={labels?.composePlaceholder ?? t('ui:templates.calendar.composePlaceholder', 'Event title…')}
              addLabel={labels?.composeAdd ?? t('ui:widgets.boards.inlineComposeCard.addLabel', 'Add')}
              cancelLabel={labels?.composeCancel ?? t('ui:action.cancel', 'Cancel')}
              openLabel={labels?.composeOpen ?? t('ui:templates.calendar.addEvent', 'Add event')}
              testId="agenda-compose"
              onAdd={onCompose}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function PageCalendar({
  config,
  states,
  onEvent,
  onParamsChange,
  referenceDate,
  locale,
  labels,
  className,
  testId,
}: PageCalendarProps) {
  const t = useMaybeT();
  const parsed = useMemo(() => parseTemplateConfig(config), [config]);
  const resolvedStates = useTemplateStates(parsed.layout, states);
  const today = referenceDate ?? todayIso();

  // The uncategorized bucket NAME is also the legend-filter identity: the same
  // resolved string must feed `aggregateCategories` and the hidden-set check,
  // or toggling the bucket would stop filtering under a non-English locale.
  const uncategorized = t('ui:widgets.calendar.calendarLegendFilter.uncategorizedLabel', 'Uncategorized');

  const calendarItem = parsed.layout.items.find((item) => item.widget === CALENDAR_WIDGET_ID);
  const calendarRaw = calendarItem === undefined ? {} : itemConfigOf(calendarItem);
  const cfg = useMemo(() => calendarItemConfigOf(calendarRaw), [calendarRaw]);
  const source = calendarItem === undefined ? null : planningSourceOf(calendarRaw);

  const calendarState: WidgetDataState =
    calendarItem === undefined ? { status: 'success', data: { events: [] } } : resolvedStates[calendarItem.i] ?? { status: 'loading' };

  const allEvents = useMemo(() => calendarEventsOf(calendarState.data, cfg), [calendarState.data, cfg]);

  const [selectedDay, setSelectedDay] = useState<string>(today);
  const [hidden, setHidden] = useState<readonly string[]>([]);
  const [range, setRange] = useState<DateRangeValue>({ start: null, end: null });

  const visibleEvents = useMemo(() => {
    const hiddenSet = new Set(hidden);
    return allEvents.filter((event) => {
      if (hiddenSet.has(event.category ?? uncategorized)) return false;
      if (range.start !== null && range.end !== null) return isInRange(event.date, range.start, range.end);
      return true;
    });
  }, [allEvents, hidden, range, uncategorized]);

  const openRecordFrom = (instanceId: string) => (event: UpcomingEvent) => {
    if (source === null || onEvent === undefined || event.id === undefined) return;
    onEvent(instanceId, {
      type: 'record-open',
      connectionId: source.connectionId,
      table: source.table,
      recordId: event.id,
    });
  };

  const composeFor = (day: string) => (title: string) => {
    if (source === null || onEvent === undefined || calendarItem === undefined) return;
    void onEvent(calendarItem.i, {
      type: 'mutate',
      intent: 'insert',
      connectionId: source.connectionId,
      table: source.table,
      values: { [cfg.titleColumn]: title, [cfg.startColumn]: day },
    });
  };

  const applyRange = (next: DateRangeValue) => {
    setRange(next);
    if (next.start !== null && next.end !== null) {
      onParamsChange?.({ 'dateRange.start': next.start, 'dateRange.end': next.end });
    }
  };

  if (parsed.invalid) {
    return (
      <p role="alert" className="p-6 text-body-sm text-fg-muted" data-testid="page-calendar-invalid">
        {t(
          'ui:templates.calendar.invalidLayout',
          'This calendar’s stored layout is invalid. Regenerate the page or reset its layout.',
        )}
      </p>
    );
  }

  const showRangePicker = parsed.toolbar.includes('date-range-picker');

  return (
    <div data-part="page-calendar" data-testid={testId ?? 'page-calendar'} className={className}>
      {showRangePicker && (
        <div className="flex items-center justify-end pb-3">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="secondary" size="sm" iconLeft={<CalendarRange />} data-part="calendar-range-trigger">
                {range.start !== null && range.end !== null
                  ? `${range.start} → ${range.end}`
                  : labels?.dateRange ?? t('ui:templates.calendar.dateRange', 'Date range')}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <DateRangePicker
                value={range}
                referenceDate={today}
                {...(locale === undefined ? {} : { locale })}
                onChange={applyRange}
                testId="calendar-range-picker"
              />
            </PopoverContent>
          </Popover>
        </div>
      )}
      <DashboardGrid
        layout={parsed.layout}
        testId="page-calendar-grid"
        renderItem={(item) => {
          const state = resolvedStates[item.i] ?? { status: 'loading' as const };
          if (item.widget === CALENDAR_WIDGET_ID) {
            const frameState = state.status === 'loading' ? 'skeleton' : state.status === 'error' ? 'error' : 'loaded';
            return (
              <WidgetFrame
                state={frameState}
                title={configString(itemConfigOf(item), 'title')}
                skeleton="chart"
                errorMessage={state.status === 'error' ? frameMessageOf(state.error) : undefined}
                onRetry={state.refetch}
                refetching={state.isRefetching === true}
                testId={`calendar-slot-${item.i}`}
              >
                <CalendarMonth
                  events={visibleEvents}
                  today={today}
                  selectedDate={selectedDay}
                  {...(locale === undefined ? {} : { locale })}
                  {...(cfg.categoryColorMap === undefined ? {} : { categoryColorMap: cfg.categoryColorMap })}
                  onDaySelect={setSelectedDay}
                />
              </WidgetFrame>
            );
          }
          if (item.widget === AGENDA_WIDGET_ID) {
            return (
              <WidgetFrame
                state="loaded"
                title={configString(itemConfigOf(item), 'title') ?? t('ui:templates.calendar.agendaTitle', 'Agenda')}
                skeleton="list"
                testId={`agenda-slot-${item.i}`}
              >
                <AgendaPane
                  day={selectedDay}
                  events={visibleEvents}
                  colorMap={cfg.categoryColorMap}
                  locale={locale}
                  canCompose={source !== null}
                  onOpen={calendarItem === undefined ? undefined : openRecordFrom(calendarItem.i)}
                  onCompose={composeFor(selectedDay)}
                  labels={labels}
                />
              </WidgetFrame>
            );
          }
          if (item.widget === LEGEND_WIDGET_ID) {
            return (
              <WidgetFrame
                state="loaded"
                title={configString(itemConfigOf(item), 'title') ?? t('ui:templates.calendar.categoriesTitle', 'Categories')}
                skeleton="list"
                testId={`legend-slot-${item.i}`}
              >
                <CalendarLegendFilter
                  categories={aggregateCategories(allEvents, cfg.categoryColorMap, uncategorized)}
                  {...(locale === undefined ? {} : { locale })}
                  onChange={setHidden}
                />
              </WidgetFrame>
            );
          }
          if (item.widget === UPCOMING_WIDGET_ID) {
            return (
              <WidgetFrame
                state="loaded"
                title={configString(itemConfigOf(item), 'title') ?? t('ui:templates.calendar.upcomingTitle', 'Upcoming')}
                skeleton="list"
                testId={`upcoming-slot-${item.i}`}
              >
                <UpcomingEventsList
                  events={visibleEvents}
                  fromDate={today}
                  {...(locale === undefined ? {} : { locale })}
                  {...(cfg.categoryColorMap === undefined ? {} : { categoryColorMap: cfg.categoryColorMap })}
                  onSelect={openRecordFrom(item.i)}
                />
              </WidgetFrame>
            );
          }
          return (
            <WidgetHost
              widgetId={item.widget}
              instanceId={item.i}
              config={item.config}
              data={state}
              onEvent={onEvent === undefined ? undefined : (event) => void onEvent(item.i, event)}
            />
          );
        }}
      />
    </div>
  );
}

function frameMessageOf(error: unknown): string | undefined {
  if (error instanceof Error && error.message !== '') return error.message;
  if (typeof error === 'string' && error !== '') return error;
  return undefined;
}
