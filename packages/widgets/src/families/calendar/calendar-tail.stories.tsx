/**
 * TRACK TABLES-CAL-BOARDS `calendar` M7 Wave-4 TAIL stories (annex §5): each
 * widget's loaded variant, the four WidgetFrame states through WidgetHost
 * (acceptance #4), and light/dark × LTR/RTL matrices with REAL geometry
 * mirroring (acceptance #9 — the RTL frames set `dir="rtl"` so the upcoming
 * rows' `border-s-4` accent moves to the right edge, the picker's month grid
 * flips with its locale week-start, the range pill's `rounded-s`/`-e` caps swap,
 * and the job rows' avatar stack and switch reverse; a bare attribute would
 * prove nothing).
 *
 * Every date-sensitive story pins `referenceTime`/`referenceDate` to the family's
 * fixed demo anchor, so a VRT capture is byte-stable and never depends on the day
 * CI happens to run (04 §7.7).
 */
import type { ReactNode } from 'react';

import { CalendarLegendFilter, legendCategoriesOf } from './CalendarLegendFilter.js';
import { DateRangePicker } from './DateRangePicker.js';
import { ScheduledJobsList, scheduledJobsOf } from './ScheduledJobsList.js';
import { UpcomingEventsList, upcomingEventsOf } from './UpcomingEventsList.js';
import {
  calendarLegendFilterConfigSchema,
  calendarLegendFilterDemoData,
  dateRangePickerDemoData,
  scheduledJobsListConfigSchema,
  scheduledJobsListDemoData,
  upcomingEventsListDemoData,
} from './calendar-config.js';
import { ANCHOR_TODAY, resolvePreset } from './calendar-lib.js';
import { calendarTrackDefinitions } from './calendar-track.definitions.js';
import { WidgetHost } from '../../frame/WidgetHost.js';
import { buildRegistry } from '../../registry/index.js';
import type { WidgetDefinition } from '../../registry/types.js';

const registry = buildRegistry([...calendarTrackDefinitions] as WidgetDefinition[]);

const meta = { title: 'Widgets/Calendar (tail)' };
export default meta;

type Status = 'success' | 'loading' | 'error';

function host(
  widgetId: string,
  instanceId: string,
  config: Record<string, unknown>,
  data: unknown,
  status: Status = 'success',
) {
  return (
    <div className="h-80 w-full">
      <WidgetHost
        widgetId={widgetId}
        instanceId={instanceId}
        config={config}
        registry={registry}
        data={
          status === 'success'
            ? { status, data }
            : status === 'error'
              ? { status, error: new Error('SCHEDULE_FORBIDDEN'), refetch: () => {} }
              : { status }
        }
      />
    </div>
  );
}

function Frame({ dark, dir, children }: { dark?: boolean; dir?: 'ltr' | 'rtl'; children: ReactNode }) {
  const content = (
    <div dir={dir} className="bg-bg p-4">
      {children}
    </div>
  );
  return dark ? <div data-theme="dark">{content}</div> : content;
}

/** Schema defaults + overrides — the same projection the host performs. */
function parse<T>(schema: { parse: (value: unknown) => T }, overrides: Record<string, unknown> = {}): T {
  return schema.parse(overrides);
}

// ── Per-widget loaded variants ─────────────────────────────────────────────

export const CalendarLegendFilterStory = {
  name: 'calendar-legend-filter',
  render: () => host('calendar-legend-filter', 's-legend', { title: 'Categories' }, calendarLegendFilterDemoData(7)),
};

export const CalendarLegendFilterChips = {
  name: 'calendar-legend-filter (chips)',
  render: () =>
    host('calendar-legend-filter', 's-legend-chips', { title: 'Environments', variant: 'chips' }, calendarLegendFilterDemoData(3)),
};

export const UpcomingEventsListStory = {
  name: 'upcoming-events-list',
  render: () =>
    host(
      'upcoming-events-list',
      's-upcoming',
      { title: 'Upcoming releases', fromDate: ANCHOR_TODAY },
      upcomingEventsListDemoData(5),
    ),
};

export const DateRangePickerStory = {
  name: 'date-range-picker',
  render: () =>
    host('date-range-picker', 's-range', { title: 'Date range', referenceDate: ANCHOR_TODAY }, dateRangePickerDemoData(2)),
};

export const ScheduledJobsListStory = {
  name: 'scheduled-jobs-list',
  render: () => host('scheduled-jobs-list', 's-jobs', { title: 'Scheduled reports' }, scheduledJobsListDemoData(4)),
};

// ── Four WidgetFrame states (acceptance #4) ────────────────────────────────

/** upcoming-events-list: loaded · skeleton · empty · error. */
export const States = {
  render: () => (
    <Frame>
      <div className="grid grid-cols-2 gap-4">
        {host('upcoming-events-list', 'us-loaded', { title: 'Upcoming', fromDate: ANCHOR_TODAY }, upcomingEventsListDemoData(5))}
        {host('upcoming-events-list', 'us-skeleton', { title: 'Upcoming' }, undefined, 'loading')}
        {host('upcoming-events-list', 'us-empty', { title: 'Upcoming', emptyState: { titleKey: 'Nothing upcoming' } }, { events: [] })}
        {host('upcoming-events-list', 'us-error', { title: 'Upcoming' }, undefined, 'error')}
      </div>
    </Frame>
  ),
};

/** scheduled-jobs-list: the same four states for the jobs table. */
export const JobStates = {
  render: () => (
    <Frame>
      <div className="grid grid-cols-2 gap-4">
        {host('scheduled-jobs-list', 'js-loaded', { title: 'Schedules' }, scheduledJobsListDemoData(4))}
        {host('scheduled-jobs-list', 'js-skeleton', { title: 'Schedules' }, undefined, 'loading')}
        {host('scheduled-jobs-list', 'js-empty', { title: 'Schedules', emptyState: { titleKey: 'No scheduled jobs' } }, { rows: [], total: 0 })}
        {host('scheduled-jobs-list', 'js-error', { title: 'Schedules' }, undefined, 'error')}
      </div>
    </Frame>
  ),
};

/** calendar-legend-filter: the same four states for the rail-sized legend. */
export const LegendStates = {
  render: () => (
    <Frame>
      <div className="grid grid-cols-2 gap-4">
        {host('calendar-legend-filter', 'ls-loaded', { title: 'Categories' }, calendarLegendFilterDemoData(7))}
        {host('calendar-legend-filter', 'ls-skeleton', { title: 'Categories' }, undefined, 'loading')}
        {host('calendar-legend-filter', 'ls-empty', { title: 'Categories', emptyState: { titleKey: 'No categories yet' } }, { events: [] })}
        {host('calendar-legend-filter', 'ls-error', { title: 'Categories' }, undefined, 'error')}
      </div>
    </Frame>
  ),
};

// ── light/dark × LTR/RTL with real mirroring (acceptance #9) ───────────────

/**
 * The legend + upcoming feed. Under RTL the legend's checkbox/dot lead on the
 * right and each upcoming row's coloured accent (`border-s-4`) moves with them —
 * the annex calls it a "left border", but left is only correct in LTR.
 */
export const LegendAndUpcomingThemeAndDirectionMatrix = {
  render: () => {
    const categories = legendCategoriesOf(calendarLegendFilterDemoData(7), parse(calendarLegendFilterConfigSchema));
    const events = upcomingEventsOf(upcomingEventsListDemoData(5));
    const row = () => (
      <div className="grid grid-cols-2 gap-4">
        <div className="h-72 overflow-hidden rounded-lg border border-border bg-surface">
          <CalendarLegendFilter categories={categories} />
        </div>
        <div className="h-72 overflow-hidden rounded-lg border border-border bg-surface">
          <UpcomingEventsList events={events} fromDate={ANCHOR_TODAY} />
        </div>
      </div>
    );
    return (
      <div className="flex flex-col gap-4">
        <Frame dir="ltr">{row()}</Frame>
        <Frame dir="rtl">{row()}</Frame>
        <Frame dark dir="ltr">{row()}</Frame>
        <Frame dark dir="rtl">{row()}</Frame>
      </div>
    );
  },
};

/**
 * The range picker across both directions AND two locale week-starts: `en-US`
 * starts the grid on Sunday, `ar-EG` on Saturday. That is the locale-aware
 * week-start machinery doing real work — not a mirrored Sunday-first grid.
 */
export const DateRangePickerThemeAndDirectionMatrix = {
  render: () => {
    const preset = resolvePreset({ days: 14 }, ANCHOR_TODAY);
    const picker = (locale: string) => (
      <div className="w-72 rounded-lg border border-border bg-surface">
        <DateRangePicker value={preset} referenceDate={ANCHOR_TODAY} locale={locale} />
      </div>
    );
    return (
      <div className="flex flex-col gap-4">
        <Frame dir="ltr">{picker('en-US')}</Frame>
        <Frame dir="rtl">{picker('ar-EG')}</Frame>
        <Frame dark dir="ltr">{picker('de-DE')}</Frame>
        <Frame dark dir="rtl">{picker('ar-EG')}</Frame>
      </div>
    );
  },
};

/** The jobs list — the avatar stack, next-run column and switch all reverse. */
export const ScheduledJobsThemeAndDirectionMatrix = {
  render: () => {
    const jobs = scheduledJobsOf(scheduledJobsListDemoData(4), parse(scheduledJobsListConfigSchema));
    const list = () => (
      <div className="h-72 overflow-hidden rounded-lg border border-border bg-surface">
        <ScheduledJobsList jobs={jobs} />
      </div>
    );
    return (
      <div className="flex flex-col gap-4">
        <Frame dir="ltr">{list()}</Frame>
        <Frame dir="rtl">{list()}</Frame>
        <Frame dark dir="ltr">{list()}</Frame>
        <Frame dark dir="rtl">{list()}</Frame>
      </div>
    );
  },
};

// ── Interaction stories ────────────────────────────────────────────────────

/** Picking a range: click a start day, then a later end day. */
export const RangeSelectionInteraction = {
  name: 'date-range-picker (select a range)',
  render: () => (
    <Frame>
      <div className="w-72 rounded-lg border border-border bg-surface">
        <DateRangePicker referenceDate={ANCHOR_TODAY} />
      </div>
    </Frame>
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const days = canvasElement.querySelectorAll<HTMLElement>('[data-part="range-day"]');
    days[8]?.click();
    days[15]?.click();
  },
};

/** Toggling a legend category off — the row dims and strikes through. */
export const LegendToggleInteraction = {
  name: 'calendar-legend-filter (toggle a category)',
  render: () => (
    <Frame>
      <div className="h-56 w-72 rounded-lg border border-border bg-surface">
        <CalendarLegendFilter
          categories={legendCategoriesOf(calendarLegendFilterDemoData(7), parse(calendarLegendFilterConfigSchema))}
          variant="chips"
        />
      </div>
    </Frame>
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    canvasElement.querySelector<HTMLElement>('[data-part="legend-chip"] button')?.click();
  },
};
