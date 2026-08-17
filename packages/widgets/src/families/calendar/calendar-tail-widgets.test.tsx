// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * TRACK TABLES-CAL-BOARDS — the `calendar` family M7 Wave-4 TAIL (annex §5):
 * calendar-legend-filter, upcoming-events-list, date-range-picker,
 * scheduled-jobs-list.
 *
 * The generic properties every widget shares (four states, determinism,
 * config-fuzz, registry parity, chunk budget) are covered once for the whole
 * registry by the `qa/` harness. What is tested here is what only THIS slice
 * knows: the category aggregation, the "date ≥ today" cutoff and its pinned
 * clock, the range-picker endpoint machine + preset maths (including the
 * locale-aware week start), and the annex-mandated event contracts.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CalendarLegendFilter, CalendarLegendFilterWidget, legendCategoriesOf } from './CalendarLegendFilter.js';
import { DateRangePicker, nextRange, rangeValueOf } from './DateRangePicker.js';
import { ScheduledJobsList, ScheduledJobsListWidget, scheduledJobsOf } from './ScheduledJobsList.js';
import { UpcomingEventsList, cutoffDayOf, upcomingEventsOf } from './UpcomingEventsList.js';
import {
  calendarLegendFilterConfigSchema,
  calendarLegendFilterDemoData,
  dateRangePickerDemoData,
  scheduledJobsListConfigSchema,
  scheduledJobsListDemoData,
  upcomingEventsListConfigSchema,
  upcomingEventsListDemoData,
} from './calendar-config.js';
import {
  ANCHOR_TODAY,
  addDays,
  aggregateCategories,
  bindingSourceOf,
  daysBetween,
  firstJsWeekday,
  isInRange,
  resolvePreset,
  upcomingFrom,
} from './calendar-lib.js';
import { calendarTrackDefinitions } from './calendar-track.definitions.js';

afterEach(cleanup);

const parse = <T,>(schema: { parse: (value: unknown) => T }, overrides: Record<string, unknown> = {}): T =>
  schema.parse(overrides);

// ── calendar-legend-filter ──────────────────────────────────────────────────

describe('category aggregation (annex §5 "categories aggregated from events")', () => {
  it('counts per category in first-seen order, so the legend is render-stable', () => {
    const categories = aggregateCategories([
      { category: 'release' },
      { category: 'meeting' },
      { category: 'release' },
    ]);
    expect(categories.map((c) => [c.name, c.count])).toEqual([
      ['release', 2],
      ['meeting', 1],
    ]);
  });

  it('buckets uncategorized events rather than dropping them from the counts', () => {
    const categories = aggregateCategories([{ category: 'release' }, {}], undefined, 'Uncategorized');
    expect(categories.map((c) => c.name)).toEqual(['release', 'Uncategorized']);
    expect(categories[1]?.count).toBe(1);
  });

  it('gives a category the same tone every time (a stable hash, not call order)', () => {
    const first = aggregateCategories([{ category: 'deadline' }]);
    const second = aggregateCategories([{ category: 'x' }, { category: 'deadline' }]);
    expect(second.find((c) => c.name === 'deadline')?.tone).toBe(first[0]?.tone);
  });

  it('honours an explicit categoryColorMap over the hashed cycle', () => {
    const categories = aggregateCategories([{ category: 'release' }], { release: 'danger' });
    expect(categories[0]?.tone).toBe('danger');
  });

  it('aggregates the calendar-month payload — the legend is a VIEW, not a 2nd query', () => {
    const config = parse(calendarLegendFilterConfigSchema);
    const categories = legendCategoriesOf(calendarLegendFilterDemoData(7), config);
    const { events } = calendarLegendFilterDemoData(7);
    // The counts must always sum to the calendar's own event count.
    expect(categories.reduce((sum, c) => sum + c.count, 0)).toBe(events.length);
  });

  it('toggles a category off and reports the HIDDEN set', () => {
    const onChange = vi.fn();
    render(
      <CalendarLegendFilter categories={[{ name: 'release', count: 2, tone: 'accent' }]} onChange={onChange} />
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'release' }));
    expect(onChange).toHaveBeenCalledWith(['release']);
  });

  it('renders no checkbox and no pressed state when not toggleable', () => {
    render(
      <CalendarLegendFilter categories={[{ name: 'release', count: 2, tone: 'accent' }]} toggleable={false} />
    );
    expect(document.querySelectorAll('[role="checkbox"]')).toHaveLength(0);
  });

  it('emits the hidden set as a drill-through against the sibling linkTarget', () => {
    const onEvent = vi.fn();
    render(
      <CalendarLegendFilterWidget
        config={parse(calendarLegendFilterConfigSchema, { linkTarget: 'cal-1', href: '/calendar' })}
        data={{ events: [{ id: 1, date: ANCHOR_TODAY, title: 'Ship', category: 'release' }] }}
        instanceId="legend-1"
        onEvent={onEvent}
      />
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'release' }));
    expect(onEvent).toHaveBeenCalledWith({ type: 'drill-through', href: '/calendar#cal-1=release' });
  });

  it('shows the per-widget empty copy with no categories', () => {
    render(<CalendarLegendFilter categories={[]} emptyTitle="No categories yet" />);
    expect(screen.getByText('No categories yet')).toBeTruthy();
  });
});

// ── upcoming-events-list ────────────────────────────────────────────────────

describe('upcoming cutoff (annex §5 "events WHERE date ≥ today ORDER BY date LIMIT n")', () => {
  const events = [
    { date: '2026-07-20', title: 'Later' },
    { date: '2026-07-10', title: 'Past' },
    { date: ANCHOR_TODAY, title: 'Today', time: '15:00' },
    { date: ANCHOR_TODAY, title: 'Today early', time: '09:00' },
  ];

  it('keeps today and drops yesterday — the cutoff is a DAY, not an instant', () => {
    // An event earlier today is still "upcoming" until the day rolls over.
    expect(upcomingFrom(events, ANCHOR_TODAY, 10).map((e) => e.title)).toEqual([
      'Today early',
      'Today',
      'Later',
    ]);
  });

  it('orders same-day events by time, then caps at n', () => {
    expect(upcomingFrom(events, ANCHOR_TODAY, 2).map((e) => e.title)).toEqual(['Today early', 'Today']);
  });

  it('tolerates a full ISO timestamp in the date column', () => {
    expect(upcomingFrom([{ date: '2026-07-20T10:00:00.000Z', title: 'ISO' }], ANCHOR_TODAY, 5)).toHaveLength(1);
  });

  it('generates only forward-looking demo events, so a pinned capture has rows', () => {
    const { events: demo } = upcomingEventsListDemoData(5);
    expect(demo.every((event) => event.date >= ANCHOR_TODAY)).toBe(true);
  });
});

describe('upcoming-events-list cutoff resolution', () => {
  it('prefers an explicit fromDate', () => {
    expect(cutoffDayOf(parse(upcomingEventsListConfigSchema, { fromDate: '2026-01-01' }))).toBe('2026-01-01');
  });

  it('falls back to the shared referenceTime clock (what pins a VRT capture)', () => {
    const config = parse(upcomingEventsListConfigSchema, {
      format: { referenceTime: Date.parse('2026-07-15T12:00:00.000Z') },
    });
    expect(cutoffDayOf(config)).toBe('2026-07-15');
  });

  it('returns undefined with no pinned clock, so a live page follows the real date', () => {
    // The demo anchor must NEVER become a live fallback: "upcoming" on a real
    // page means upcoming from today, not from the fixed demo epoch.
    expect(cutoffDayOf(parse(upcomingEventsListConfigSchema))).toBeUndefined();
  });
});

describe('upcoming-events-list (annex §5)', () => {
  it('renders a row per upcoming event with its date block', () => {
    render(<UpcomingEventsList events={upcomingEventsOf(upcomingEventsListDemoData(5))} fromDate={ANCHOR_TODAY} n={4} />);
    expect(document.querySelectorAll('[data-part="upcoming-row"]')).toHaveLength(4);
    expect(document.querySelectorAll('[data-part="date-block"]')).toHaveLength(4);
  });

  it('projects the release row mapping (ref/owner/status) off the event payload', () => {
    const events = upcomingEventsOf({
      events: [{ id: 1, date: ANCHOR_TODAY, title: 'Ship', version: 'v2.1.0', assignee: 'Ada Lovelace', status: 'Scheduled' }],
    });
    // `version`/`assignee` are the alternate column names a real table uses.
    expect(events[0]?.ref).toBe('v2.1.0');
    expect(events[0]?.owner).toBe('Ada Lovelace');
  });

  it('drops events with no usable date rather than rendering an Invalid Date block', () => {
    expect(upcomingEventsOf({ events: [{ id: 1, title: 'No date' }] })).toEqual([]);
  });

  it('shows the per-widget empty copy when everything is in the past', () => {
    render(
      <UpcomingEventsList
        events={[{ date: '2020-01-01', title: 'Ancient' }]}
        fromDate={ANCHOR_TODAY}
        emptyTitle="Nothing upcoming"
      />
    );
    expect(screen.getByText('Nothing upcoming')).toBeTruthy();
  });
});

// ── date-range-picker ───────────────────────────────────────────────────────

describe('date-range endpoint machine (annex §5)', () => {
  it('first click opens a range, second closes it', () => {
    const opened = nextRange({ start: null, end: null }, '2026-07-10');
    expect(opened).toEqual({ start: '2026-07-10', end: null });
    expect(nextRange(opened, '2026-07-14')).toEqual({ start: '2026-07-10', end: '2026-07-14' });
  });

  it('swaps a backwards pick — the natural drag direction under RTL', () => {
    const opened = { start: '2026-07-14', end: null };
    expect(nextRange(opened, '2026-07-10')).toEqual({ start: '2026-07-10', end: '2026-07-14' });
  });

  it('a third click starts a fresh range', () => {
    const closed = { start: '2026-07-10', end: '2026-07-14' };
    expect(nextRange(closed, '2026-07-20')).toEqual({ start: '2026-07-20', end: null });
  });

  it('clamps past maxRange by moving the endpoint the user just clicked', () => {
    const opened = { start: '2026-07-01', end: null };
    // The anchor the user deliberately placed stays put; the new end clamps.
    expect(nextRange(opened, '2026-07-31', 7)).toEqual({ start: '2026-07-01', end: '2026-07-07' });
  });

  it('clamps a backwards over-long pick against the same anchor', () => {
    const opened = { start: '2026-07-31', end: null };
    expect(nextRange(opened, '2026-07-01', 7)).toEqual({ start: '2026-07-25', end: '2026-07-31' });
  });
});

describe('date-range presets (annex §5 "7d/30d/QTD…")', () => {
  it('counts "last 7 days" inclusively — today back 6, not back 7', () => {
    // An off-by-one here silently shifts every query the picker feeds.
    const { start, end } = resolvePreset({ days: 7 }, '2026-07-15');
    expect(start).toBe('2026-07-09');
    expect(end).toBe('2026-07-15');
    expect(daysBetween(start, end)).toBe(7);
  });

  it('anchors mtd/qtd/ytd to the period start, not a day count', () => {
    expect(resolvePreset({ anchor: 'mtd' }, '2026-08-20').start).toBe('2026-08-01');
    expect(resolvePreset({ anchor: 'qtd' }, '2026-08-20').start).toBe('2026-07-01'); // Q3
    expect(resolvePreset({ anchor: 'ytd' }, '2026-08-20').start).toBe('2026-01-01');
  });

  it('resolves qtd at each quarter boundary', () => {
    expect(resolvePreset({ anchor: 'qtd' }, '2026-02-05').start).toBe('2026-01-01');
    expect(resolvePreset({ anchor: 'qtd' }, '2026-05-05').start).toBe('2026-04-01');
    expect(resolvePreset({ anchor: 'qtd' }, '2026-11-05').start).toBe('2026-10-01');
  });

  it('crosses a month boundary correctly when stepping back', () => {
    expect(addDays('2026-08-03', -7)).toBe('2026-07-27');
  });

  it('reads an inclusive range test, and rejects a half-open one', () => {
    expect(isInRange('2026-07-10', '2026-07-10', '2026-07-14')).toBe(true);
    expect(isInRange('2026-07-14', '2026-07-10', '2026-07-14')).toBe(true);
    expect(isInRange('2026-07-15', '2026-07-10', '2026-07-14')).toBe(false);
    expect(isInRange('2026-07-12', '2026-07-10', null)).toBe(false);
  });
});

describe('date-range-picker (annex §5)', () => {
  it('starts the grid on the locale week start, not a hardcoded day', () => {
    // en-US → Sunday (0), de-DE → Monday (1), ar-EG → Saturday (6).
    expect(firstJsWeekday('en-US')).toBe(0);
    expect(firstJsWeekday('de-DE')).toBe(1);
    expect(firstJsWeekday('ar-EG')).toBe(6);
  });

  it('renders a 42-cell month grid and marks the selected endpoints', () => {
    render(<DateRangePicker value={{ start: '2026-07-10', end: '2026-07-14' }} referenceDate={ANCHOR_TODAY} />);
    expect(document.querySelectorAll('[data-part="range-day"]')).toHaveLength(42);
    expect(document.querySelectorAll('[data-part="range-day"][data-endpoint]')).toHaveLength(2);
  });

  it('fills the days between the endpoints', () => {
    render(<DateRangePicker value={{ start: '2026-07-10', end: '2026-07-14' }} referenceDate={ANCHOR_TODAY} />);
    // 10th–14th inclusive = 5 days in range (2 of them endpoints).
    expect(document.querySelectorAll('[data-part="range-day"][data-in-range]')).toHaveLength(5);
  });

  it('applies a preset and reports the resolved pair', () => {
    const onChange = vi.fn();
    render(<DateRangePicker referenceDate="2026-07-15" onChange={onChange} />);
    fireEvent.click(document.querySelector('[data-preset="7d"]') as HTMLElement);
    expect(onChange).toHaveBeenCalledWith({ start: '2026-07-09', end: '2026-07-15' });
  });

  it('marks the active preset pressed when the range matches it exactly', () => {
    render(<DateRangePicker value={resolvePreset({ days: 30 }, '2026-07-15')} referenceDate="2026-07-15" />);
    expect(document.querySelector('[data-preset="30d"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-preset="7d"]')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('projects a form-state payload from either the wrapped or bare shape', () => {
    expect(rangeValueOf({ value: { start: '2026-07-01', end: '2026-07-05' } })).toEqual({
      start: '2026-07-01',
      end: '2026-07-05',
    });
    expect(rangeValueOf({ start: '2026-07-01', end: null })).toEqual({ start: '2026-07-01', end: null });
    expect(rangeValueOf(undefined)).toEqual({ start: null, end: null });
  });

  it('truncates a full ISO instant to its day', () => {
    expect(rangeValueOf({ value: { start: '2026-07-01T09:30:00.000Z', end: '' } })).toEqual({
      start: '2026-07-01',
      end: null,
    });
  });

  it('pins its demo payload to the fixed anchor (never a wall-clock read)', () => {
    const { value } = dateRangePickerDemoData(3);
    expect(value.end).toBe(ANCHOR_TODAY);
  });
});

// ── scheduled-jobs-list ─────────────────────────────────────────────────────

describe('scheduled-jobs-list (annex §5)', () => {
  it('renders a row per job with its switch', () => {
    render(<ScheduledJobsList jobs={scheduledJobsOf(scheduledJobsListDemoData(4), parse(scheduledJobsListConfigSchema))} />);
    const rows = document.querySelectorAll('[data-part="job-row"]');
    expect(rows.length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-part="job-toggle"]')).toHaveLength(rows.length);
  });

  it('marks disabled rows so they dim (annex "disabled rows dim")', () => {
    render(
      <ScheduledJobsList
        jobs={[
          { id: 1, name: 'On', enabled: true },
          { id: 2, name: 'Off', enabled: false },
        ]}
      />
    );
    const rows = [...document.querySelectorAll('[data-part="job-row"]')];
    expect(rows[0]?.hasAttribute('data-enabled')).toBe(true);
    expect(rows[1]?.hasAttribute('data-enabled')).toBe(false);
  });

  it('treats a missing enabled column as enabled, not as off', () => {
    const jobs = scheduledJobsOf({ rows: [{ id: 1, name: 'J' }], total: 1 }, parse(scheduledJobsListConfigSchema));
    expect(jobs[0]?.enabled).toBe(true);
  });

  it('honours the row mapping config for a differently-named schema', () => {
    const jobs = scheduledJobsOf(
      { rows: [{ id: 1, report_name: 'Weekly', is_active: false }], total: 1 },
      parse(scheduledJobsListConfigSchema, { nameField: 'report_name', toggleField: 'is_active' }),
    );
    expect(jobs[0]?.name).toBe('Weekly');
    expect(jobs[0]?.enabled).toBe(false);
  });

  it('hides the switch when not toggleable (a read-only page)', () => {
    render(<ScheduledJobsList jobs={[{ id: 1, name: 'J' }]} toggleable={false} />);
    expect(document.querySelectorAll('[data-part="job-toggle"]')).toHaveLength(0);
  });

  it('emits a mutate UPDATE intent carrying the toggle field — it never writes', () => {
    const onEvent = vi.fn();
    render(
      <ScheduledJobsListWidget
        config={parse(scheduledJobsListConfigSchema, {
          binding: {
            connectionId: 'c1',
            source: { schema: 'public', name: 'scheduled_reports' },
            shape: 'record-list',
          },
        })}
        data={{ rows: [{ id: 'job-1', name: 'Weekly digest', enabled: true }], total: 1 }}
        instanceId="jobs-1"
        onEvent={onEvent}
      />
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(onEvent).toHaveBeenCalledWith({
      type: 'mutate',
      intent: 'update',
      connectionId: 'c1',
      table: 'public.scheduled_reports',
      recordId: 'job-1',
      values: { enabled: false },
    });
  });

  it('emits nothing when unbound — no table to write to', () => {
    const onEvent = vi.fn();
    render(
      <ScheduledJobsListWidget
        config={parse(scheduledJobsListConfigSchema)}
        data={{ rows: [{ id: 'job-1', name: 'Weekly digest', enabled: true }], total: 1 }}
        instanceId="jobs-2"
        onEvent={onEvent}
      />
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('pins its next-run instants to the fixed demo epoch (no Date.now)', () => {
    const first = JSON.stringify(scheduledJobsListDemoData(4));
    const second = JSON.stringify(scheduledJobsListDemoData(4));
    expect(first).toBe(second);
    expect(first).toContain(`${addDays(ANCHOR_TODAY, 1).slice(0, 7)}`);
  });

  it('shows the per-widget empty copy with no jobs', () => {
    render(<ScheduledJobsList jobs={[]} emptyTitle="No scheduled jobs" />);
    expect(screen.getByText('No scheduled jobs')).toBeTruthy();
  });
});

// ── binding descriptor ──────────────────────────────────────────────────────

describe('binding source (04 §5.1)', () => {
  it('qualifies the table from binding.source.name (+ schema), not a flat binding.table', () => {
    expect(bindingSourceOf({ connectionId: 'c1', source: { schema: 'public', name: 'jobs' } })).toEqual({
      connectionId: 'c1',
      table: 'public.jobs',
    });
    expect(bindingSourceOf({ connectionId: 'c1', source: { name: 'jobs' } })).toEqual({
      connectionId: 'c1',
      table: 'jobs',
    });
  });

  it('returns null when unbound, so a demo widget cannot emit a mutation', () => {
    expect(bindingSourceOf(undefined)).toBeNull();
  });
});

// ── definitions ─────────────────────────────────────────────────────────────

describe('calendar definitions (annex §5)', () => {
  it('registers all eight §5 ids — the family is complete', () => {
    expect(calendarTrackDefinitions.map((d) => d.id).sort()).toEqual([
      'calendar-legend-filter',
      'calendar-month',
      'capacity-board',
      'date-range-picker',
      'day-agenda',
      'schedule-matrix',
      'scheduled-jobs-list',
      'upcoming-events-list',
    ]);
  });

  it('binds the legend to the calendar-events contract it aggregates', () => {
    expect(calendarTrackDefinitions.find((d) => d.id === 'calendar-legend-filter')?.dataContract).toBe(
      'calendar-events',
    );
  });

  it('declares date-range-picker a form-state control, placed inline', () => {
    const picker = calendarTrackDefinitions.find((d) => d.id === 'date-range-picker');
    expect(picker?.dataContract).toBe('form-state');
    expect(picker?.placement).toBe('inline');
  });

  it('marks only scheduled-jobs-list as editing data in the tail slice', () => {
    const editors = calendarTrackDefinitions.filter((d) => d.capabilities?.editsData === true).map((d) => d.id);
    expect(editors).toContain('scheduled-jobs-list');
    expect(editors).not.toContain('date-range-picker');
    expect(editors).not.toContain('calendar-legend-filter');
  });

  it('fits page-calendar.json’s legend (4×4) and upcoming (8×6) slots', () => {
    const legend = calendarTrackDefinitions.find((d) => d.id === 'calendar-legend-filter')?.sizing;
    const upcoming = calendarTrackDefinitions.find((d) => d.id === 'upcoming-events-list')?.sizing;
    expect(legend?.minW).toBeLessThanOrEqual(4);
    expect(legend?.minH).toBeLessThanOrEqual(4);
    expect(upcoming?.minW).toBeLessThanOrEqual(8);
    expect(upcoming?.minH).toBeLessThanOrEqual(6);
  });
});
